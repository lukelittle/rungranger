/**
 * Pure helpers for traversing and editing the ladder AST.
 * Every edit function returns a new structure and never mutates its input.
 */
import { newId } from './id';
import { INSTRUCTIONS } from './instructions';
import type { Branch, Element, Instruction, Mnemonic, Rung } from './types';

export function makeInstruction(mnemonic: Mnemonic, operands?: string[]): Instruction {
  const info = INSTRUCTIONS[mnemonic];
  const ops = operands ?? info.operands.map((o) => (o.kind === 'timebase' ? '1.0' : '?'));
  return { kind: 'instr', id: newId('i'), mnemonic, operands: ops };
}

export function makeBranch(legs: Element[][]): Branch {
  return { kind: 'branch', id: newId('b'), legs };
}

export function makeRung(elements: Element[] = [], comment = ''): Rung {
  return { id: newId('r'), comment, elements };
}

/** Visits every instruction in a series (depth-first, left to right, top leg first). */
export function forEachInstruction(series: Element[], fn: (instr: Instruction) => void): void {
  for (const el of series) {
    if (el.kind === 'instr') fn(el);
    else for (const leg of el.legs) forEachInstruction(leg, fn);
  }
}

export function instructionsOf(series: Element[]): Instruction[] {
  const out: Instruction[] = [];
  forEachInstruction(series, (i) => out.push(i));
  return out;
}

/** Ordered list of selectable element ids (branches before their contents). */
export function flattenIds(series: Element[]): string[] {
  const out: string[] = [];
  const walk = (s: Element[]) => {
    for (const el of s) {
      out.push(el.id);
      if (el.kind === 'branch') el.legs.forEach(walk);
    }
  };
  walk(series);
  return out;
}

export interface ElementLocation {
  element: Element;
  /** The series array containing the element. */
  series: Element[];
  index: number;
  /** Parent branch and leg index, if nested. */
  parent?: { branch: Branch; leg: number };
}

export function findElement(series: Element[], id: string, parent?: { branch: Branch; leg: number }): ElementLocation | null {
  for (let i = 0; i < series.length; i++) {
    const el = series[i];
    if (el.id === id) return { element: el, series, index: i, parent };
    if (el.kind === 'branch') {
      for (let l = 0; l < el.legs.length; l++) {
        const r = findElement(el.legs[l], id, { branch: el, leg: l });
        if (r) return r;
      }
    }
  }
  return null;
}

/** Deep clone with fresh ids (for copy/paste and duplication). */
export function cloneElement(el: Element): Element {
  if (el.kind === 'instr') return { ...el, id: newId('i'), operands: [...el.operands] };
  return { kind: 'branch', id: newId('b'), legs: el.legs.map((leg) => leg.map(cloneElement)) };
}

export function cloneRung(r: Rung): Rung {
  return { id: newId('r'), comment: r.comment, elements: r.elements.map(cloneElement) };
}

/** Rebuilds a series, applying `fn` to the series that directly contains `targetId` (or to the leg identified). */
type SeriesFn = (series: Element[]) => Element[];

function mapSeriesContaining(series: Element[], targetId: string, fn: SeriesFn): { result: Element[]; found: boolean } {
  if (series.some((e) => e.id === targetId)) return { result: fn(series), found: true };
  let found = false;
  const result = series.map((el) => {
    if (found || el.kind !== 'branch') return el;
    const legs = el.legs.map((leg) => {
      if (found) return leg;
      const r = mapSeriesContaining(leg, targetId, fn);
      if (r.found) found = true;
      return r.result;
    });
    return found ? { ...el, legs } : el;
  });
  return { result, found };
}

function mapBranch(series: Element[], branchId: string, fn: (b: Branch) => Element[]): { result: Element[]; found: boolean } {
  let found = false;
  const result: Element[] = [];
  for (const el of series) {
    if (found) {
      result.push(el);
      continue;
    }
    if (el.id === branchId && el.kind === 'branch') {
      found = true;
      result.push(...fn(el));
      continue;
    }
    if (el.kind === 'branch') {
      const legs = el.legs.map((leg) => {
        if (found) return leg;
        const r = mapBranch(leg, branchId, fn);
        if (r.found) found = true;
        return r.result;
      });
      result.push(found ? { ...el, legs } : el);
    } else {
      result.push(el);
    }
  }
  return { result, found };
}

/** Where to insert a new element. */
export type InsertTarget =
  | { type: 'after'; elementId: string }
  | { type: 'before'; elementId: string }
  | { type: 'leg'; branchId: string; leg: number } // append to end of a leg
  | { type: 'rung-auto' }; // inputs before trailing outputs, outputs at the end

