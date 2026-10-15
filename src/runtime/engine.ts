/**
 * Deterministic virtual PLC runtime.
 *
 * One scan:
 *   1. Input scan:  field inputs (+ forces) are copied into the input image (I1).
 *   2. Program scan: rungs are executed in order, top to bottom.
 *   3. Output scan: the output image (O0) (+ forces) is copied to the field outputs.
 *   4. Housekeeping: first-pass bit cleared, overflow trap checked, clock updated.
 *
 * Simulated time advances by exactly the configured scan interval per scan, so a
 * given program, input sequence and scan interval always produce the same result,
 * independent of the browser's real timing.
 */
import { resolveAddress } from '../core/address';
import type { ForceDef, Project } from '../core/types';
import { compileProgram, execSeries, FAULT_CODES, PlcFault, STATUS, type CompiledProgram, type ExecContext } from './compiler';
import { DataTable, sameLayout } from './memory';

export type PlcMode = 'PROGRAM' | 'RUN' | 'TEST' | 'FAULT';

export interface FaultInfo {
  code: number;
  message: string;
  rung: number | null;
  instructionId?: string;
  scan: number;
}

interface ForceMasks {
  on: number;
  off: number;
}

export class PlcEngine {
  mem: DataTable;
  program: CompiledProgram | null = null;
  mode: PlcMode = 'PROGRAM';
  scanCount = 0;
  simTimeMs = 0;
  scanIntervalMs: number;
  fault: FaultInfo | null = null;
  /** True until the first scan after entering RUN/TEST completes. */
  firstScanPending = true;
  /** Field-side input values (what the "wiring" presents), one word per I slot. */
  fieldInputs: Int16Array;
  /** Field-side output values after the output scan. */
  fieldOutputs: Int16Array;
  forcesEnabled = true;
  private forceI = new Map<number, ForceMasks>();
  private forceO = new Map<number, ForceMasks>();
  private ctx: ExecContext = { dtMs: 0, timerFrac: new Map() };
  private project: Project;

  constructor(project: Project) {
    this.project = project;
    this.scanIntervalMs = project.controller.scanIntervalMs;
    this.mem = new DataTable(project.dataFiles, project.data);
    this.fieldInputs = new Int16Array(this.mem.words('I1').length);
    this.fieldOutputs = new Int16Array(this.mem.words('O0').length);
    this.setForces(project.forces, project.forcesEnabled);
    this.compile();
  }

  /** Compiles the current project's program against the current memory. */
  private compile(): void {
    try {
      this.program = compileProgram(this.project.program, this.project.dataFiles, this.project.symbols, this.mem);
    } catch {
      // The program has errors; validation reports them. Nothing can be scanned until it compiles.
      this.program = null;
    }
  }

  /**
   * Replaces the running program (an "online edit"). Live data is preserved;
   * if the data file layout changed, memory is resized keeping existing values.
   * On a compile error the previous program keeps running and the error is thrown.
   */
  updateProject(project: Project): void {
    const prevMem = this.mem;
    const prevProject = this.project;
    let mem = this.mem;
    if (!sameLayout(project.dataFiles, prevMem.defs)) mem = prevMem.resized(project.dataFiles);
    try {
      const compiled = compileProgram(project.program, project.dataFiles, project.symbols, mem);
      this.mem = mem;
      this.program = compiled;
      this.project = project;
      this.scanIntervalMs = project.controller.scanIntervalMs;
      if (this.fieldInputs.length !== mem.words('I1').length) this.fieldInputs = resize16(this.fieldInputs, mem.words('I1').length);
      if (this.fieldOutputs.length !== mem.words('O0').length) this.fieldOutputs = resize16(this.fieldOutputs, mem.words('O0').length);
      this.setForces(project.forces, project.forcesEnabled);
    } catch (e) {
      this.mem = prevMem;
      this.project = prevProject;
      throw e;
    }
  }

  /** Reloads data table values from the project (initial values) and resets runtime state. */
  reset(): void {
    this.mem = new DataTable(this.project.dataFiles, this.project.data);
    this.compile();
    this.mode = 'PROGRAM';
    this.scanCount = 0;
    this.simTimeMs = 0;
    this.fault = null;
    this.firstScanPending = true;
    this.ctx.timerFrac.clear();
    this.fieldOutputs.fill(0);
  }

  setMode(mode: Exclude<PlcMode, 'FAULT'>): void {
    if (this.mode === 'FAULT') return; // must clear fault first
    if (mode === 'RUN' && this.mode === 'PROGRAM') this.firstScanPending = true;
    if (mode === 'PROGRAM') this.fieldOutputs.fill(0);
    this.mode = mode;
  }

  clearFault(): void {
    if (this.mode !== 'FAULT') return;
    this.fault = null;
    const s = this.mem.words('S2');
    s[STATUS.FAULT_CODE_WORD] = 0;
    s[STATUS.MINOR_WORD] = 0;
    this.mode = 'PROGRAM';
    this.firstScanPending = true;
  }

