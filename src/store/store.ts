/**
 * Application state (zustand): the open project, edit history, selection,
 * UI panels and persistence orchestration.
 */
import { create } from 'zustand';
import { parseRungText, RungTextError, type DataWrite } from '../core/ascii';
import {
  addLeg, cloneElement, cloneRung, deleteElement, deleteLeg, findElement, flattenIds, insertElement,
  makeInstruction, makeRung, moveElement, unwrapBranch, wrapInBranch, type InsertTarget,
} from '../core/ast';
import { newId } from '../core/id';
import { INSTRUCTIONS } from '../core/instructions';
import { newProject, setDataValue } from '../core/project';
import { resolveAddress, normalizeAddress } from '../core/address';
import type { Element, Mnemonic, Project, Rung } from '../core/types';
import { validateProject, type Diagnostic } from '../core/validate';
import { createExample } from '../examples';
import type { ProjectStore, ProjectSummary } from '../persistence/adapter';
import { IndexedDbProjectStore, MemoryProjectStore, requestPersistentStorage } from '../persistence/indexeddb';
import { exportProjectJson, parseProjectJson } from '../persistence/schema';
import { controller } from './controller';

export type Selection =
  | { kind: 'none' }
  | { kind: 'rung'; rungId: string }
  | { kind: 'element'; rungId: string; elementId: string }
  | { kind: 'leg'; rungId: string; branchId: string; leg: number };

export type BottomTab = 'data' | 'xref' | 'verify' | 'symbols' | 'help' | 'log';
export type DialogKind = 'projects' | 'controller' | 'datafiles' | 'about' | 'shortcuts' | 'welcome' | null;

export type SaveState = 'saved' | 'pending' | 'saving' | 'error' | 'memory';

export interface LogEntry {
  time: string;
  level: 'info' | 'warn' | 'error';
  text: string;
}

type Clip = { kind: 'rung'; rung: Rung } | { kind: 'element'; element: Element } | null;

interface State {
  ready: boolean;
  storageLabel: string;
  project: Project | null;
  projects: ProjectSummary[];
  undoStack: Project[];
  redoStack: Project[];
  diagnostics: Diagnostic[];
  selection: Selection;
  clipboard: Clip;
  saveState: SaveState;
  lastSavedAt: string | null;
  bottomTab: BottomTab;
  dataFileKey: string;
  xrefQuery: string;
  helpMnemonic: Mnemonic | null;
  dialog: DialogKind;
  /** Instruction being edited in the operand editor. */
  editing: { rungId: string; elementId: string; isNew: boolean } | null;
  rungTextEditing: string | null;
  commentEditing: string | null;
  showPowerFlow: boolean;
  log: LogEntry[];
}

let store: ProjectStore = new MemoryProjectStore();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const MAX_UNDO = 100;

export const useApp = create<State>(() => ({
  ready: false,
  storageLabel: store.label,
  project: null,
  projects: [],
  undoStack: [],
  redoStack: [],
  diagnostics: [],
  selection: { kind: 'none' },
  clipboard: null,
  saveState: 'saved',
  lastSavedAt: null,
  bottomTab: 'data',
  dataFileKey: 'I1',
  xrefQuery: '',
  helpMnemonic: null,
  dialog: null,
  editing: null,
  rungTextEditing: null,
  commentEditing: null,
  showPowerFlow: true,
  log: [],
}));

const get = useApp.getState;
const set = useApp.setState;

export function log(text: string, level: LogEntry['level'] = 'info'): void {
  const time = new Date().toLocaleTimeString();
  set((s) => ({ log: [...s.log.slice(-199), { time, level, text }] }));
}

// ------------------------------------------------------------------ persistence

