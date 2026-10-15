import { fileKey, resolveAddress, wordsPerElement } from './address';
import { newId } from './id';
import type { DataFileDef, EquipmentKind, Project, Rung } from './types';

export const SCHEMA_VERSION = 1;
export const PROJECT_FORMAT = 'rungranger-project' as const;

export const MAX_ELEMENTS: Record<string, number> = { O: 30, I: 30, S: 96, default: 256 };

export function defaultDataFiles(): DataFileDef[] {
  return [
    { type: 'O', number: 0, elements: 4, description: 'Output image' },
    { type: 'I', number: 1, elements: 4, description: 'Input image' },
    { type: 'S', number: 2, elements: 96, description: 'Status (partially simulated)' },
    { type: 'B', number: 3, elements: 16, description: 'Binary' },
    { type: 'T', number: 4, elements: 16, description: 'Timers' },
    { type: 'C', number: 5, elements: 16, description: 'Counters' },
    { type: 'R', number: 6, elements: 4, description: 'Control' },
    { type: 'N', number: 7, elements: 32, description: 'Integers' },
    { type: 'F', number: 8, elements: 16, description: 'Floating point' },
  ];
}

export function newProject(name = 'Untitled', opts: { rungs?: Rung[]; equipment?: EquipmentKind | null } = {}): Project {
  const now = new Date().toISOString();
  return {
    format: PROJECT_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    id: newId('p'),
    name,
    description: '',
    createdAt: now,
    modifiedAt: now,
    controller: { name: 'VIRTUAL_PLC', scanIntervalMs: 50 },
    dataFiles: defaultDataFiles(),
    data: {},
    program: { number: 2, name: 'MAIN', rungs: opts.rungs ?? [{ id: newId('r'), comment: '', elements: [] }] },
    symbols: [],
    forces: [],
    forcesEnabled: true,
    equipment: opts.equipment ?? null,
  };
}

export function fileWordCount(def: DataFileDef): number {
  return def.elements * wordsPerElement(def.type);
}

/** Returns a copy of `data` with the value at `address` set (word or bit). Throws AddressError on bad addresses. */
export function setDataValue(project: Project, address: string, value: number): Record<string, number[]> {
  const a = resolveAddress(address, project.dataFiles);
  const words = [...(project.data[a.key] ?? [])];
  while (words.length <= a.word) words.push(0);
  if (a.bit !== null) {
    const w = words[a.word] & 0xffff;
    const next = value ? w | (1 << a.bit) : w & ~(1 << a.bit);
    words[a.word] = (next << 16) >> 16;
  } else if (a.isFloat) {
    words[a.word] = Math.fround(value);
  } else {
    words[a.word] = clampInt16(Math.round(value));
  }
  return { ...project.data, [a.key]: words };
}

export function getDataValue(project: Project, address: string): number {
  const a = resolveAddress(address, project.dataFiles);
  const w = project.data[a.key]?.[a.word] ?? 0;
  if (a.bit !== null) return (w >> a.bit) & 1;
  return w;
}

export function clampInt16(v: number): number {
  if (v > 32767) return 32767;
  if (v < -32768) return -32768;
  return v;
}

export { fileKey };
