import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { isNumericConstant } from '../core/address';
import { parseRungText, RungTextError } from '../core/ascii';
import { newProject } from '../core/project';
import { validateProject } from '../core/validate';
import { PlcEngine } from '../runtime/engine';
import { IndexedDbProjectStore } from './indexeddb';
import { IMPORT_LIMITS, importProject, parseProjectJson } from './schema';

const nested = (depth: number) =>
  '{"kind":"branch","legs":[['.repeat(depth) + '{"kind":"instr","mnemonic":"XIC","operands":["B3:0/0"]}' + ']]}'.repeat(depth);

const projectJson = (elements: string, extra = '') =>
  `{"format":"rungranger-project","schemaVersion":1${extra},"program":{"rungs":[{"elements":[${elements},{"kind":"instr","mnemonic":"OTE","operands":["B3:0/1"]}]}]}}`;

describe('hostile project input', () => {
  it('numeric constant check runs in linear time on long input', () => {
    const t = performance.now();
    expect(isNumericConstant('1'.repeat(200_000) + 'x')).toBe(false);
    expect(isNumericConstant('9'.repeat(50) )).toBe(false); // over the length cap
    expect(isNumericConstant('-12.5e3')).toBe(true);
    expect(performance.now() - t).toBeLessThan(50);
  });

  it('deeply nested branches are cut off instead of overflowing the stack', () => {
    const r = parseProjectJson(projectJson(nested(5000)));
    expect(r.project).not.toBeNull();
    expect(r.warnings.join('\n')).toMatch(/nested deeper than 16/);
    // downstream recursive consumers must cope with the result
    expect(() => validateProject(r.project!)).not.toThrow();
    expect(() => new PlcEngine(r.project!)).not.toThrow();
  });

  it('importProject never throws, whatever it is given', () => {
    const cyclic: Record<string, unknown> = { format: 'rungranger-project', program: { rungs: [] } };
    (cyclic.program as Record<string, unknown>).rungs = [{ elements: [cyclic] }];
    for (const input of [null, 42, 'x', [], cyclic, { format: 'rungranger-project', dataFiles: 'nope', program: { rungs: [null, 1, { elements: 'x' }] } }]) {
      expect(() => importProject(input)).not.toThrow();
    }
  });

  it('bounds sizes of rungs, elements, strings, data and warnings', () => {
    const many = Array.from({ length: 30000 }, () => '{"kind":"instr","mnemonic":"XIC","operands":["B3:0/0"]}').join(',');
    const longOp = 'N7:0' + ' '.repeat(10) + '1'.repeat(10_000);
    const extra =
      `,"name":"${'n'.repeat(10_000)}","dataFiles":[{"type":"O","number":0,"elements":4},{"type":"I","number":1,"elements":4},{"type":"S","number":2,"elements":96},{"type":"N","number":7,"elements":4},{"type":"N","number":1e9,"elements":4},{"type":"I","number":5,"elements":4}]` +
      `,"data":{"N7":[${Array(100_000).fill(1).join(',')}]}`;
    const r = parseProjectJson(projectJson(`${many},{"kind":"instr","mnemonic":"MOV","operands":["${longOp}","N7:0"]}`, extra));
    const p = r.project!;
    expect(p.name.length).toBe(IMPORT_LIMITS.nameChars);
    expect(p.data.N7.length).toBe(4);
    expect(p.dataFiles.map((f) => `${f.type}${f.number}`)).toEqual(['O0', 'I1', 'S2', 'N7']);
    expect(p.program.rungs[0].elements.length).toBeLessThanOrEqual(IMPORT_LIMITS.elements);
    expect(r.warnings.length).toBeLessThanOrEqual(IMPORT_LIMITS.warnings + 1);
  });

  it('rejects oversized files before parsing', () => {
    const r = parseProjectJson(' '.repeat(IMPORT_LIMITS.fileBytes + 1));
    expect(r.project).toBeNull();
    expect(r.errors[0]).toMatch(/too large/);
  });

  it('ignores prototype-polluting keys', () => {
    const r = parseProjectJson('{"format":"rungranger-project","data":{"__proto__":{"x":1}},"controller":{"__proto__":{"polluted":true}},"program":{"rungs":[]}}');
    expect(r.project).not.toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(r.project!.data)).toBe(Object.prototype);
  });

  it('rejects NaN/Infinity scan intervals (possible via structured-clone IndexedDB records)', () => {
    const p = newProject('x') as unknown as Record<string, unknown>;
    p.controller = { name: 'X', scanIntervalMs: Number.NaN };
    expect(importProject(p).project!.controller.scanIntervalMs).toBe(50);
  });

  it('rung text parser limits nesting depth and length', () => {
    expect(() => parseRungText('BST '.repeat(5000))).toThrow(RungTextError);
    expect(() => parseRungText('BST '.repeat(17) + 'XIC B3:0/0')).toThrow(/nested deeper/);
    expect(() => parseRungText('XIC B3:0/0 '.repeat(3000))).toThrow(/too long/);
  });

  it('a poisoned IndexedDB record does not break listing or loading other projects', async () => {
    const store = new IndexedDbProjectStore(indexedDB, `poison-${Math.random()}`);
    const good = newProject('Good');
    await store.save(good);
    // Simulate another page on the same origin writing a hostile record directly.
    const db: IDBDatabase = await new Promise((res, rej) => {
      const o = indexedDB.open((store as unknown as { dbName: string }).dbName, 1);
      o.onsuccess = () => res(o.result);
      o.onerror = () => rej(o.error);
    });
    const hostile = JSON.parse(projectJson(nested(200)));
    hostile.program.rungs.push("garbage", { elements: "x" });
    hostile.dataFiles = 42;
    hostile.id = 'evil';
    await new Promise<void>((res, rej) => {
      const tx = db.transaction('projects', 'readwrite');
      tx.objectStore('projects').put(hostile);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
    const list = await store.list();
    expect(list.map((p) => p.id)).toContain(good.id);
    expect((await store.load(good.id)).project?.name).toBe('Good');
    const evil = await store.load('evil');
    expect(() => validateProject(evil.project ?? good)).not.toThrow();
  });
});
