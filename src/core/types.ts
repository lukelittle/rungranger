/**
 * Ladder logic data model (AST).
 *
 * A rung is a series of elements evaluated left to right. An element is either
 * a single instruction or a branch. A branch holds two or more parallel legs,
 * each of which is itself a series of elements (branches can nest).
 */

export const MNEMONICS = [
  'XIC', 'XIO', 'OTE', 'OTL', 'OTU',
  'TON', 'TOF', 'RTO', 'RES', 'CTU', 'CTD',
  'MOV', 'EQU', 'NEQ', 'LES', 'GRT', 'ADD', 'SUB',
] as const;

export type Mnemonic = (typeof MNEMONICS)[number];

export interface Instruction {
  kind: 'instr';
  id: string;
  mnemonic: Mnemonic;
  /** Operands as text: addresses, constants or a timer time base. */
  operands: string[];
}

export interface Branch {
  kind: 'branch';
  id: string;
  legs: Element[][];
}

export type Element = Instruction | Branch;

export interface Rung {
  id: string;
  comment: string;
  elements: Element[];
}

export interface ProgramFile {
  number: number;
  name: string;
  rungs: Rung[];
}

/** Classic PLC data file types. */
export type FileType = 'O' | 'I' | 'S' | 'B' | 'T' | 'C' | 'R' | 'N' | 'F';

export interface DataFileDef {
  type: FileType;
  number: number;
  /** Number of elements (for I/O files: number of one-word slots). */
  elements: number;
  description?: string;
}

export interface SymbolDef {
  address: string;
  symbol: string;
  description: string;
}

export interface ForceDef {
  /** Bit address in the I or O file, e.g. "I:1/0". */
  address: string;
  value: 0 | 1;
}

export type EquipmentKind = 'motor-starter' | 'conveyor' | 'tank';

export interface ControllerConfig {
  name: string;
  /** Simulated scan interval in milliseconds. Simulated time advances by this amount every scan. */
  scanIntervalMs: number;
}

export interface Project {
  format: 'rungranger-project';
  schemaVersion: number;
  id: string;
  name: string;
  description: string;
  createdAt: string;
  modifiedAt: string;
  controller: ControllerConfig;
  dataFiles: DataFileDef[];
  /** Initial / offline data table values keyed by file key (e.g. "N7"). Missing words are zero. */
  data: Record<string, number[]>;
  program: ProgramFile;
  symbols: SymbolDef[];
  forces: ForceDef[];
  forcesEnabled: boolean;
  equipment: EquipmentKind | null;
}
