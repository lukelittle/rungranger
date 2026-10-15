/**
 * Classic file-based PLC address parsing and resolution.
 *
 * Supported forms (case-insensitive):
 *   I:1/0  I:1.0/0  I:1  O:2/3  I1:1/0  O0:2/3     (I/O: element = slot, one 16-bit word per slot)
 *   S:1/15  S2:1/15  S:4                            (status file, partially simulated)
 *   B3:0/5  B3/21  B3:2                             (binary file; B3/21 is flat bit addressing)
 *   T4:0  T4:0.ACC  T4:0.PRE  T4:0/DN  T4:0.DN      (timer element, word or bit)
 *   C5:0  C5:0.ACC  C5:0/CU ...                     (counter)
 *   R6:0  R6:0.LEN  R6:0/DN ...                     (control)
 *   N7:0  N7:0/3                                    (integer word or bit)
 *   F8:0                                            (floating point)
 */
import type { DataFileDef, FileType } from './types';

export const FILE_TYPE_NAMES: Record<FileType, string> = {
  O: 'Output',
  I: 'Input',
  S: 'Status',
  B: 'Binary',
  T: 'Timer',
  C: 'Counter',
  R: 'Control',
  N: 'Integer',
  F: 'Float',
};

/** Words of storage per element. Timer, counter and control elements are three words. */
export function wordsPerElement(type: FileType): number {
  return type === 'T' || type === 'C' || type === 'R' ? 3 : 1;
}

/** Fixed file numbers for the system files. */
export const FIXED_FILE_NUMBERS: Partial<Record<FileType, number>> = { O: 0, I: 1, S: 2 };

/** Named words inside structured elements: offset within the element. */
export const STRUCT_WORDS: Partial<Record<FileType, Record<string, number>>> = {
  T: { PRE: 1, ACC: 2 },
  C: { PRE: 1, ACC: 2 },
  R: { LEN: 1, POS: 2 },
};

/** Named status bits inside the control word (word 0) of structured elements. */
export const STRUCT_BITS: Partial<Record<FileType, Record<string, number>>> = {
  T: { EN: 15, TT: 14, DN: 13 },
  C: { CU: 15, CD: 14, DN: 13, OV: 12, UN: 11, UA: 10 },
  R: { EN: 15, EU: 14, DN: 13, EM: 12, ER: 11, UL: 10, IN: 9, FD: 8 },
};

export function fileKey(type: FileType, number: number): string {
  return `${type}${number}`;
}

export function fileKeyOf(def: DataFileDef): string {
  return fileKey(def.type, def.number);
}

/** Display name of a file, e.g. "I1", "B3". */
export function fileDisplayName(def: DataFileDef): string {
  return `${def.type}${def.number}`;
}

/** Address kinds after resolution. */
export type AddressKind = 'bit' | 'word' | 'element';

export interface ParsedAddress {
  type: FileType;
  file: number;
  /** Element number (slot for I/O). */
  element: number;
  /** Word offset within the element (0 for single-word elements). */
  wordOffset: number;
  /** Bit number within the word, or null for word/element addresses. */
  bit: number | null;
  kind: AddressKind;
  /** Named member (e.g. "ACC", "DN") if one was used. */
  member?: string;
}

export interface ResolvedAddress extends ParsedAddress {
  key: string;
  /** Absolute word index in the file's storage. */
  word: number;
  isFloat: boolean;
}

export class AddressError extends Error {}

const ADDRESS_RE = /^([OISBTCRNF])(\d{0,3})(?::(\d{1,4})(?:\.(\d{1,2}|[A-Z]{2,3}))?)?(?:\/(\d{1,5}|[A-Z]{2}))?$/;

/** Quick check whether a string looks like a data table address (not a constant or symbol). */
export function looksLikeAddress(text: string): boolean {
  return ADDRESS_RE.test(text.trim().toUpperCase());
}

