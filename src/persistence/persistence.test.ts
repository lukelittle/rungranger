import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { newProject } from '../core/project';
import { createExample } from '../examples';
import { IndexedDbProjectStore, MemoryProjectStore } from './indexeddb';
import { exportProjectJson, importProject, parseProjectJson } from './schema';

describe('schema import/export', () => {
  it('round-trips an example project losslessly', () => {
    const p = createExample('conveyor');
    const r = parseProjectJson(exportProjectJson(p));
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.project).toEqual(p);
  });

  it('rejects non-JSON and non-project files', () => {
    expect(parseProjectJson('{oops').errors[0]).toMatch(/not valid JSON/);
    expect(parseProjectJson('[1,2]').project).toBeNull();
    expect(parseProjectJson('{"hello":1}').project).toBeNull();
  });

  it('recovers what it can from a damaged project', () => {
    const p = createExample('motor-starter') as unknown as Record<string, unknown>;
    const damaged = JSON.parse(JSON.stringify(p));
    damaged.program.rungs[0].elements.push({ kind: 'instr', mnemonic: 'JSR', operands: ['U:3'] });
    damaged.program.rungs[1].elements[0].operands = [];
    damaged.program.rungs.push('garbage');
    damaged.dataFiles = damaged.dataFiles.filter((f: { type: string }) => f.type !== 'S');
    damaged.dataFiles.push({ type: 'Q', number: 9, elements: 3 });
    damaged.controller.scanIntervalMs = -4;
    damaged.symbols.push(42);
    damaged.program.rungs[2].id = damaged.program.rungs[3].id;
    const r = importProject(damaged);
    expect(r.project).not.toBeNull();
    const w = r.warnings.join('\n');
    expect(w).toMatch(/unknown instruction "JSR"/);
    expect(w).toMatch(/adjusted to 1/);
    expect(w).toMatch(/Dropped rung/);
    expect(w).toMatch(/Restored missing required data file S2/);
    expect(w).toMatch(/invalid data file/);
    expect(w).toMatch(/Scan interval/);
    expect(w).toMatch(/duplicate element id/);
    expect(r.project!.program.rungs.length).toBe(7);
    expect(r.project!.program.rungs[1].elements[0]).toMatchObject({ mnemonic: 'XIC', operands: ['?'] });
    const ids = new Set(r.project!.program.rungs.map((x) => x.id));
    expect(ids.size).toBe(7);
  });

  it('flattens single-leg branches and keeps unknown-version projects', () => {
    const p = JSON.parse(exportProjectJson(newProject('x')));
    p.schemaVersion = 99;
    p.program.rungs[0].elements = [{ kind: 'branch', legs: [[{ kind: 'instr', mnemonic: 'xic', operands: ['B3:0/0'] }]] }];
    const r = importProject(p);
    expect(r.warnings.join()).toMatch(/newer version/);
    expect(r.project!.program.rungs[0].elements[0]).toMatchObject({ kind: 'instr', mnemonic: 'XIC' });
  });
});

describe.each([
  ['IndexedDB', () => new IndexedDbProjectStore(indexedDB, `test-${Math.random()}`)],
  ['memory', () => new MemoryProjectStore()],
])('%s project store', (_name, make) => {
  it('saves, lists, loads, and deletes projects', async () => {
    const store = make();
    const a = createExample('tank');
    const b = newProject('Second');
    b.modifiedAt = new Date(Date.now() + 1000).toISOString();
    await store.save(a);
    await store.save(b);
    const list = await store.list();
    expect(list.map((x) => x.name)).toEqual(['Second', 'Tank Fill Control']);
    const loaded = await store.load(a.id);
    expect(loaded.project).toEqual(a);
    await store.delete(a.id);
    expect((await store.list()).length).toBe(1);
    expect((await store.load(a.id)).project).toBeNull();
  });

  it('stores settings', async () => {
    const store = make();
    await store.setSetting('lastProject', 'abc');
    expect(await store.getSetting('lastProject')).toBe('abc');
    expect(await store.getSetting('missing')).toBeUndefined();
  });
});