export function isOutputElement(el: Element): boolean {
  if (el.kind === 'instr') return INSTRUCTIONS[el.mnemonic].role === 'output';
  // A branch whose legs all end in outputs is an output branch (parallel outputs).
  return el.legs.length > 0 && el.legs.every((leg) => leg.length > 0 && isOutputElement(leg[leg.length - 1]));
}

/** Index of the first element of the trailing run of output elements in a series. */
export function outputTailStart(series: Element[]): number {
  let i = series.length;
  while (i > 0 && isOutputElement(series[i - 1])) i--;
  return i;
}

export function insertElement(elements: Element[], target: InsertTarget, el: Element): Element[] {
  switch (target.type) {
    case 'rung-auto': {
      if (el.kind === 'instr' && INSTRUCTIONS[el.mnemonic].role === 'output') return [...elements, el];
      const at = outputTailStart(elements);
      return [...elements.slice(0, at), el, ...elements.slice(at)];
    }
    case 'after':
    case 'before': {
      const r = mapSeriesContaining(elements, target.elementId, (s) => {
        const i = s.findIndex((e) => e.id === target.elementId);
        const at = target.type === 'after' ? i + 1 : i;
        return [...s.slice(0, at), el, ...s.slice(at)];
      });
      return r.found ? r.result : elements;
    }
    case 'leg': {
      const r = mapBranch(elements, target.branchId, (b) => [
        { ...b, legs: b.legs.map((leg, i) => (i === target.leg ? [...leg, el] : leg)) },
      ]);
      return r.found ? r.result : elements;
    }
  }
}

/**
 * Removes an element. If a branch is left with a single leg, the branch is
 * dissolved and its remaining leg is spliced into the parent series.
 */
export function deleteElement(elements: Element[], id: string): Element[] {
  const r = mapSeriesContaining(elements, id, (s) => s.filter((e) => e.id !== id));
  return r.found ? r.result : elements;
}

export function replaceElement(elements: Element[], id: string, next: Element): Element[] {
  const r = mapSeriesContaining(elements, id, (s) => s.map((e) => (e.id === id ? next : e)));
  return r.found ? r.result : elements;
}

export function updateInstruction(elements: Element[], id: string, fn: (i: Instruction) => Instruction): Element[] {
  const loc = findElement(elements, id);
  if (!loc || loc.element.kind !== 'instr') return elements;
  return replaceElement(elements, id, fn(loc.element));
}

/** Wraps the given element in a new two-leg branch: [element] and an empty leg. */
export function wrapInBranch(elements: Element[], id: string): { elements: Element[]; branchId: string | null } {
  const loc = findElement(elements, id);
  if (!loc) return { elements, branchId: null };
  const b = makeBranch([[loc.element], []]);
  return { elements: replaceElement(elements, id, b), branchId: b.id };
}

/** Adds an empty leg to a branch (after `afterLeg`, or at the end). */
export function addLeg(elements: Element[], branchId: string, afterLeg?: number): Element[] {
  const r = mapBranch(elements, branchId, (b) => {
    const at = afterLeg === undefined ? b.legs.length : afterLeg + 1;
    return [{ ...b, legs: [...b.legs.slice(0, at), [], ...b.legs.slice(at)] }];
  });
  return r.found ? r.result : elements;
}

/** Removes a leg. A branch reduced to one leg is dissolved into its parent series. */
export function deleteLeg(elements: Element[], branchId: string, leg: number): Element[] {
  const r = mapBranch(elements, branchId, (b) => {
    const legs = b.legs.filter((_, i) => i !== leg);
    if (legs.length === 0) return [];
    if (legs.length === 1) return legs[0];
    return [{ ...b, legs }];
  });
  return r.found ? r.result : elements;
}

/** Removes the branch structure but keeps the contents of the first leg. */
export function unwrapBranch(elements: Element[], branchId: string): Element[] {
  const r = mapBranch(elements, branchId, (b) => b.legs[0] ?? []);
  return r.found ? r.result : elements;
}

/** Moves an element one position left (-1) or right (+1) within its series. */
export function moveElement(elements: Element[], id: string, dir: -1 | 1): Element[] {
  const r = mapSeriesContaining(elements, id, (s) => {
    const i = s.findIndex((e) => e.id === id);
    const j = i + dir;
    if (j < 0 || j >= s.length) return s;
    const copy = [...s];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    return copy;
  });
  return r.found ? r.result : elements;
}

export function countInstructions(rungs: Rung[]): number {
  return rungs.reduce((n, r) => n + instructionsOf(r.elements).length, 0);
}
