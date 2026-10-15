import { describe, expect, it } from 'vitest';
import { formatRungText, parseRungText, RungTextError } from './ascii';
import { addLeg, deleteElement, deleteLeg, findElement, flattenIds, insertElement, makeInstruction, makeRung, moveElement, unwrapBranch, wrapInBranch } from './ast';
import { getDataValue, newProject, setDataValue } from './project';
import { validateProject } from './validate';
import { buildXref, searchXref } from './xref';
import type { Element, Instruction, Project } from './types';

const text = (els: Element[]) => formatRungText(els);

describe('rung text', () => {
  it('parses and formats branches and timers', () => {
    const src = 'XIC I:1/0 BST XIC O:2/0 NXB XIC B3:0/0 BND XIO I:1/1 OTE O:2/0';
    const r = parseRungText(src);
    expect(text(r.elements)).toBe(src);
    const t = parseRungText('XIC B3:0/0 TON T4:0 1.0 50 3');
    expect(t.dataWrites).toEqual([
      { address: 'T4:0.PRE', value: 50 },
      { address: 'T4:0.ACC', value: 3 },
    ]);
    expect(formatRungText(t.elements, (a) => (a.endsWith('PRE') ? 50 : 3))).toBe('XIC B3:0/0 TON T4:0 1.0 50 3');
  });

  it('reports errors', () => {
    expect(() => parseRungText('XIC')).toThrow(RungTextError);
    expect(() => parseRungText('FOO B3:0/0')).toThrow(/Unknown instruction/);
    expect(() => parseRungText('BST XIC B3:0/0 BND OTE B3:0/1')).toThrow(/two legs/);
    expect(() => parseRungText('BST XIC B3:0/0 NXB XIC B3:0/1 OTE B3:0/1')).toThrow(/missing BND/);
    expect(() => parseRungText('NXB')).toThrow(/outside/);
  });
});

describe('AST editing', () => {
  const base = () => parseRungText('XIC B3:0/0 XIC B3:0/1 OTE B3:0/2').elements;

  it('inserts inputs before trailing outputs with rung-auto', () => {
    const els = insertElement(base(), { type: 'rung-auto' }, makeInstruction('XIO', ['B3:0/3']));
    expect(text(els)).toBe('XIC B3:0/0 XIC B3:0/1 XIO B3:0/3 OTE B3:0/2');
    const els2 = insertElement(els, { type: 'rung-auto' }, makeInstruction('OTL', ['B3:0/4']));
    expect(text(els2)).toBe('XIC B3:0/0 XIC B3:0/1 XIO B3:0/3 OTE B3:0/2 OTL B3:0/4');
  });

  it('inserts after and before an element, without mutating the input', () => {
    const els = base();
    const before = text(els);
    const out = insertElement(els, { type: 'after', elementId: els[0].id }, makeInstruction('XIO', ['B3:1/0']));
    expect(text(out)).toBe('XIC B3:0/0 XIO B3:1/0 XIC B3:0/1 OTE B3:0/2');
    expect(text(els)).toBe(before);
    expect(text(insertElement(els, { type: 'before', elementId: els[0].id }, makeInstruction('XIO', ['B3:1/0'])))).toBe(
      'XIO B3:1/0 XIC B3:0/0 XIC B3:0/1 OTE B3:0/2',
    );
  });

  it('wraps in a branch, adds legs, inserts into legs, deletes', () => {
    let els = base();
    const w = wrapInBranch(els, els[1].id);
    els = w.elements;
    expect(text(els)).toBe('XIC B3:0/0 BST XIC B3:0/1 NXB BND OTE B3:0/2');
    els = insertElement(els, { type: 'leg', branchId: w.branchId!, leg: 1 }, makeInstruction('XIC', ['B3:0/5']));
    expect(text(els)).toBe('XIC B3:0/0 BST XIC B3:0/1 NXB XIC B3:0/5 BND OTE B3:0/2');
    els = addLeg(els, w.branchId!);
    expect(text(els)).toBe('XIC B3:0/0 BST XIC B3:0/1 NXB XIC B3:0/5 NXB BND OTE B3:0/2');
    els = deleteLeg(els, w.branchId!, 2);
    els = deleteLeg(els, w.branchId!, 0);
    expect(text(els)).toBe('XIC B3:0/0 XIC B3:0/5 OTE B3:0/2');
    els = deleteElement(els, els[1].id);
    expect(text(els)).toBe('XIC B3:0/0 OTE B3:0/2');
  });

  it('finds nested elements, flattens ids, moves and unwraps', () => {
    const els = parseRungText('XIC B3:0/0 BST XIC B3:0/1 NXB XIC B3:0/2 BND OTE B3:0/3').elements;
    const nested = (els[1] as { legs: Element[][] }).legs[1][0];
    const loc = findElement(els, nested.id)!;
    expect(loc.parent?.leg).toBe(1);
    expect(flattenIds(els)).toHaveLength(5);
    expect(text(moveElement(els, els[0].id, 1))).toBe('BST XIC B3:0/1 NXB XIC B3:0/2 BND XIC B3:0/0 OTE B3:0/3');
    expect(text(unwrapBranch(els, els[1].id))).toBe('XIC B3:0/0 XIC B3:0/1 OTE B3:0/3');
  });
});

