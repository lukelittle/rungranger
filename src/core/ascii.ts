/**
 * Mnemonic ("ASCII") rung text, a widely used plain-text notation for ladder rungs:
 *
 *   XIC I:1/0 BST XIC O:2/0 NXB XIC B3:0/0 BND XIO I:1/1 OTE O:2/0
 *
 * BST starts a branch, NXB starts the next leg, BND ends the branch.
 * Timers and counters carry their preset and accumulator inline:
 *   TON T4:0 1.0 5 0     CTU C5:0 10 0
 * (the preset and accumulator values are optional when parsing).
 */
import { makeBranch, makeInstruction } from './ast';
import { INSTRUCTIONS, isMnemonic } from './instructions';
import type { Element } from './types';

export interface DataWrite {
  address: string;
  value: number;
}

export interface ParsedRungText {
  elements: Element[];
  dataWrites: DataWrite[];
}

export class RungTextError extends Error {}

export function parseRungText(text: string): ParsedRungText {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  let pos = 0;
  const dataWrites: DataWrite[] = [];

  const MAX_DEPTH = 16;
  if (tokens.length > 5000) throw new RungTextError('Rung text is too long (limit 5000 tokens)');
  let depth = 0;
  const parseSeries = (inBranch: boolean): Element[] => {
    const series: Element[] = [];
    while (pos < tokens.length) {
      const tok = tokens[pos].toUpperCase();
      if (tok === 'NXB' || tok === 'BND') {
        if (!inBranch) throw new RungTextError(`Unexpected ${tok} outside of a branch (token ${pos + 1})`);
        return series;
      }
      if (tok === 'BST') {
        if (++depth > MAX_DEPTH) throw new RungTextError(`Branches nested deeper than ${MAX_DEPTH} levels are not supported`);
        pos++;
        const legs: Element[][] = [parseSeries(true)];
        while (pos < tokens.length && tokens[pos].toUpperCase() === 'NXB') {
          pos++;
          legs.push(parseSeries(true));
        }
        if (pos >= tokens.length || tokens[pos].toUpperCase() !== 'BND') throw new RungTextError('Branch started with BST is missing BND');
        pos++;
        if (legs.length < 2) throw new RungTextError('A branch needs at least two legs (use NXB)');
        depth--;
        series.push(makeBranch(legs));
        continue;
      }
      if (!isMnemonic(tok)) throw new RungTextError(`Unknown instruction "${tokens[pos]}" (token ${pos + 1})`);
      const info = INSTRUCTIONS[tok];
      const isStructural = (t: string | undefined) => t !== undefined && ['BST', 'NXB', 'BND'].includes(t.toUpperCase());
      const required = info.operands.length;
      const ops = tokens.slice(pos + 1, pos + 1 + required);
      if (ops.length < required || ops.some(isStructural)) {
        throw new RungTextError(`${tok} needs ${required} operand${required === 1 ? '' : 's'}`);
      }
      pos += 1 + required;
      // Optional inline data values (timer/counter preset and accumulator).
      for (const f of info.dataFields ?? []) {
        const v = tokens[pos];
        if (v === undefined || !(v === '?' || /^[-+]?\d+(\.\d+)?$/.test(v))) break;
        pos++;
        if (v !== '?' && ops[0] !== '?') dataWrites.push({ address: `${ops[0]}.${f.member}`, value: Number(v) });
      }
      series.push(makeInstruction(tok, ops));
    }
    if (inBranch) throw new RungTextError('Branch started with BST is missing BND');
    return series;
  };

  const elements = parseSeries(false);
  return { elements, dataWrites };
}

/** Formats a series as rung text. `dataValue` supplies timer/counter preset and accumulator values. */
export function formatRungText(series: Element[], dataValue?: (address: string) => number | undefined): string {
  const parts: string[] = [];
  const walk = (s: Element[]) => {
    for (const el of s) {
      if (el.kind === 'branch') {
        parts.push('BST');
        el.legs.forEach((leg, i) => {
          if (i > 0) parts.push('NXB');
          walk(leg);
        });
        parts.push('BND');
      } else {
        parts.push(el.mnemonic, ...el.operands.map((o) => o || '?'));
        const info = INSTRUCTIONS[el.mnemonic];
        for (const f of info.dataFields ?? []) {
          const v = dataValue?.(`${el.operands[0]}.${f.member}`);
          parts.push(v === undefined ? '?' : String(v));
        }
      }
    }
  };
  walk(series);
  return parts.join(' ');
}
