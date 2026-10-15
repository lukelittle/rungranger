/**
 * Project file schema: versioning, migration, validation and best-effort recovery.
 *
 * importProject() never trusts its input. It rebuilds a clean Project from whatever
 * it can salvage and reports everything it had to drop or repair.
 */
import { isValidSymbolName } from '../core/address';
import { newId } from '../core/id';
import { isMnemonic, INSTRUCTIONS } from '../core/instructions';
import { defaultDataFiles, fileWordCount, newProject, PROJECT_FORMAT, SCHEMA_VERSION } from '../core/project';
import type { DataFileDef, Element, EquipmentKind, FileType, ForceDef, Project, Rung, SymbolDef } from '../core/types';

export interface ImportResult {
  project: Project | null;
  /** Problems that were repaired or data that was dropped. */
  warnings: string[];
  /** Fatal problems (project is null when present). */
  errors: string[];
}

/**
 * Hard limits for untrusted input. Imported files and IndexedDB records are
 * attacker-controllable (a shared project file, or another page on the same
 * origin), so every size and depth is bounded to keep the tab responsive.
 */
export const IMPORT_LIMITS = {
  fileBytes: 10 * 1024 * 1024,
  branchDepth: 16,
  rungs: 2000,
  elements: 20000,
  operandChars: 64,
  idChars: 64,
  nameChars: 120,
  commentChars: 4000,
  symbols: 4000,
  forces: 512,
  dataFiles: 64,
  warnings: 200,
} as const;

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/** Migrations from version N to N+1, indexed by N. Add entries here when the schema changes. */
const MIGRATIONS: Record<number, Migration> = {
  // 1: (raw) => ({ ...raw, schemaVersion: 2, newField: defaultValue }),
};

