import { parseRungText } from '../core/ascii';
import { makeRung } from '../core/ast';
import { newProject, setDataValue } from '../core/project';
import type { EquipmentKind, Project } from '../core/types';

export interface ExampleSpec {
  name: string;
  description: string;
  equipment: EquipmentKind;
  scanIntervalMs?: number;
  rungs: { text: string; comment: string }[];
  symbols: [address: string, symbol: string, description: string][];
}

/** Builds a fresh project (new ids) from an example specification. */
export function buildExample(spec: ExampleSpec): Project {
  let p = newProject(spec.name, { equipment: spec.equipment });
  p.description = spec.description;
  if (spec.scanIntervalMs) p.controller.scanIntervalMs = spec.scanIntervalMs;
  const rungs = spec.rungs.map((r) => {
    const parsed = parseRungText(r.text);
    for (const w of parsed.dataWrites) p = { ...p, data: setDataValue(p, w.address, w.value) };
    return makeRung(parsed.elements, r.comment);
  });
  p.program = { ...p.program, rungs };
  p.symbols = spec.symbols.map(([address, symbol, description]) => ({ address, symbol, description }));
  return p;
}
