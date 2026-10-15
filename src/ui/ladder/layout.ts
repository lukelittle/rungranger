/**
 * Pure geometry for the SVG ladder: sizes of instructions, series and branches.
 */
import { outputTailStart } from '../../core/ast';
import { INSTRUCTIONS } from '../../core/instructions';
import type { Element, Instruction } from '../../core/types';

export const WIRE_Y = 46; // wire height within a row
export const BIT_W = 92;
export const BOX_W = 184;
export const ROW_MIN_H = 76;
export const EMPTY_LEG_W = 44;
export const BR_PAD = 14;
export const BOX_TOP = 30; // y of box top within its row
export const BOX_HEADER = 20;
export const BOX_LINE = 15;

export function boxLines(ins: Instruction): number {
  const info = INSTRUCTIONS[ins.mnemonic];
  return info.operands.length + (info.dataFields?.length ?? 0);
}

export function boxHeight(ins: Instruction): number {
  return BOX_HEADER + boxLines(ins) * BOX_LINE + 6;
}

export interface Size {
  w: number;
  h: number;
}

export function instrSize(ins: Instruction): Size {
  const info = INSTRUCTIONS[ins.mnemonic];
  if (!info?.box) return { w: BIT_W, h: ROW_MIN_H };
  return { w: BOX_W + (info.role === 'output' && hasStatusBits(ins) ? 40 : 0), h: Math.max(ROW_MIN_H, BOX_TOP + boxHeight(ins) + 10) };
}

export function hasStatusBits(ins: Instruction): boolean {
  return ['TON', 'TOF', 'RTO', 'CTU', 'CTD'].includes(ins.mnemonic);
}

export function elementSize(el: Element): Size {
  if (el.kind === 'instr') return instrSize(el);
  let w = 0;
  let h = 0;
  for (const leg of el.legs) {
    const s = seriesSize(leg);
    w = Math.max(w, s.w);
    h += s.h;
  }
  return { w: w + BR_PAD * 2, h };
}

export function seriesSize(series: Element[]): Size {
  if (series.length === 0) return { w: EMPTY_LEG_W, h: ROW_MIN_H - 10 };
  let w = 0;
  let h = 0;
  for (const el of series) {
    const s = elementSize(el);
    w += s.w;
    h = Math.max(h, s.h);
  }
  return { w, h };
}

/** Splits a rung's top-level series into the input part and the right-justified output tail. */
export function splitRung(elements: Element[]): { inputs: Element[]; outputs: Element[] } {
  const at = outputTailStart(elements);
  return { inputs: elements.slice(0, at), outputs: elements.slice(at) };
}