/**
 * Parses an address syntactically. Throws AddressError with a readable message.
 * Does not check the address against configured file sizes; use resolveAddress for that.
 */
export function parseAddress(raw: string): ParsedAddress {
  const text = raw.trim().toUpperCase();
  const m = ADDRESS_RE.exec(text);
  if (!m) throw new AddressError(`"${raw}" is not a valid address`);
  const type = m[1] as FileType;
  const fileText = m[2];
  const elementText = m[3];
  const subText = m[4];
  const bitText = m[5];

  const fixed = FIXED_FILE_NUMBERS[type];
  let file: number;
  if (fileText === '') {
    if (fixed === undefined) throw new AddressError(`"${raw}": file number required (e.g. ${type}${defaultNumberFor(type)}:0)`);
    file = fixed;
  } else {
    file = Number(fileText);
    if (fixed !== undefined && file !== fixed) {
      throw new AddressError(`"${raw}": ${FILE_TYPE_NAMES[type]} file is always file ${fixed}`);
    }
    if (fixed === undefined && (file < 3 || file > 255)) {
      throw new AddressError(`"${raw}": data file numbers must be 3 to 255`);
    }
  }

  // Flat bit addressing: B3/21
  if (elementText === undefined) {
    if (bitText === undefined) throw new AddressError(`"${raw}": element number required`);
    if (type !== 'B') throw new AddressError(`"${raw}": flat bit addressing (${type}${file}/n) is only valid for binary files`);
    if (!/^\d+$/.test(bitText)) throw new AddressError(`"${raw}": invalid bit number`);
    const n = Number(bitText);
    return { type, file, element: Math.floor(n / 16), wordOffset: 0, bit: n % 16, kind: 'bit' };
  }

  const element = Number(elementText);
  const structWords = STRUCT_WORDS[type];
  const structBits = STRUCT_BITS[type];

  if (structWords && structBits) {
    // Timer / counter / control
    let wordOffset = 0;
    let bit: number | null = null;
    let member: string | undefined;
    let kind: AddressKind = 'element';
    if (subText !== undefined) {
      if (/^\d+$/.test(subText)) {
        wordOffset = Number(subText);
        if (wordOffset > 2) throw new AddressError(`"${raw}": word must be 0-2`);
        kind = 'word';
      } else if (subText in structWords) {
        wordOffset = structWords[subText];
        member = subText;
        kind = 'word';
      } else if (subText in structBits) {
        bit = structBits[subText];
        member = subText;
        kind = 'bit';
      } else {
        throw new AddressError(`"${raw}": unknown member .${subText} for ${FILE_TYPE_NAMES[type]} file`);
      }
    }
    if (bitText !== undefined) {
      if (kind === 'bit') throw new AddressError(`"${raw}": cannot combine two bit selectors`);
      if (/^\d+$/.test(bitText)) {
        const b = Number(bitText);
        if (b > 15) throw new AddressError(`"${raw}": bit number must be 0-15`);
        bit = b;
      } else if (bitText in structBits) {
        if (wordOffset !== 0) throw new AddressError(`"${raw}": /${bitText} is a status bit of word 0`);
        bit = structBits[bitText];
        member = bitText;
      } else {
        throw new AddressError(`"${raw}": unknown bit /${bitText} for ${FILE_TYPE_NAMES[type]} file`);
      }
      kind = 'bit';
    }
    return { type, file, element, wordOffset, bit, kind, member };
  }

  // Single-word element types: O I S B N F
  let wordOffset = 0;
  if (subText !== undefined) {
    if (!/^\d+$/.test(subText)) throw new AddressError(`"${raw}": .${subText} is not valid for ${FILE_TYPE_NAMES[type]} file`);
    if ((type === 'I' || type === 'O')) {
      if (Number(subText) !== 0) throw new AddressError(`"${raw}": each simulated I/O slot has one word (use .0)`);
    } else {
      throw new AddressError(`"${raw}": word selector is only valid for I/O, timer, counter and control files`);
    }
  }
  if (bitText !== undefined) {
    if (type === 'F') throw new AddressError(`"${raw}": floating-point values have no bit addressing`);
    if (!/^\d+$/.test(bitText)) throw new AddressError(`"${raw}": invalid bit number`);
    const b = Number(bitText);
    if (b > 15) throw new AddressError(`"${raw}": bit number must be 0-15`);
    return { type, file, element, wordOffset, bit: b, kind: 'bit' };
  }
  return { type, file, element, wordOffset, bit: null, kind: 'word' };
}