function proj(lines: string[]): Project {
  const p = newProject('t');
  p.program.rungs = lines.map((l) => makeRung(parseRungText(l).elements));
  return p;
}

describe('validation', () => {
  const msgs = (p: Project) => validateProject(p).map((d) => `${d.severity}: ${d.message}`);

  it('accepts a good program', () => {
    expect(validateProject(proj(['XIC I:1/0 OTE O:2/0'])).filter((d) => d.severity !== 'info')).toEqual([]);
  });

  it('reports operand and structure errors', () => {
    const p = proj(['XIC N7:0 OTE O:2/0', 'XIC B3:0/0', '', 'OTE O:2/0 XIC B3:0/0', 'MOV B3:0/0 5', 'TON N7:0 2.0', 'XIC ? OTE O:9/0']);
    const m = msgs(p).join('\n');
    expect(m).toMatch(/"N7:0" is not a bit address/);
    expect(m).toMatch(/Rung has no output instruction/);
    expect(m).toMatch(/Rung is empty/);
    expect(m).toMatch(/follows an output/);
    expect(m).toMatch(/constant \(5\) is not allowed/);
    expect(m).toMatch(/must be a word address/);
    expect(m).toMatch(/must be a timer element/);
    expect(m).toMatch(/time base must be/);
    expect(m).toMatch(/operand is missing/);
    expect(m).toMatch(/out of range/);
  });

  it('warns about duplicate OTE and writing inputs; errors on negative preset', () => {
    const p = proj(['XIC B3:0/0 OTE O:2/0', 'XIC B3:0/1 OTE O:2/0', 'OTE I:1/0', 'TON T4:0 1.0']);
    p.data = setDataValue(p, 'T4:0.PRE', -5);
    const m = msgs(p).join('\n');
    expect(m).toMatch(/warning: Duplicate destructive bit/);
    expect(m).toMatch(/warning: OTE writes to input image/);
    expect(m).toMatch(/error: T4:0 has a negative preset/);
  });

  it('resolves symbols', () => {
    const p = proj(['XIC START OTE MOTOR']);
    expect(msgs(p).join()).toMatch(/is not a valid address/);
    p.symbols = [
      { address: 'I:1/0', symbol: 'START', description: '' },
      { address: 'O:2/0', symbol: 'MOTOR', description: '' },
    ];
    expect(validateProject(p).filter((d) => d.severity === 'error')).toEqual([]);
  });
});

describe('cross reference and data helpers', () => {
  it('finds overlapping usages', () => {
    const p = proj(['XIC T4:0/DN OTE O:2/0', 'XIC I:1/0 TON T4:0 1.0', 'XIC B3:0/0 RES T4:0', 'MOV T4:0.ACC N7:0']);
    expect(buildXref(p).length).toBe(8);
    const r = searchXref(p, 'T4:0');
    expect(Array.isArray(r) && r.map((e) => `${e.rung}:${e.mnemonic}:${e.access}`)).toEqual(['0:XIC:read', '1:TON:read/write', '2:RES:write', '3:MOV:read']);
    const r2 = searchXref(p, 'N7:0');
    expect(Array.isArray(r2) && r2[0].access).toBe('write');
    expect(searchXref(p, 'Q9:0')).toHaveProperty('error');
  });

  it('sets and gets data values by address', () => {
    const p = newProject('d');
    p.data = setDataValue(p, 'B3:1/15', 1);
    expect(p.data.B3).toEqual([0, -32768]);
    expect(getDataValue(p, 'B3/31')).toBe(1);
    p.data = setDataValue(p, 'N7:2', 99999);
    expect(getDataValue(p, 'N7:2')).toBe(32767);
    const i = makeInstruction('TON') as Instruction;
    expect(i.operands).toEqual(['?', '1.0']);
  });
});