export async function initApp(): Promise<void> {
  try {
    const idb = new IndexedDbProjectStore();
    await idb.list();
    store = idb;
  } catch (e) {
    store = new MemoryProjectStore();
    log(`Browser storage is unavailable (${(e as Error).message}). Projects will NOT be saved; use File > Export to keep your work.`, 'error');
  }
  set({ storageLabel: store.label, saveState: store instanceof MemoryProjectStore ? 'memory' : 'saved' });
  void requestPersistentStorage();
  await refreshProjects();
  const lastId = await store.getSetting<string>('lastProjectId').catch(() => undefined);
  let opened = false;
  if (lastId && get().projects.some((p) => p.id === lastId)) opened = await openProject(lastId);
  if (!opened && get().projects.length > 0) opened = await openProject(get().projects[0].id);
  if (!opened) {
    const p = createExample('motor-starter');
    await store.save(p).catch(() => undefined);
    setProject(p, true);
    await refreshProjects();
    set({ dialog: 'welcome' });
  }
  set({ ready: true });
}

export async function refreshProjects(): Promise<void> {
  try {
    set({ projects: await store.list() });
  } catch (e) {
    log(`Could not list projects: ${(e as Error).message}`, 'error');
  }
}

function setProject(p: Project, fresh: boolean): void {
  if (controller.online) controller.goOffline();
  controller.ensureEquipment(p);
  controller.resetEquipment();
  const firstRung = p.program.rungs[0];
  set({
    project: p,
    diagnostics: validateProject(p),
    undoStack: fresh ? [] : get().undoStack,
    redoStack: fresh ? [] : get().redoStack,
    selection: firstRung ? { kind: 'rung', rungId: firstRung.id } : { kind: 'none' },
    editing: null,
    rungTextEditing: null,
    commentEditing: null,
  });
  void store.setSetting('lastProjectId', p.id).catch(() => undefined);
}

export async function openProject(id: string): Promise<boolean> {
  await flushSave();
  const r = await store.load(id);
  for (const w of r.warnings) log(`Recovered project: ${w}`, 'warn');
  if (!r.project) {
    for (const e of r.errors) log(e, 'error');
    return false;
  }
  setProject(r.project, true);
  log(`Opened project "${r.project.name}"`);
  return true;
}

function scheduleSave(): void {
  if (store instanceof MemoryProjectStore) {
    set({ saveState: 'memory' });
    return;
  }
  set({ saveState: 'pending' });
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flushSave(), 800);
}

export async function flushSave(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  } else if (get().saveState !== 'pending') return;
  const p = get().project;
  if (!p) return;
  set({ saveState: 'saving' });
  try {
    await store.save(p);
    set({ saveState: 'saved', lastSavedAt: new Date().toLocaleTimeString() });
    void refreshProjects();
  } catch (e) {
    set({ saveState: 'error' });
    log(`Autosave failed: ${(e as Error).message}. Export your project to keep a copy.`, 'error');
  }
}

export async function createProject(name: string, exampleKey?: string): Promise<void> {
  await flushSave();
  const p = exampleKey ? createExample(exampleKey) : newProject(name || 'Untitled');
  if (exampleKey && name) p.name = name;
  await store.save(p).catch((e) => log(`Could not save: ${(e as Error).message}`, 'error'));
  setProject(p, true);
  await refreshProjects();
  log(`Created project "${p.name}"`);
}

export async function renameProject(id: string, name: string): Promise<void> {
  const n = name.trim();
  if (!n) return;
  if (get().project?.id === id) {
    edit((p) => ({ ...p, name: n }));
    await flushSave();
  } else {
    const r = await store.load(id);
    if (r.project) await store.save({ ...r.project, name: n, modifiedAt: new Date().toISOString() });
  }
  await refreshProjects();
}

export async function duplicateProject(id: string): Promise<void> {
  await flushSave();
  const r = await store.load(id);
  if (!r.project) return;
  const now = new Date().toISOString();
  const copy: Project = { ...structuredClone(r.project), id: newId('p'), name: `${r.project.name} (copy)`, createdAt: now, modifiedAt: now };
  await store.save(copy);
  await refreshProjects();
  log(`Duplicated "${r.project.name}"`);
}