const FILE_TYPES: FileType[] = ['O', 'I', 'S', 'B', 'T', 'C', 'R', 'N', 'F'];
const EQUIPMENT: EquipmentKind[] = ['motor-starter', 'conveyor', 'tank'];

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function parseProjectJson(text: string): ImportResult {
  if (text.length > IMPORT_LIMITS.fileBytes) {
    return { project: null, warnings: [], errors: [`The file is too large (limit ${IMPORT_LIMITS.fileBytes / 1024 / 1024} MB)`] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { project: null, warnings: [], errors: [`The file is not valid JSON: ${(e as Error).message}`] };
  }
  return importProject(raw);
}

export function importProject(input: unknown): ImportResult {
  try {
    return importProjectUnchecked(input);
  } catch (e) {
    // Never let malformed input crash the caller (the app re-validates stored projects at startup).
    return { project: null, warnings: [], errors: [`The project could not be read: ${(e as Error)?.message ?? String(e)}`] };
  }
}

function importProjectUnchecked(input: unknown): ImportResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  if (!isObj(input)) return { project: null, warnings, errors: ['The file does not contain a RungRanger project object'] };

  let raw: Record<string, unknown> = input;
  if (raw.format !== PROJECT_FORMAT) {
    if (isObj(raw.program) || Array.isArray(raw.rungs)) warnings.push('Missing or unknown "format" marker; attempting to read anyway');
    else return { project: null, warnings, errors: ['This is not a RungRanger project file (missing "format": "rungranger-project")'] };
  }

  let version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1;
  if (typeof raw.schemaVersion !== 'number') warnings.push('Missing schemaVersion; assuming version 1');
  if (version > SCHEMA_VERSION) {
    warnings.push(`Project was saved by a newer version of RungRanger (schema ${version}); unknown fields will be ignored`);
    version = SCHEMA_VERSION;
  }
  while (version < SCHEMA_VERSION) {
    const m = MIGRATIONS[version];
    if (!m) {
      errors.push(`No migration available from schema version ${version}`);
      return { project: null, warnings, errors };
    }
    raw = m(raw);
    version++;
    warnings.push(`Upgraded project from schema version ${version - 1} to ${version}`);
  }

  const base = newProject();
  const str = (v: unknown, fallback: string, max: number = IMPORT_LIMITS.nameChars) => {
    if (typeof v !== 'string') return fallback;
    if (v.length > max) {
      warnings.push(`A text field was longer than ${max} characters and was shortened`);
      return v.slice(0, max);
    }
    return v;
  };

  // Data files
  let dataFiles: DataFileDef[] = [];
  if (Array.isArray(raw.dataFiles)) {
    for (const f of raw.dataFiles.slice(0, IMPORT_LIMITS.dataFiles)) {
      if (
        !isObj(f) || !FILE_TYPES.includes(f.type as FileType) || !Number.isInteger(f.number) || !Number.isFinite(f.elements) ||
        (f.number as number) < 0 || (f.number as number) > 255 ||
        (['O', 'I', 'S'].includes(f.type as string) ? f.number !== ({ O: 0, I: 1, S: 2 } as Record<string, number>)[f.type as string] : (f.number as number) < 3)
      ) {
        warnings.push(`Dropped an invalid data file definition (${isObj(f) ? `${String(f.type).slice(0, 4)}${String(f.number).slice(0, 6)}` : typeof f})`);
        continue;
      }
      const elements = Math.max(1, Math.min(f.type === 'I' || f.type === 'O' ? 30 : 256, Math.floor(f.elements as number)));
      if (elements !== f.elements) warnings.push(`Data file ${f.type}${f.number}: element count adjusted to ${elements}`);
      if (dataFiles.some((d) => d.type === f.type && d.number === f.number)) {
        warnings.push(`Dropped duplicate data file ${f.type}${f.number}`);
        continue;
      }
      dataFiles.push({ type: f.type as FileType, number: f.number as number, elements, description: typeof f.description === 'string' ? f.description.slice(0, IMPORT_LIMITS.nameChars) : undefined });
    }
  } else warnings.push('Data file definitions missing; using defaults');
  for (const def of defaultDataFiles()) {
    if (['O', 'I', 'S'].includes(def.type) && !dataFiles.some((d) => d.type === def.type)) {
      dataFiles.push(def);
      if (Array.isArray(raw.dataFiles)) warnings.push(`Restored missing required data file ${def.type}${def.number}`);
    }
  }
  if (dataFiles.length === 0) dataFiles = defaultDataFiles();
  dataFiles.sort((a, b) => a.number - b.number);

  // Data values
  const data: Record<string, number[]> = {};
  if (isObj(raw.data)) {
    for (const [k, v] of Object.entries(raw.data)) {
      if (!Array.isArray(v) || !dataFiles.some((d) => `${d.type}${d.number}` === k)) {
        warnings.push(`Dropped data values for unknown file ${k}`);
        continue;
      }
      const def = dataFiles.find((d) => `${d.type}${d.number}` === k)!;
      const words = fileWordCount(def);
      if (v.length > words) warnings.push(`Data values for ${k} beyond the file size were dropped`);
      data[k] = v.slice(0, words).map((x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0));
    }
  }

  // Program
  const rawProgram = isObj(raw.program) ? raw.program : { rungs: raw.rungs };
  const rungs: Rung[] = [];
  const budget = { elements: IMPORT_LIMITS.elements };
  if (Array.isArray(rawProgram.rungs)) {
    if (rawProgram.rungs.length > IMPORT_LIMITS.rungs) warnings.push(`Only the first ${IMPORT_LIMITS.rungs} rungs were imported`);
    rawProgram.rungs.slice(0, IMPORT_LIMITS.rungs).forEach((r, i) => {
      if (!isObj(r)) {
        warnings.push(`Dropped rung ${i}: not an object`);
        return;
      }
      const elements = Array.isArray(r.elements) ? sanitizeSeries(r.elements, `rung ${i}`, warnings, 0, budget) : [];
      if (!Array.isArray(r.elements)) warnings.push(`Rung ${i}: missing elements; kept as an empty rung`);
      rungs.push({ id: safeId(r.id, 'r'), comment: str(r.comment, '', IMPORT_LIMITS.commentChars), elements });
    });
  } else warnings.push('Program rungs missing; starting with an empty program');
  if (rungs.length === 0) rungs.push({ id: newId('r'), comment: '', elements: [] });
  dedupeIds(rungs, warnings);

  // Symbols
  const symbols: SymbolDef[] = [];
  if (Array.isArray(raw.symbols)) {
    if (raw.symbols.length > IMPORT_LIMITS.symbols) warnings.push(`Only the first ${IMPORT_LIMITS.symbols} symbols were imported`);
    for (const s of raw.symbols.slice(0, IMPORT_LIMITS.symbols)) {
      if (!isObj(s) || typeof s.address !== 'string' || s.address.length > IMPORT_LIMITS.operandChars) {
        warnings.push('Dropped an invalid symbol entry');
        continue;
      }
      const symbol = str(s.symbol, '');
      if (symbol && !isValidSymbolName(symbol)) warnings.push(`Symbol "${symbol}" has an invalid name; kept, please rename it`);
      symbols.push({ address: s.address, symbol: symbol.slice(0, IMPORT_LIMITS.operandChars), description: str(s.description, '', IMPORT_LIMITS.commentChars) });
    }
  }

  const forces: ForceDef[] = [];
  if (Array.isArray(raw.forces)) {
    for (const f of raw.forces.slice(0, IMPORT_LIMITS.forces)) {
      if (isObj(f) && typeof f.address === 'string' && f.address.length <= IMPORT_LIMITS.operandChars && (f.value === 0 || f.value === 1)) forces.push({ address: f.address, value: f.value });
      else warnings.push('Dropped an invalid force entry');
    }
  }

  const ctrl = isObj(raw.controller) ? raw.controller : {};
  let scan = typeof ctrl.scanIntervalMs === 'number' ? Math.round(ctrl.scanIntervalMs) : base.controller.scanIntervalMs;
  if (!Number.isFinite(scan) || scan < 5 || scan > 2000) {
    warnings.push(`Scan interval ${scan} ms out of range; using ${base.controller.scanIntervalMs} ms`);
    scan = base.controller.scanIntervalMs;
  }

  const equipment = EQUIPMENT.includes(raw.equipment as EquipmentKind) ? (raw.equipment as EquipmentKind) : null;

  const project: Project = {
    format: PROJECT_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    id: safeId(raw.id, 'p'),
    name: str(raw.name, '').trim() || 'Recovered project',
    description: str(raw.description, '', IMPORT_LIMITS.commentChars),
    createdAt: str(raw.createdAt, base.createdAt),
    modifiedAt: str(raw.modifiedAt, base.modifiedAt),
    controller: { name: str(ctrl.name, base.controller.name), scanIntervalMs: scan },
    dataFiles,
    data,
    program: { number: 2, name: str(rawProgram.name, 'MAIN'), rungs },
    symbols,
    forces,
    forcesEnabled: raw.forcesEnabled !== false,
    equipment,
  };
  if (warnings.length > IMPORT_LIMITS.warnings) {
    const extra = warnings.length - IMPORT_LIMITS.warnings;
    warnings.length = IMPORT_LIMITS.warnings;
    warnings.push(`…and ${extra} more repair message(s)`);
  }
  return { project, warnings, errors };
}