function defaultNumberFor(type: FileType): number {
  return { B: 3, T: 4, C: 5, R: 6, N: 7, F: 8 }[type as 'B'] ?? 9;
}

/** Looks up a file definition. */
export function findFile(files: DataFileDef[], type: FileType, number: number): DataFileDef | undefined {
  return files.find((f) => f.type === type && f.number === number);
}

/** Parses an address and checks it against the configured data files. */
export function resolveAddress(raw: string, files: DataFileDef[]): ResolvedAddress {
  const p = parseAddress(raw);
  const def = findFile(files, p.type, p.file);
  if (!def) throw new AddressError(`"${raw}": data file ${p.type}${p.file} does not exist`);
  if (p.element < 0 || p.element >= def.elements) {
    throw new AddressError(`"${raw}": element ${p.element} is out of range (${def.type}${def.number} has ${def.elements} element${def.elements === 1 ? '' : 's'}: 0-${def.elements - 1})`);
  }
  const word = p.element * wordsPerElement(p.type) + p.wordOffset;
  return { ...p, key: fileKey(p.type, p.file), word, isFloat: p.type === 'F' };
}

/** Canonical display form of a parsed address. */
export function formatAddress(p: ParsedAddress): string {
  const prefix = p.type === 'I' || p.type === 'O' || p.type === 'S' ? `${p.type}:` : `${p.type}${p.file}:`;
  let s = `${prefix}${p.element}`;
  const structBits = STRUCT_BITS[p.type];
  const structWords = STRUCT_WORDS[p.type];
  if (structBits && structWords) {
    if (p.kind === 'element') return s;
    if (p.wordOffset !== 0) {
      const name = Object.entries(structWords).find(([, v]) => v === p.wordOffset)?.[0];
      s += `.${name ?? p.wordOffset}`;
    }
    if (p.bit !== null) {
      const name = p.wordOffset === 0 ? Object.entries(structBits).find(([, v]) => v === p.bit)?.[0] : undefined;
      s += `/${name ?? p.bit}`;
    }
    return s;
  }
  if (p.bit !== null) s += `/${p.bit}`;
  return s;
}

/** Normalizes an address string to canonical form, or returns the input unchanged if it does not parse. */
export function normalizeAddress(raw: string): string {
  try {
    return formatAddress(parseAddress(raw));
  } catch {
    return raw.trim();
  }
}

/** Numeric constant check (integers and decimals, optional sign). */
export function isNumericConstant(text: string): boolean {
  const t = text.trim();
  // Unambiguous pattern (linear time) plus a length cap: operands can come from imported files.
  return t.length <= 40 && /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(t);
}

/** Valid symbol name: letter or underscore first, up to 20 characters, and not address-like. */
export function isValidSymbolName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]{0,19}$/.test(name) && !looksLikeAddress(name) && !isNumericConstant(name);
}

/** Returns true if two resolved addresses refer to overlapping data (used by cross reference). */
export function addressesOverlap(a: ResolvedAddress, b: ResolvedAddress): boolean {
  if (a.key !== b.key) return false;
  const wpe = wordsPerElement(a.type);
  if (a.kind === 'element' || b.kind === 'element') {
    return Math.floor(a.word / wpe) === Math.floor(b.word / wpe);
  }
  if (a.word !== b.word) return false;
  if (a.bit === null || b.bit === null) return true;
  return a.bit === b.bit;
}
