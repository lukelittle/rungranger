import { parseRungText } from '../core/ascii';
import { makeRung } from '../core/ast';
import { newProject, setDataValue } from '../core/project';
import type { Project } from '../core/types';
import { PlcEngine } from './engine';

/** Builds a project from rung text lines and returns a RUN-mode engine. Test helper. */
export function projectFromText(lines: string[], scanIntervalMs = 100): Project {
  let p = newProject('test');
  p.controller.scanIntervalMs = scanIntervalMs;
  const rungs = lines.map((l) => {
    const parsed = parseRungText(l);
    for (const w of parsed.dataWrites) p = { ...p, data: setDataValue(p, w.address, w.value) };
    return makeRung(parsed.elements);
  });
  return { ...p, program: { ...p.program, rungs } };
}

export function engineFromText(lines: string[], scanIntervalMs = 100): PlcEngine {
  const e = new PlcEngine(projectFromText(lines, scanIntervalMs));
  if (!e.program) throw new Error('program failed to compile');
  e.setMode('RUN');
  return e;
}
