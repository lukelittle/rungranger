/**
 * Program verification: produces errors (which prevent running) and warnings.
 */
import { isValidSymbolName, resolveAddress, type ResolvedAddress } from './address';
import { isOutputElement } from './ast';
import { INSTRUCTIONS, isMnemonic } from './instructions';
import { checkOperand, symbolLookup } from './operands';
import { getDataValue } from './project';
import type { Element, Instruction, Project } from './types';

export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  severity: Severity;
  message: string;
  rung: number | null;
  elementId?: string;
}

export function validateProject(project: Project): Diagnostic[] {
  const out: Diagnostic[] = [];
  const files = project.dataFiles;
  const lookup = symbolLookup(project.symbols);
  const oteWriters = new Map<string, number[]>();
  const timerKinds = new Map<string, Set<string>>();

  // Data files
  const seen = new Set<string>();
  for (const f of files) {
    const k = `${f.type}${f.number}`;
    if (seen.has(k)) out.push({ severity: 'error', rung: null, message: `Data file ${k} is defined twice` });
    seen.add(k);
    if (!Number.isInteger(f.elements) || f.elements < 1) out.push({ severity: 'error', rung: null, message: `Data file ${k} must have at least one element` });
  }
  for (const req of ['O0', 'I1', 'S2']) {
    if (!seen.has(req)) out.push({ severity: 'error', rung: null, message: `Required data file ${req} is missing` });
  }

  // Symbols
  const symNames = new Set<string>();
  for (const s of project.symbols) {
    if (!s.symbol) continue;
    if (!isValidSymbolName(s.symbol)) out.push({ severity: 'warning', rung: null, message: `Symbol "${s.symbol}" is not a valid name (letters, digits and _, up to 20 characters, must not look like an address)` });
    const up = s.symbol.toUpperCase();
    if (symNames.has(up)) out.push({ severity: 'error', rung: null, message: `Symbol "${s.symbol}" is defined more than once` });
    symNames.add(up);
    try {
      resolveAddress(s.address, files);
    } catch (e) {
      out.push({ severity: 'warning', rung: null, message: `Symbol "${s.symbol}": ${(e as Error).message}` });
    }
  }

  // Forces
  for (const f of project.forces) {
    try {
      const a = resolveAddress(f.address, files);
      if ((a.type !== 'I' && a.type !== 'O') || a.bit === null) throw new Error('forces can only be applied to I/O bits');
    } catch (e) {
      out.push({ severity: 'warning', rung: null, message: `Force on ${f.address} ignored: ${(e as Error).message}` });
    }
  }

  const rungs = project.program.rungs;
  if (rungs.length === 0) out.push({ severity: 'warning', rung: null, message: 'The program has no rungs' });

  const checkSeries = (series: Element[], rung: number, topLevel: boolean) => {
    let sawOutput = false;
    for (const el of series) {
      const isOut = isOutputElement(el);
      if (sawOutput && !isOut) {
        out.push({ severity: 'error', rung, elementId: el.id, message: 'An input instruction or branch follows an output instruction on the same path' });
      }
      if (isOut) sawOutput = true;
      if (el.kind === 'branch') {
        if (el.legs.length < 2) out.push({ severity: 'error', rung, elementId: el.id, message: 'A branch must have at least two legs' });
        el.legs.forEach((leg) => {
          if (leg.length === 0 && !isOut) {
            out.push({ severity: 'info', rung, elementId: el.id, message: 'Branch has an empty leg, which bypasses (shorts) the other legs' });
          }
          checkSeries(leg, rung, false);
        });
      } else {
        checkInstruction(el, rung);
      }
    }
    if (topLevel && !series.some((e) => containsOutput(e))) {
      out.push({ severity: 'error', rung, message: 'Rung has no output instruction' });
    }
  };

  const checkInstruction = (ins: Instruction, rung: number) => {
    if (!isMnemonic(ins.mnemonic)) {
      out.push({ severity: 'error', rung, elementId: ins.id, message: `Unknown instruction "${ins.mnemonic}"` });
      return;
    }
    const info = INSTRUCTIONS[ins.mnemonic];
    if (ins.operands.length !== info.operands.length) {
      out.push({ severity: 'error', rung, elementId: ins.id, message: `${ins.mnemonic} expects ${info.operands.length} operand(s)` });
      return;
    }
    const resolved: (ResolvedAddress | null)[] = [];
    info.operands.forEach((spec, i) => {
      const r = checkOperand(spec.kind, ins.operands[i], files, lookup);
      if (!r.ok) {
        out.push({ severity: 'error', rung, elementId: ins.id, message: `${ins.mnemonic} ${spec.name}: ${r.error}` });
        resolved.push(null);
      } else resolved.push(r.type === 'address' ? r.address : null);
    });

    const a0 = resolved[0];
    if (['OTE', 'OTL', 'OTU'].includes(ins.mnemonic) && a0) {
      if (a0.type === 'I') out.push({ severity: 'warning', rung, elementId: ins.id, message: `${ins.mnemonic} writes to input image ${ins.operands[0]}; it will be overwritten by the next input scan` });
      if (a0.type === 'S') out.push({ severity: 'info', rung, elementId: ins.id, message: `${ins.mnemonic} writes to status file bit ${ins.operands[0]}` });
      if (ins.mnemonic === 'OTE') {
        const key = `${a0.key}:${a0.word}/${a0.bit}`;
        oteWriters.set(key, [...(oteWriters.get(key) ?? []), rung]);
      }
    }
    const dest = info.operands.findIndex((o) => o.kind === 'dest');
    if (dest >= 0 && resolved[dest]?.type === 'I') {
      out.push({ severity: 'warning', rung, elementId: ins.id, message: `${ins.mnemonic} writes to input image ${ins.operands[dest]}; it will be overwritten by the next input scan` });
    }
    if (['TON', 'TOF', 'RTO'].includes(ins.mnemonic) && a0) {
      const key = `${a0.key}:${a0.element}`;
      const set = timerKinds.get(key) ?? new Set();
      set.add(ins.mnemonic);
      timerKinds.set(key, set);
      try {
        const pre = getDataValue(project, `${ins.operands[0]}.PRE`);
        if (pre < 0) out.push({ severity: 'error', rung, elementId: ins.id, message: `${ins.operands[0]} has a negative preset (${pre}); this would fault the processor` });
        else if (pre === 0) out.push({ severity: 'warning', rung, elementId: ins.id, message: `${ins.operands[0]} preset is 0; the timer will be done immediately` });
      } catch {
        // address errors already reported
      }
    }
    if ((ins.mnemonic === 'CTU' || ins.mnemonic === 'CTD') && a0) {
      try {
        const pre = getDataValue(project, `${ins.operands[0]}.PRE`);
        if (pre === 0 && ins.mnemonic === 'CTU') out.push({ severity: 'info', rung, elementId: ins.id, message: `${ins.operands[0]} preset is 0; DN will be set immediately` });
      } catch {
        // already reported
      }
    }
  };

  rungs.forEach((r, i) => {
    if (r.elements.length === 0) {
      out.push({ severity: 'error', rung: i, message: 'Rung is empty' });
      return;
    }
    checkSeries(r.elements, i, true);
  });

  for (const [key, rungList] of oteWriters) {
    if (rungList.length > 1) {
      out.push({
        severity: 'warning',
        rung: rungList[rungList.length - 1],
        message: `Duplicate destructive bit: OTE to the same bit (${key.replace(/^(\w+):(\d+)\/(\d+)$/, '$1 word $2 bit $3')}) on rungs ${rungList.join(', ')}. Only the last one scanned takes effect.`,
      });
    }
  }
  for (const [key, kinds] of timerKinds) {
    if (kinds.size > 1) out.push({ severity: 'warning', rung: null, message: `Timer ${key.replace(':', ' element ')} is used by different timer types (${[...kinds].join(', ')})` });
  }
  return out;
}

function containsOutput(el: Element): boolean {
  if (el.kind === 'instr') return INSTRUCTIONS[el.mnemonic]?.role === 'output';
  return el.legs.some((leg) => leg.some(containsOutput));
}

export function hasErrors(diags: Diagnostic[]): boolean {
  return diags.some((d) => d.severity === 'error');
}