function safeId(v: unknown, prefix: string): string {
  return typeof v === 'string' && v && v.length <= IMPORT_LIMITS.idChars ? v : newId(prefix);
}

function sanitizeSeries(series: unknown[], where: string, warnings: string[], depth: number, budget: { elements: number }): Element[] {
  const out: Element[] = [];
  for (const el of series) {
    if (budget.elements <= 0) {
      warnings.push(`${where}: element limit (${IMPORT_LIMITS.elements}) reached; remaining elements dropped`);
      break;
    }
    budget.elements--;
    if (!isObj(el)) {
      warnings.push(`${where}: dropped an invalid element`);
      continue;
    }
    if (el.kind === 'branch') {
      if (depth >= IMPORT_LIMITS.branchDepth) {
        warnings.push(`${where}: branches nested deeper than ${IMPORT_LIMITS.branchDepth} levels were dropped`);
        continue;
      }
      if (!Array.isArray(el.legs)) {
        warnings.push(`${where}: dropped a branch without legs`);
        continue;
      }
      const legs = el.legs.filter(Array.isArray).map((leg) => sanitizeSeries(leg as unknown[], where, warnings, depth + 1, budget));
      if (legs.length >= 2) out.push({ kind: 'branch', id: safeId(el.id, 'b'), legs });
      else if (legs.length === 1) {
        warnings.push(`${where}: branch with a single leg was flattened`);
        out.push(...legs[0]);
      }
      continue;
    }
    const m = typeof el.mnemonic === 'string' ? el.mnemonic.toUpperCase() : '';
    if (!isMnemonic(m)) {
      warnings.push(`${where}: dropped unknown instruction "${String(el.mnemonic).slice(0, 12)}"`);
      continue;
    }
    const n = INSTRUCTIONS[m].operands.length;
    const given = Array.isArray(el.operands) ? el.operands.length : 0;
    const ops = Array.isArray(el.operands)
      ? el.operands.slice(0, n).map((o) => {
          const t = typeof o === 'string' ? o : typeof o === 'number' ? String(o) : '?';
          return t.length > IMPORT_LIMITS.operandChars ? '?' : t;
        })
      : [];
    if (given !== n) warnings.push(`${where}: ${m} had ${given} operand(s); adjusted to ${n}`);
    while (ops.length < n) ops.push('?');
    out.push({ kind: 'instr', id: safeId(el.id, 'i'), mnemonic: m, operands: ops });
  }
  return out;
}

function dedupeIds(rungs: Rung[], warnings: string[]): void {
  const seen = new Set<string>();
  let fixed = 0;
  const fix = (id: string, prefix: string) => {
    if (!seen.has(id)) {
      seen.add(id);
      return id;
    }
    fixed++;
    const n = newId(prefix);
    seen.add(n);
    return n;
  };
  const walk = (s: Element[]) => {
    for (const el of s) {
      el.id = fix(el.id, el.kind === 'branch' ? 'b' : 'i');
      if (el.kind === 'branch') el.legs.forEach(walk);
    }
  };
  for (const r of rungs) {
    r.id = fix(r.id, 'r');
    walk(r.elements);
  }
  if (fixed) warnings.push(`Repaired ${fixed} duplicate element id(s)`);
}

export function exportProjectJson(p: Project): string {
  return JSON.stringify(p, null, 2);
}