export async function deleteProject(id: string): Promise<void> {
  await store.delete(id);
  await refreshProjects();
  if (get().project?.id === id) {
    const next = get().projects[0];
    if (next) await openProject(next.id);
    else await createProject('Untitled');
  }
}

export async function importProjectFile(text: string): Promise<{ ok: boolean; warnings: string[]; errors: string[] }> {
  const r = parseProjectJson(text);
  if (!r.project) return { ok: false, warnings: r.warnings, errors: r.errors };
  const p = r.project;
  if (get().projects.some((x) => x.id === p.id)) {
    p.id = newId('p');
    p.name = `${p.name} (imported)`;
  }
  await flushSave();
  await store.save(p);
  setProject(p, true);
  await refreshProjects();
  for (const w of r.warnings) log(`Import: ${w}`, 'warn');
  log(`Imported project "${p.name}"`);
  return { ok: true, warnings: r.warnings, errors: [] };
}

export function exportCurrentProject(): void {
  const p = get().project;
  if (!p) return;
  const blob = new Blob([exportProjectJson(p)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${p.name.replace(/[^\w.-]+/g, '_') || 'project'}.rungranger.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  log(`Exported "${p.name}"`);
}

// ------------------------------------------------------------------ editing

/** Applies an edit to the project with undo support, revalidation, autosave and online sync. */
export function edit(fn: (p: Project) => Project): void {
  const prev = get().project;
  if (!prev) return;
  const next = fn(prev);
  if (next === prev) return;
  next.modifiedAt = new Date().toISOString();
  set((s) => ({
    project: next,
    undoStack: [...s.undoStack.slice(-MAX_UNDO + 1), prev],
    redoStack: [],
    diagnostics: validateProject(next),
  }));
  afterChange(next);
}

function afterChange(p: Project): void {
  scheduleSave();
  if (controller.online) {
    controller.sync(p);
    if (controller.pendingEditError) log(`Online edit not applied (controller keeps running the previous program): ${controller.pendingEditError}`, 'warn');
  } else controller.ensureEquipment(p);
}

export function undo(): void {
  const { undoStack, project } = get();
  if (!undoStack.length || !project) return;
  const prev = undoStack[undoStack.length - 1];
  set((s) => ({ project: prev, undoStack: s.undoStack.slice(0, -1), redoStack: [...s.redoStack, project], diagnostics: validateProject(prev) }));
  fixSelection();
  afterChange(prev);
}

export function redo(): void {
  const { redoStack, project } = get();
  if (!redoStack.length || !project) return;
  const next = redoStack[redoStack.length - 1];
  set((s) => ({ project: next, redoStack: s.redoStack.slice(0, -1), undoStack: [...s.undoStack, project], diagnostics: validateProject(next) }));
  fixSelection();
  afterChange(next);
}

function fixSelection(): void {
  const { selection, project } = get();
  if (!project || selection.kind === 'none') return;
  const rung = project.program.rungs.find((r) => r.id === selection.rungId);
  if (!rung) {
    const first = project.program.rungs[0];
    set({ selection: first ? { kind: 'rung', rungId: first.id } : { kind: 'none' } });
  } else if (selection.kind === 'element' && !findElement(rung.elements, selection.elementId)) {
    set({ selection: { kind: 'rung', rungId: rung.id } });
  } else if (selection.kind === 'leg' && !findElement(rung.elements, selection.branchId)) {
    set({ selection: { kind: 'rung', rungId: rung.id } });
  }
}

function mapRung(p: Project, rungId: string, fn: (r: Rung) => Rung): Project {
  return { ...p, program: { ...p.program, rungs: p.program.rungs.map((r) => (r.id === rungId ? fn(r) : r)) } };
}

export function select(sel: Selection): void {
  set({ selection: sel });
  if (sel.kind === 'element') {
    const r = currentRung();
    const loc = r ? findElement(r.elements, sel.elementId) : null;
    if (loc?.element.kind === 'instr') set({ helpMnemonic: loc.element.mnemonic });
  }
}

export function currentRung(): Rung | undefined {
  const { selection, project } = get();
  if (!project || selection.kind === 'none') return undefined;
  return project.program.rungs.find((r) => r.id === selection.rungId);
}

function currentRungIndex(): number {
  const { selection, project } = get();
  if (!project || selection.kind === 'none') return -1;
  return project.program.rungs.findIndex((r) => r.id === selection.rungId);
}

function applyDataWrites(p: Project, writes: DataWrite[]): Project {
  let data = p.data;
  for (const w of writes) {
    try {
      data = setDataValue({ ...p, data }, w.address, w.value);
    } catch {
      // invalid addresses are reported by validation on the instruction itself
    }
  }
  return data === p.data ? p : { ...p, data };
}

/** Where a new element goes based on the selection. */
function insertTargetFor(): { rungId: string; target: InsertTarget } | null {
  const { selection, project } = get();
  if (!project) return null;
  if (selection.kind === 'element') return { rungId: selection.rungId, target: { type: 'after', elementId: selection.elementId } };
  if (selection.kind === 'leg') return { rungId: selection.rungId, target: { type: 'leg', branchId: selection.branchId, leg: selection.leg } };
  if (selection.kind === 'rung') return { rungId: selection.rungId, target: { type: 'rung-auto' } };
  const last = project.program.rungs[project.program.rungs.length - 1];
  return last ? { rungId: last.id, target: { type: 'rung-auto' } } : null;
}

/** Inserts an instruction from the palette and opens the operand editor. */
export function insertInstruction(mnemonic: Mnemonic): void {
  let t = insertTargetFor();
  if (!t) {
    addRung();
    t = insertTargetFor();
    if (!t) return;
  }
  const ins = makeInstruction(mnemonic);
  const { rungId, target } = t;
  edit((p) => mapRung(p, rungId, (r) => ({ ...r, elements: insertElement(r.elements, target, ins) })));
  set({ selection: { kind: 'element', rungId, elementId: ins.id }, editing: { rungId, elementId: ins.id, isNew: true }, helpMnemonic: mnemonic });
}

/** Inserts one or more elements typed as rung text (e.g. "XIC I:1/0" or "BST XIC A NXB XIC B BND"). */
export function insertText(text: string): string | null {
  let parsed;
  try {
    parsed = parseRungText(text);
  } catch (e) {
    return e instanceof RungTextError ? e.message : String(e);
  }
  if (parsed.elements.length === 0) return 'Nothing to insert';
  const sym = get().project?.symbols ?? [];
  const expand = (els: Element[]): Element[] =>
    els.map((el) =>
      el.kind === 'branch'
        ? { ...el, legs: el.legs.map(expand) }
        : { ...el, operands: el.operands.map((o) => sym.find((s) => s.symbol.toUpperCase() === o.toUpperCase())?.address ?? o) },
    );
  const elements = expand(parsed.elements);
  let t = insertTargetFor();
  if (!t) {
    addRung();
    t = insertTargetFor();
    if (!t) return 'No rung to insert into';
  }
  const { rungId } = t;
  let target = t.target;
  edit((p) => {
    let next = mapRung(p, rungId, (r) => {
      let els = r.elements;
      for (const el of elements) {
        els = insertElement(els, target, el);
        target = { type: 'after', elementId: el.id };
      }
      return { ...r, elements: els };
    });
    next = applyDataWrites(next, parsed.dataWrites);
    return next;
  });
  const lastEl = elements[elements.length - 1];
  set({ selection: { kind: 'element', rungId, elementId: lastEl.id } });
  return null;
}

export function addRung(where: 'after' | 'before' = 'after'): void {
  const p = get().project;
  if (!p) return;
  const idx = currentRungIndex();
  const rung = makeRung();
  const at = idx < 0 ? p.program.rungs.length : where === 'after' ? idx + 1 : idx;
  edit((q) => ({ ...q, program: { ...q.program, rungs: [...q.program.rungs.slice(0, at), rung, ...q.program.rungs.slice(at)] } }));
  set({ selection: { kind: 'rung', rungId: rung.id } });
}

export function deleteSelection(): void {
  const { selection, project } = get();
  if (!project) return;
  if (selection.kind === 'rung') {
    const idx = currentRungIndex();
    edit((p) => ({ ...p, program: { ...p.program, rungs: p.program.rungs.filter((r) => r.id !== selection.rungId) } }));
    const rungs = get().project!.program.rungs;
    const next = rungs[Math.min(idx, rungs.length - 1)];
    set({ selection: next ? { kind: 'rung', rungId: next.id } : { kind: 'none' } });
  } else if (selection.kind === 'element') {
    const rung = currentRung();
    if (!rung) return;
    const ids = flattenIds(rung.elements);
    const pos = ids.indexOf(selection.elementId);
    edit((p) => mapRung(p, selection.rungId, (r) => ({ ...r, elements: deleteElement(r.elements, selection.elementId) })));
    const after = flattenIds(currentRung()?.elements ?? []);
    const nextId = after[Math.min(pos, after.length - 1)] ?? after[pos - 1];
    set({ selection: nextId ? { kind: 'element', rungId: selection.rungId, elementId: nextId } : { kind: 'rung', rungId: selection.rungId } });
  } else if (selection.kind === 'leg') {
    edit((p) => mapRung(p, selection.rungId, (r) => ({ ...r, elements: deleteLeg(r.elements, selection.branchId, selection.leg) })));
    set({ selection: { kind: 'rung', rungId: selection.rungId } });
  }
}

/** Wraps the selected element in a branch (or adds a leg if a branch/leg is selected). */
export function addBranch(): void {
  const { selection } = get();
  const rung = currentRung();
  if (!rung) return;
  if (selection.kind === 'element') {
    const loc = findElement(rung.elements, selection.elementId);
    if (loc?.element.kind === 'branch') {
      addBranchLeg();
      return;
    }
    let branchId: string | null = null;
    edit((p) =>
      mapRung(p, selection.rungId, (r) => {
        const w = wrapInBranch(r.elements, selection.elementId);
        branchId = w.branchId;
        return { ...r, elements: w.elements };
      }),
    );
    if (branchId) set({ selection: { kind: 'leg', rungId: selection.rungId, branchId, leg: 1 } });
  } else if (selection.kind === 'leg') {
    addBranchLeg();
  } else if (selection.kind === 'rung') {
    log('Select an instruction first, then Add Branch to put a parallel path around it.', 'warn');
  }
}

export function addBranchLeg(): void {
  const { selection } = get();
  const rung = currentRung();
  if (!rung) return;
  let branchId: string | null = null;
  let after: number | undefined;
  if (selection.kind === 'leg') {
    branchId = selection.branchId;
    after = selection.leg;
  } else if (selection.kind === 'element') {
    const loc = findElement(rung.elements, selection.elementId);
    if (loc?.element.kind === 'branch') branchId = loc.element.id;
    else if (loc?.parent) {
      branchId = loc.parent.branch.id;
      after = loc.parent.leg;
    }
  }
  if (!branchId) {
    log('Select a branch or an instruction inside a branch to add a leg.', 'warn');
    return;
  }
  const bid = branchId;
  edit((p) => mapRung(p, rung.id, (r) => ({ ...r, elements: addLeg(r.elements, bid, after) })));
  const b = findElement(currentRung()?.elements ?? [], bid)?.element;
  const newLeg = after === undefined ? (b?.kind === 'branch' ? b.legs.length - 1 : 0) : after + 1;
  set({ selection: { kind: 'leg', rungId: rung.id, branchId: bid, leg: newLeg } });
}

export function removeBranchStructure(branchId: string): void {
  const rung = currentRung();
  if (!rung) return;
  edit((p) => mapRung(p, rung.id, (r) => ({ ...r, elements: unwrapBranch(r.elements, branchId) })));
  set({ selection: { kind: 'rung', rungId: rung.id } });
}

export function moveSelected(dir: -1 | 1): void {
  const { selection, project } = get();
  if (!project) return;
  if (selection.kind === 'element') {
    edit((p) => mapRung(p, selection.rungId, (r) => ({ ...r, elements: moveElement(r.elements, selection.elementId, dir) })));
  } else if (selection.kind === 'rung') {
    const i = currentRungIndex();
    const j = i + dir;
    if (j < 0 || j >= project.program.rungs.length) return;
    edit((p) => {
      const rungs = [...p.program.rungs];
      [rungs[i], rungs[j]] = [rungs[j], rungs[i]];
      return { ...p, program: { ...p.program, rungs } };
    });
  }
}

export function updateOperands(rungId: string, elementId: string, operands: string[], dataWrites: DataWrite[]): void {
  edit((p) => {
    let next = mapRung(p, rungId, (r) => {
      const loc = findElement(r.elements, elementId);
      if (!loc || loc.element.kind !== 'instr') return r;
      const ins = { ...loc.element, operands };
      const replace = (s: Element[]): Element[] => s.map((e) => (e.id === elementId ? ins : e.kind === 'branch' ? { ...e, legs: e.legs.map(replace) } : e));
      return { ...r, elements: replace(r.elements) };
    });
    next = applyDataWrites(next, dataWrites);
    return next;
  });
}

export function changeMnemonic(rungId: string, elementId: string, mnemonic: Mnemonic): void {
  edit((p) =>
    mapRung(p, rungId, (r) => {
      const replace = (s: Element[]): Element[] =>
        s.map((e) => {
          if (e.id === elementId && e.kind === 'instr') {
            const fresh = makeInstruction(mnemonic);
            const ops = fresh.operands.map((o, i) => (INSTRUCTIONS[mnemonic].operands[i].kind === INSTRUCTIONS[e.mnemonic].operands[i]?.kind ? e.operands[i] : o));
            return { ...e, mnemonic, operands: ops };
          }
          return e.kind === 'branch' ? { ...e, legs: e.legs.map(replace) } : e;
        });
      return { ...r, elements: replace(r.elements) };
    }),
  );
  set({ helpMnemonic: mnemonic });
}

export function setRungComment(rungId: string, comment: string): void {
  edit((p) => mapRung(p, rungId, (r) => ({ ...r, comment })));
}

export function replaceRungText(rungId: string, text: string): string | null {
  try {
    const parsed = parseRungText(text);
    edit((p) => applyDataWrites(mapRung(p, rungId, (r) => ({ ...r, elements: parsed.elements })), parsed.dataWrites));
    set({ selection: { kind: 'rung', rungId } });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export function copySelection(): void {
  const { selection } = get();
  const rung = currentRung();
  if (!rung) return;
  if (selection.kind === 'rung') set({ clipboard: { kind: 'rung', rung: cloneRung(rung) } });
  else if (selection.kind === 'element') {
    const loc = findElement(rung.elements, selection.elementId);
    if (loc) set({ clipboard: { kind: 'element', element: cloneElement(loc.element) } });
  }
}

export function cutSelection(): void {
  copySelection();
  deleteSelection();
}

export function paste(): void {
  const { clipboard, project } = get();
  if (!clipboard || !project) return;
  if (clipboard.kind === 'rung') {
    const idx = currentRungIndex();
    const r = cloneRung(clipboard.rung);
    const at = idx < 0 ? project.program.rungs.length : idx + 1;
    edit((p) => ({ ...p, program: { ...p.program, rungs: [...p.program.rungs.slice(0, at), r, ...p.program.rungs.slice(at)] } }));
    set({ selection: { kind: 'rung', rungId: r.id } });
  } else {
    const t = insertTargetFor();
    if (!t) return;
    const el = cloneElement(clipboard.element);
    edit((p) => mapRung(p, t.rungId, (r) => ({ ...r, elements: insertElement(r.elements, t.target, el) })));
    set({ selection: { kind: 'element', rungId: t.rungId, elementId: el.id } });
  }
}

/** Keyboard navigation. */
export function navigate(dir: 'up' | 'down' | 'left' | 'right' | 'home' | 'end'): void {
  const { selection, project } = get();
  if (!project) return;
  const rungs = project.program.rungs;
  if (rungs.length === 0) return;
  let ri = currentRungIndex();
  if (ri < 0) {
    set({ selection: { kind: 'rung', rungId: rungs[0].id } });
    return;
  }
  if (dir === 'up' || dir === 'down') {
    ri = Math.max(0, Math.min(rungs.length - 1, ri + (dir === 'up' ? -1 : 1)));
    set({ selection: { kind: 'rung', rungId: rungs[ri].id } });
    return;
  }
  if (dir === 'home' || dir === 'end') {
    const r = dir === 'home' ? rungs[0] : rungs[rungs.length - 1];
    set({ selection: { kind: 'rung', rungId: r.id } });
    return;
  }
  const rung = rungs[ri];
  const ids = flattenIds(rung.elements);
  if (selection.kind === 'rung' || selection.kind === 'leg') {
    if (dir === 'right' && ids.length) select({ kind: 'element', rungId: rung.id, elementId: ids[0] });
    return;
  }
  if (selection.kind === 'element') {
    const i = ids.indexOf(selection.elementId);
    const j = i + (dir === 'right' ? 1 : -1);
    if (j < 0) set({ selection: { kind: 'rung', rungId: rung.id } });
    else if (j < ids.length) select({ kind: 'element', rungId: rung.id, elementId: ids[j] });
    else if (ri + 1 < rungs.length) set({ selection: { kind: 'rung', rungId: rungs[ri + 1].id } });
  }
}

// ------------------------------------------------------------------ data, forces, symbols

/** Writes a data table value: live memory when online, the project's stored values when offline. */
export function writeData(address: string, value: number): void {
  if (controller.engine) {
    try {
      controller.engine.write(address, value);
      controller.notify();
    } catch (e) {
      log((e as Error).message, 'error');
    }
    return;
  }
  try {
    edit((p) => ({ ...p, data: setDataValue(p, address, value) }));
  } catch (e) {
    log((e as Error).message, 'error');
  }
}

/** Sets (value 0/1) or removes (null) a force on an I/O bit. */
export function setForce(address: string, value: 0 | 1 | null): void {
  const p = get().project;
  if (!p) return;
  let canonical: string;
  try {
    const a = resolveAddress(address, p.dataFiles);
    if ((a.type !== 'I' && a.type !== 'O') || a.bit === null) throw new Error('Only I/O bits can be forced');
    canonical = normalizeAddress(address);
  } catch (e) {
    log((e as Error).message, 'error');
    return;
  }
  edit((q) => {
    const forces = q.forces.filter((f) => normalizeAddress(f.address) !== canonical);
    if (value !== null) forces.push({ address: canonical, value });
    return { ...q, forces };
  });
  log(value === null ? `Removed force on ${canonical}` : `Forced ${canonical} ${value ? 'ON' : 'OFF'}`, 'warn');
}

export function forceOf(p: Project, address: string): 0 | 1 | null {
  const c = normalizeAddress(address);
  return p.forces.find((f) => normalizeAddress(f.address) === c)?.value ?? null;
}

export function setForcesEnabled(enabled: boolean): void {
  edit((p) => ({ ...p, forcesEnabled: enabled }));
  log(enabled ? 'Forces enabled' : 'Forces disabled', 'warn');
}

/** Saves live controller data as the project's initial data values. */
export function captureLiveData(): void {
  const e = controller.engine;
  if (!e) return;
  const data = e.mem.snapshot();
  edit((p) => ({ ...p, data }));
  log('Live data table values saved into the project');
}

export function setUi(partial: Partial<State>): void {
  set(partial);
}

export function showInLadder(rung: number, elementId?: string): void {
  const p = get().project;
  const r = p?.program.rungs[rung];
  if (!r) return;
  set({ selection: elementId ? { kind: 'element', rungId: r.id, elementId } : { kind: 'rung', rungId: r.id } });
  requestAnimationFrame(() => document.getElementById(`rung-${r.id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
}
