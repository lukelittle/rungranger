/**
 * Live data table memory for the virtual controller.
 * Integer-type files are stored as Int16Array (16-bit signed words), float files as Float32Array.
 */
import { fileKeyOf, resolveAddress, type ResolvedAddress } from '../core/address';
import { fileWordCount } from '../core/project';
import type { DataFileDef } from '../core/types';

export interface DataFile {
  def: DataFileDef;
  words: Int16Array | Float32Array;
}

export class DataTable {
  readonly files = new Map<string, DataFile>();

  constructor(defs: DataFileDef[], initial: Record<string, number[]> = {}) {
    for (const def of defs) {
      const key = fileKeyOf(def);
      const n = fileWordCount(def);
      const words = def.type === 'F' ? new Float32Array(n) : new Int16Array(n);
      const src = initial[key];
      if (src) for (let i = 0; i < Math.min(n, src.length); i++) words[i] = Number(src[i]) || 0;
      this.files.set(key, { def, words });
    }
  }

  get defs(): DataFileDef[] {
    return [...this.files.values()].map((f) => f.def);
  }

  words(key: string): Int16Array | Float32Array {
    const f = this.files.get(key);
    if (!f) throw new Error(`data file ${key} does not exist`);
    return f.words;
  }

  /** Builds a new table for the given layout, keeping values of files/words that still exist. */
  resized(defs: DataFileDef[]): DataTable {
    return new DataTable(defs, this.snapshot());
  }

  snapshot(): Record<string, number[]> {
    const out: Record<string, number[]> = {};
    for (const [key, f] of this.files) {
      // Trim trailing zeros to keep saved projects small.
      let end = f.words.length;
      while (end > 0 && f.words[end - 1] === 0) end--;
      if (end > 0) out[key] = Array.from(f.words.subarray(0, end));
    }
    return out;
  }

  read(a: ResolvedAddress): number {
    const w = this.words(a.key)[a.word];
    if (a.bit !== null) return (w >> a.bit) & 1;
    return w;
  }

  write(a: ResolvedAddress, value: number): void {
    const arr = this.words(a.key);
    if (a.bit !== null) {
      arr[a.word] = value ? arr[a.word] | (1 << a.bit) : arr[a.word] & ~(1 << a.bit);
    } else if (a.isFloat) {
      arr[a.word] = value;
    } else {
      arr[a.word] = Math.max(-32768, Math.min(32767, Math.round(value)));
    }
  }

  readAddress(address: string): number {
    return this.read(resolveAddress(address, this.defs));
  }

  writeAddress(address: string, value: number): void {
    this.write(resolveAddress(address, this.defs), value);
  }
}

export function sameLayout(a: DataFileDef[], b: DataFileDef[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((d, i) => d.type === b[i].type && d.number === b[i].number && d.elements === b[i].elements);
}