  setForces(forces: ForceDef[], enabled: boolean): void {
    this.forcesEnabled = enabled;
    this.forceI.clear();
    this.forceO.clear();
    for (const f of forces) {
      try {
        const a = resolveAddress(f.address, this.project.dataFiles);
        if (a.bit === null || (a.type !== 'I' && a.type !== 'O')) continue;
        const map = a.type === 'I' ? this.forceI : this.forceO;
        const m = map.get(a.word) ?? { on: 0, off: 0 };
        if (f.value) m.on |= 1 << a.bit;
        else m.off |= 1 << a.bit;
        map.set(a.word, m);
      } catch {
        // invalid force addresses are reported by validation and ignored here
      }
    }
  }

  private applyForce(map: Map<number, ForceMasks>, word: number, value: number): number {
    if (!this.forcesEnabled) return value;
    const m = map.get(word);
    if (!m) return value;
    return (value & ~(m.on | m.off)) | m.on;
  }

  /** Copies field inputs into the input image. Also used in PROGRAM mode so the data table shows live inputs. */
  inputScan(): void {
    const img = this.mem.words('I1');
    for (let w = 0; w < img.length; w++) img[w] = this.applyForce(this.forceI, w, this.fieldInputs[w] ?? 0);
  }

  outputScan(): void {
    const img = this.mem.words('O0');
    for (let w = 0; w < img.length; w++) this.fieldOutputs[w] = this.applyForce(this.forceO, w, img[w]);
  }

  /**
   * Executes one complete scan. In RUN mode this is called by the scheduler; in
   * PROGRAM or TEST mode it performs a single scan and leaves the controller in TEST.
   */
  scan(): boolean {
    if (this.mode === 'FAULT' || !this.program) return false;
    if (this.mode === 'PROGRAM') {
      this.mode = 'TEST';
      this.firstScanPending = true;
    }
    const s = this.mem.words('S2');
    const dt = this.scanIntervalMs;
    this.simTimeMs += dt;
    this.ctx.dtMs = dt;
    if (this.firstScanPending) s[STATUS.FIRST_PASS_WORD] |= 1 << STATUS.FIRST_PASS_BIT;
    s[STATUS.CLOCK_WORD] = Math.floor(this.simTimeMs / 10) & 0xffff;

    this.inputScan();
    let rung = -1;
    try {
      const rungs = this.program.rungs;
      for (rung = 0; rung < rungs.length; rung++) execSeries(rungs[rung], true, this.ctx);
      rung = -1;
    } catch (e) {
      const f = e instanceof PlcFault ? e : new PlcFault(FAULT_CODES.RUNTIME, e instanceof Error ? e.message : String(e));
      this.raiseFault(f.code, f.message, rung >= 0 ? rung : null, f.instructionId);
      return false;
    }
    this.outputScan();

    // Housekeeping
    if (this.firstScanPending) {
      s[STATUS.FIRST_PASS_WORD] &= ~(1 << STATUS.FIRST_PASS_BIT);
      this.firstScanPending = false;
    }
    this.scanCount++;
    if ((s[STATUS.MINOR_WORD] >> STATUS.OVERFLOW_TRAP_BIT) & 1) {
      this.raiseFault(
        FAULT_CODES.OVERFLOW_TRAP,
        'Math overflow trap (S:5/0) was still set at the end of the scan. Clear it with OTU S:5/0 if overflow is expected.',
        null,
      );
      return false;
    }
    return true;
  }

  private raiseFault(code: number, message: string, rung: number | null, instructionId?: string): void {
    this.mode = 'FAULT';
    this.fault = { code, message, rung, instructionId, scan: this.scanCount };
    this.mem.words('S2')[STATUS.FAULT_CODE_WORD] = code;
    this.fieldOutputs.fill(0);
  }

  /** Runs `n` scans (used by tests and by the scheduler to catch up). */
  runScans(n: number): void {
    for (let i = 0; i < n && this.mode !== 'FAULT'; i++) this.scan();
  }

  // ---- field I/O helpers (used by equipment simulations and the I/O panel) ----

  setFieldInput(address: string, value: number): void {
    const a = resolveAddress(address, this.project.dataFiles);
    if (a.type !== 'I') throw new Error(`${address} is not an input address`);
    if (a.bit === null) this.fieldInputs[a.word] = Math.max(-32768, Math.min(32767, Math.round(value)));
    else this.fieldInputs[a.word] = value ? this.fieldInputs[a.word] | (1 << a.bit) : this.fieldInputs[a.word] & ~(1 << a.bit);
  }

  getFieldInput(address: string): number {
    const a = resolveAddress(address, this.project.dataFiles);
    const w = this.fieldInputs[a.word] ?? 0;
    return a.bit === null ? w : (w >> a.bit) & 1;
  }

  getFieldOutput(address: string): number {
    const a = resolveAddress(address, this.project.dataFiles);
    const w = this.fieldOutputs[a.word] ?? 0;
    return a.bit === null ? w : (w >> a.bit) & 1;
  }

  /** Reads any data table address from live memory. */
  read(address: string): number {
    return this.mem.readAddress(address);
  }

  write(address: string, value: number): void {
    this.mem.writeAddress(address, value);
  }
}

function resize16(a: Int16Array, n: number): Int16Array {
  const b = new Int16Array(n);
  b.set(a.subarray(0, Math.min(n, a.length)));
  return b;
}
