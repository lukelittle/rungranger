/**
 * Cross reference: where is each address used in the program?
 */
import { addressesOverlap, formatAddress, resolveAddress, type ResolvedAddress } from './address';
import { forEachInstruction } from './ast';
import { INSTRUCTIONS } from './instructions';
import { expandSymbol, symbolLookup } from './operands';
import type { Project } from './types';

export interface XrefEntry {
  rung: number;
  elementId: string;
  mnemonic: string;
  operandIndex: number;
  operandText: string;
  address: ResolvedAddress;
  canonical: string;
  access: 'read' | 'write' | 'read/write';
}

const WRITE_KINDS = new Set(['dest']);

function accessOf(mnemonic: string, operandIndex: number): XrefEntry['access'] {
  const info = INSTRUCTIONS[mnemonic as keyof typeof INSTRUCTIONS];
  const spec = info.operands[operandIndex];
  if (['OTE', 'OTL', 'OTU', 'RES'].includes(mnemonic)) return 'write';
  if (['TON', 'TOF', 'RTO', 'CTU', 'CTD'].includes(mnemonic)) return 'read/write';
  return WRITE_KINDS.has(spec.kind) ? 'write' : 'read';
}

export function buildXref(project: Project): XrefEntry[] {
  const out: XrefEntry[] = [];
  const lookup = symbolLookup(project.symbols);
  project.program.rungs.forEach((r, rung) => {
    forEachInstruction(r.elements, (ins) => {
      const info = INSTRUCTIONS[ins.mnemonic];
      if (!info) return;
      ins.operands.forEach((op, i) => {
        if (info.operands[i]?.kind === 'timebase') return;
        try {
          const a = resolveAddress(expandSymbol(op, lookup), project.dataFiles);
          out.push({ rung, elementId: ins.id, mnemonic: ins.mnemonic, operandIndex: i, operandText: op, address: a, canonical: formatAddress(a), access: accessOf(ins.mnemonic, i) });
        } catch {
          // constants and invalid operands are not cross-referenced
        }
      });
    });
  });
  return out;
}

/** Finds usages of an address or symbol (overlapping data counts: T4:0/DN matches T4:0). */
export function searchXref(project: Project, query: string, entries = buildXref(project)): XrefEntry[] | { error: string } {
  const q = expandSymbol(query, symbolLookup(project.symbols));
  let target: ResolvedAddress;
  try {
    target = resolveAddress(q, project.dataFiles);
  } catch (e) {
    return { error: (e as Error).message };
  }
  return entries.filter((e) => addressesOverlap(e.address, target));
}
