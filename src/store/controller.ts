/**
 * The "virtual controller": owns the PLC engine, the equipment simulation and
 * the real-time scheduler. The UI subscribes to it with useSyncExternalStore.
 *
 * The scheduler converts real elapsed time into a whole number of fixed-length
 * scans. Each scan advances simulated time by exactly the scan interval, so
 * the logic is deterministic; only the pacing follows the wall clock.
 */
import type { Project } from '../core/types';
import { EQUIPMENT_MODELS, type EquipmentModel } from '../equipment/models';
import { PlcEngine, type PlcMode } from '../runtime/engine';
import { simulationStep, writeEquipmentInputs } from '../runtime/simulation';

type Listener = () => void;

const MAX_STEPS_PER_FRAME = 200;

export class VirtualController {
  engine: PlcEngine | null = null;
  model: EquipmentModel<unknown> | null = null;
  eqState: unknown = null;
  /** Equipment kind the current plant state belongs to. */
  private eqKind: string | null = null;
  speed = 1;
  /** Bumped on every visible change; used as the external-store snapshot. */
  version = 0;
  /** Last online-edit error (program kept running the previous version). */
  pendingEditError: string | null = null;
  private listeners = new Set<Listener>();
  private raf: number | null = null;
  private lastTime = 0;
  private acc = 0;

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getVersion = (): number => this.version;

  notify(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  get online(): boolean {
    return this.engine !== null;
  }

  get mode(): PlcMode | 'OFFLINE' {
    return this.engine?.mode ?? 'OFFLINE';
  }

  /** Prepares the plant model for a project (also used offline so the picture is visible). */
  ensureEquipment(project: Project): void {
    const kind = project.equipment;
    if (kind === this.eqKind) return;
    this.eqKind = kind;
    this.model = kind ? (EQUIPMENT_MODELS[kind] as EquipmentModel<unknown>) : null;
    this.eqState = this.model ? this.model.init() : null;
    this.notify();
  }

  resetEquipment(): void {
    if (this.model) this.eqState = this.model.init();
    this.notify();
  }

  /** "Download" and go online. Returns an error message if the program cannot be compiled. */
  goOnline(project: Project): string | null {
    this.ensureEquipment(project);
    const engine = new PlcEngine(project);
    if (!engine.program) return 'The program has errors and cannot be downloaded. See the Verify tab.';
    this.engine = engine;
    this.pendingEditError = null;
    writeEquipmentInputs(engine, this.model, this.eqState);
    engine.inputScan();
    this.startLoop();
    this.notify();
    return null;
  }

  goOffline(): void {
    this.stopLoop();
    this.engine = null;
    this.pendingEditError = null;
    this.notify();
  }

  /** Applies an edited project to the running controller (online edit). */
  sync(project: Project): void {
    this.ensureEquipment(project);
    if (!this.engine) return;
    try {
      this.engine.updateProject(project);
      this.pendingEditError = null;
    } catch (e) {
      this.pendingEditError = e instanceof Error ? e.message : String(e);
    }
    this.notify();
  }

  setMode(mode: 'RUN' | 'PROGRAM' | 'TEST'): void {
    this.engine?.setMode(mode);
    this.lastTime = performance.now();
    this.acc = 0;
    this.notify();
  }

  singleScan(): void {
    const e = this.engine;
    if (!e || e.mode === 'FAULT') return;
    if (e.mode === 'RUN') e.setMode('TEST');
    writeEquipmentInputs(e, this.model, this.eqState);
    const ok = e.scan();
    if (this.model && ok) {
      this.model.step(this.eqState, (a) => safe(() => e.getFieldOutput(a)), e.scanIntervalMs);
    }
    this.notify();
  }

  reset(): void {
    this.engine?.reset();
    this.resetEquipment();
    if (this.engine) {
      writeEquipmentInputs(this.engine, this.model, this.eqState);
      this.engine.inputScan();
    }
    this.notify();
  }

  clearFault(): void {
    this.engine?.clearFault();
    this.notify();
  }

  /** Lets the UI change equipment state (button presses) and see the effect immediately. */
  touchEquipment(fn: (state: never) => void): void {
    if (this.eqState) fn(this.eqState as never);
    if (this.engine) {
      writeEquipmentInputs(this.engine, this.model, this.eqState);
      if (this.engine.mode !== 'RUN') this.engine.inputScan();
    }
    this.notify();
  }

  private startLoop(): void {
    if (this.raf !== null || typeof requestAnimationFrame === 'undefined') return;
    this.lastTime = performance.now();
    this.acc = 0;
    const frame = (t: number) => {
      this.raf = requestAnimationFrame(frame);
      const e = this.engine;
      if (!e) return;
      const dt = Math.min(250, t - this.lastTime);
      this.lastTime = t;
      if (e.mode === 'TEST') return; // paused: nothing moves
      this.acc += dt * this.speed;
      const interval = Math.max(1, e.scanIntervalMs);
      let steps = 0;
      while (this.acc >= interval && steps < MAX_STEPS_PER_FRAME) {
        this.acc -= interval;
        simulationStep(e, this.model, this.eqState);
        steps++;
        if (e.mode !== 'RUN' && e.mode !== 'PROGRAM') break;
      }
      if (steps >= MAX_STEPS_PER_FRAME) this.acc = 0;
      this.notify();
    };
    this.raf = requestAnimationFrame(frame);
  }

  private stopLoop(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }
}

function safe(fn: () => number): number {
  try {
    return fn();
  } catch {
    return 0;
  }
}

export const controller = new VirtualController();
