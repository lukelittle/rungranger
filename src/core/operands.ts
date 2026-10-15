/**
 * Operand checking shared by the validator, compiler and editor.
 */
import { AddressError, FILE_TYPE_NAMES, isNumericConstant, resolveAddress, type ResolvedAddress } from './address';
import { timeBaseMs, type OperandKind } from './instructions';
import type { DataFileDef, SymbolDef } from './types';

export type CheckedOperand =
  | { ok: true; type: 'address'; address: ResolvedAddress; text: string }
  | { ok: true; type: 'constant'; value: number; text: string }
  | { ok: true; type: 'timebase'; ms: number; text: string }
  | { ok: false; error: string; text: string };

export type SymbolLookup = (name: string) => string | undefined;

export function symbolLookup(symbols: SymbolDef[]): SymbolLookup {
  const map = new Map(symbols.map((s) => [s.symbol.toUpperCase(), s.address]));
  return (name) => map.get(name.trim().toUpperCase());
}

/** Replaces a symbol name with its address; returns the text unchanged otherwise. */
export function expandSymbol(text: string, lookup?: SymbolLookup): string {
  const t = text.trim();
  return lookup?.(t) ?? t;
}

export function checkOperand(kind: OperandKind, raw: string, files: DataFileDef[], lookup?: SymbolLookup): CheckedOperand {
  const text = expandSymbol(raw ?? '', lookup);
  if (text === '' || text === '?') return { ok: false, error: 'operand is missing', text };

  if (kind === 'timebase') {
    const ms = timeBaseMs(text);
    if (ms === null) return { ok: false, error: `time base must be 1.0 or 0.01 (got "${text}")`, text };
    return { ok: true, type: 'timebase', ms, text };
  }

  if (isNumericConstant(text)) {
    if (kind !== 'source') return { ok: false, error: `a constant (${text}) is not allowed here; an address is required`, text };
    const value = Number(text);
    return { ok: true, type: 'constant', value, text };
  }

  let a: ResolvedAddress;
  try {
    a = resolveAddress(text, files);
  } catch (e) {
    const msg = e instanceof AddressError ? e.message : String(e);
    return { ok: false, error: lookup ? `${msg} (and is not a defined symbol)` : msg, text };
  }

  const fail = (error: string): CheckedOperand => ({ ok: false, error, text });
  switch (kind) {
    case 'bit':
      if (a.kind !== 'bit') return fail(`"${text}" is not a bit address (e.g. B3:0/0, I:1/0, T4:0/DN)`);
      break;
    case 'source':
    case 'dest':
      if (a.kind !== 'word') {
        return fail(`"${text}" must be a word address (e.g. N7:0, F8:1, T4:0.ACC)${a.kind === 'element' ? '' : '; bit addresses are not allowed here'}`);
      }
      break;
    case 'timer':
      if (a.type !== 'T' || a.kind !== 'element') return fail(`"${text}" must be a timer element (e.g. T4:0)`);
      break;
    case 'counter':
      if (a.type !== 'C' || a.kind !== 'element') return fail(`"${text}" must be a counter element (e.g. C5:0)`);
      break;
    case 'resettable':
      if (!['T', 'C', 'R'].includes(a.type) || a.kind !== 'element') {
        return fail(`"${text}" must be a timer, counter or control element (e.g. T4:0, C5:0, R6:0), not a ${FILE_TYPE_NAMES[a.type].toLowerCase()} address`);
      }
      break;
  }
  return { ok: true, type: 'address', address: a, text };
}
