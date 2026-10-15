/**
 * Compiles the ladder AST into a tree of executable closures bound to a DataTable.
 *
 * Execution model (per rung): power enters from the left rail as TRUE and flows
 * through the series of elements. Every instruction is executed every scan with
 * its rung-condition-in, so output instructions see FALSE when upstream logic is
 * false (an OTE clears its bit, a TON resets, etc.). A branch passes the same
 * rung-condition-in to each leg and its output is the OR of all legs.
 */
import { checkOperand, symbolLookup, type CheckedOperand } from '../core/operands';
import { INSTRUCTIONS } from '../core/instructions';
import type { ResolvedAddress } from '../core/address';
import type { DataFileDef, Element, Instruction, ProgramFile, SymbolDef } from '../core/types';
import type { DataTable } from './memory';

/** Status file (S2) word / bit assignments that RungRanger simulates. */
export const STATUS = {
  ARITH_WORD: 0, // S:0  C=0 V=1 Z=2 S=3
  CARRY: 0,
  OVERFLOW: 1,
  ZERO: 2,
  SIGN: 3,
  FIRST_PASS_WORD: 1, // S:1/15
  FIRST_PASS_BIT: 15,
  CLOCK_WORD: 4, // S:4 free-running clock, 10 ms per count
  MINOR_WORD: 5, // S:5/0 overflow trap
  OVERFLOW_TRAP_BIT: 0,
  FAULT_CODE_WORD: 6, // S:6 major fault code
} as const;

export const FAULT_CODES = {
  OVERFLOW_TRAP: 0x0020,
  NEGATIVE_TIMER: 0x0034,
  RUNTIME: 0x00ff,
} as const;

export class PlcFault extends Error {
  constructor(public code: number, message: string, public instructionId?: string) {
    super(message);
  }
}

export interface ExecContext {
  /** Simulated time elapsed since the previous scan, in ms. */
  dtMs: number;
  /** Sub-time-base remainders for timers, keyed by "T4:<word>". */
  timerFrac: Map<string, number>;
}

export interface TraceBuffers {
  /** Rung-condition-in per instruction index. */
  pin: Uint8Array;
  /** Rung-condition-out per instruction index. */
  pout: Uint8Array;
  /** Instruction "true" state used for highlighting. */
  state: Uint8Array;
}

type Exec = (rin: boolean, ctx: ExecContext) => boolean;

export type CompiledNode =
  | { t: 'i'; index: number; id: string; exec: Exec }
  | { t: 'b'; legs: CompiledNode[][] };

export interface CompiledProgram {
  rungs: CompiledNode[][];
  /** Instruction id -> trace index. */
  index: Map<string, number>;
  /** Trace index -> rung number. */
  rungOf: number[];
  count: number;
  trace: TraceBuffers;
}

export class CompileError extends Error {
  constructor(message: string, public rung: number, public instructionId: string) {
    super(message);
  }
}

const bitOf = (w: number, b: number) => (w >> b) & 1;

/** Round half to even (banker's rounding) for float to integer conversion. */
export function roundHalfEven(v: number): number {
  const r = Math.round(v);
  if (Math.abs(v % 1) === 0.5 && r % 2 !== 0) return r - 1;
  return r;
}

export function compileProgram(program: ProgramFile, files: DataFileDef[], symbols: SymbolDef[], mem: DataTable): CompiledProgram {
  const lookup = symbolLookup(symbols);
  const index = new Map<string, number>();
  const rungOf: number[] = [];
  let count = 0;
  // Trace arrays are allocated after counting; closures reference this holder.
  const trace: TraceBuffers = { pin: new Uint8Array(0), pout: new Uint8Array(0), state: new Uint8Array(0) };
  const status = mem.words('S2') as Int16Array;

  const setStatusBit = (word: number, bit: number, v: boolean) => {
    status[word] = v ? status[word] | (1 << bit) : status[word] & ~(1 << bit);
  };

  const compileSeries = (series: Element[], rung: number): CompiledNode[] =>
    series.map((el) => (el.kind === 'branch' ? { t: 'b', legs: el.legs.map((l) => compileSeries(l, rung)) } : compileInstr(el, rung)));

  const compileInstr = (ins: Instruction, rung: number): CompiledNode => {
    const info = INSTRUCTIONS[ins.mnemonic];
    if (!info) throw new CompileError(`unknown instruction ${ins.mnemonic}`, rung, ins.id);
    if (ins.operands.length !== info.operands.length) {
      throw new CompileError(`${ins.mnemonic} expects ${info.operands.length} operand(s)`, rung, ins.id);
    }
    const ops: CheckedOperand[] = info.operands.map((spec, i) => checkOperand(spec.kind, ins.operands[i], files, lookup));
    ops.forEach((o, i) => {
      if (!o.ok) throw new CompileError(`${ins.mnemonic} ${info.operands[i].name}: ${o.error}`, rung, ins.id);
    });
    const idx = count++;
    index.set(ins.id, idx);
    rungOf[idx] = rung;
    const exec = buildExec(ins, ops, idx);
    return { t: 'i', index: idx, id: ins.id, exec };
  };

  const addr = (o: CheckedOperand): ResolvedAddress => {
    if (o.ok && o.type === 'address') return o.address;
    throw new Error('expected address operand');
  };

  const reader = (o: CheckedOperand): (() => number) => {
    if (o.ok && o.type === 'constant') {
      const v = o.value;
      return () => v;
    }
    const a = addr(o);
    const arr = mem.words(a.key);
    const w = a.word;
    return () => arr[w];
  };

  /** Writes a math result to a destination and updates the arithmetic status bits. */
  const writer = (o: CheckedOperand): ((v: number) => number) => {
    const a = addr(o);
    const arr = mem.words(a.key);
    const w = a.word;
    if (a.isFloat) {
      return (v) => {
        arr[w] = v;
        const stored = arr[w];
        setStatusBit(STATUS.ARITH_WORD, STATUS.OVERFLOW, !Number.isFinite(stored));
        setStatusBit(STATUS.ARITH_WORD, STATUS.ZERO, stored === 0);
        setStatusBit(STATUS.ARITH_WORD, STATUS.SIGN, stored < 0);
        if (!Number.isFinite(stored)) setStatusBit(STATUS.MINOR_WORD, STATUS.OVERFLOW_TRAP_BIT, true);
        return stored;
      };
    }
    return (v) => {
      let r = Number.isInteger(v) ? v : roundHalfEven(v);
      let overflow = false;
      if (!Number.isFinite(r) || r > 32767) {
        r = r === -Infinity ? -32768 : 32767;
        overflow = true;
      } else if (r < -32768) {
        r = -32768;
        overflow = true;
      }
      arr[w] = r;
      setStatusBit(STATUS.ARITH_WORD, STATUS.OVERFLOW, overflow);
      setStatusBit(STATUS.ARITH_WORD, STATUS.ZERO, r === 0);
      setStatusBit(STATUS.ARITH_WORD, STATUS.SIGN, r < 0);
      if (overflow) setStatusBit(STATUS.MINOR_WORD, STATUS.OVERFLOW_TRAP_BIT, true);
      return r;
    };
  };

  const isInt = (o: CheckedOperand) => (o.ok && o.type === 'constant' ? Number.isInteger(o.value) : o.ok && o.type === 'address' && !o.address.isFloat);

  const buildExec = (ins: Instruction, ops: CheckedOperand[], idx: number): Exec => {
    const id = ins.id;
    const rec = (rin: boolean, out: boolean, state: boolean) => {
      trace.pin[idx] = rin ? 1 : 0;
      trace.pout[idx] = out ? 1 : 0;
      trace.state[idx] = state ? 1 : 0;
      return out;
    };

    switch (ins.mnemonic) {
      case 'XIC':
      case 'XIO': {
        const a = addr(ops[0]);
        const arr = mem.words(a.key);
        const w = a.word;
        const b = a.bit!;
        const want = ins.mnemonic === 'XIC' ? 1 : 0;
        return (rin) => {
          const cond = bitOf(arr[w], b) === want;
          return rec(rin, rin && cond, cond);
        };
      }
      case 'OTE':
      case 'OTL':
      case 'OTU': {
        const a = addr(ops[0]);
        const arr = mem.words(a.key);
        const w = a.word;
        const mask = 1 << a.bit!;
        const m = ins.mnemonic;
        return (rin) => {
          if (m === 'OTE') arr[w] = rin ? arr[w] | mask : arr[w] & ~mask;
          else if (rin) arr[w] = m === 'OTL' ? arr[w] | mask : arr[w] & ~mask;
          return rec(rin, rin, (arr[w] & mask) !== 0);
        };
      }
      case 'TON':
      case 'TOF':
      case 'RTO': {
        const a = addr(ops[0]);
        const arr = mem.words(a.key) as Int16Array;
        const base = a.word;
        const tb = ops[1].ok && ops[1].type === 'timebase' ? ops[1].ms : 1000;
        const fracKey = `${a.key}:${base}`;
        const EN = 1 << 15, TT = 1 << 14, DN = 1 << 13;
        const m = ins.mnemonic;
        const accumulate = (ctx: ExecContext, acc: number, pre: number): number => {
          let frac = (ctx.timerFrac.get(fracKey) ?? 0) + ctx.dtMs;
          const ticks = Math.floor(frac / tb);
          frac -= ticks * tb;
          ctx.timerFrac.set(fracKey, frac);
          return Math.min(pre, acc + ticks);
        };
        return (rin, ctx) => {
          let ctl = arr[base];
          const pre = arr[base + 1];
          let acc = arr[base + 2];
          if (pre < 0 || acc < 0) {
            throw new PlcFault(FAULT_CODES.NEGATIVE_TIMER, `Timer ${ins.operands[0]} has a negative preset or accumulator (PRE=${pre}, ACC=${acc})`, id);
          }
          const wasEN = (ctl & EN) !== 0;
          if (m === 'TON') {
            if (rin) {
              if (!wasEN) ctx.timerFrac.set(fracKey, 0);
              else if (acc < pre) acc = accumulate(ctx, acc, pre);
              ctl |= EN;
              ctl = acc >= pre ? (ctl | DN) & ~TT : (ctl | TT) & ~DN;
            } else {
              ctl &= ~(EN | TT | DN);
              acc = 0;
              ctx.timerFrac.set(fracKey, 0);
            }
          } else if (m === 'RTO') {
            if (rin) {
              if (wasEN && acc < pre) acc = accumulate(ctx, acc, pre);
              ctl |= EN;
              ctl = acc >= pre ? (ctl | DN) & ~TT : (ctl | TT) & ~DN;
            } else {
              ctl &= ~(EN | TT);
            }
          } else {
            // TOF
            if (rin) {
              ctl = (ctl | EN | DN) & ~TT;
              acc = 0;
              ctx.timerFrac.set(fracKey, 0);
            } else {
              ctl &= ~EN;
              if (ctl & DN) {
                if (!wasEN && acc < pre) acc = accumulate(ctx, acc, pre);
                ctl = acc >= pre ? ctl & ~(DN | TT) : ctl | TT;
              } else {
                ctl &= ~TT;
              }
            }
          }
          arr[base] = ctl;
          arr[base + 2] = acc;
          return rec(rin, rin, (ctl & (m === 'TOF' ? DN : EN)) !== 0);
        };
      }
      case 'RES': {
        const a = addr(ops[0]);
        const arr = mem.words(a.key);
        const base = a.word;
        const fracKey = `${a.key}:${base}`;
        return (rin, ctx) => {
          if (rin) {
            arr[base] = 0;
            arr[base + 2] = 0;
            if (a.type === 'T') ctx.timerFrac.set(fracKey, 0);
          }
          return rec(rin, rin, rin);
        };
      }
      case 'CTU':
      case 'CTD': {
        const a = addr(ops[0]);
        const arr = mem.words(a.key) as Int16Array;
        const base = a.word;
        const up = ins.mnemonic === 'CTU';
        const EDGE = up ? 1 << 15 : 1 << 14; // CU or CD
        const DN = 1 << 13, OV = 1 << 12, UN = 1 << 11;
        return (rin) => {
          let ctl = arr[base];
          const pre = arr[base + 1];
          let acc = arr[base + 2];
          if (rin && (ctl & EDGE) === 0) {
            if (up) {
              if (acc === 32767) {
                acc = -32768;
                ctl |= OV;
              } else acc++;
            } else if (acc === -32768) {
              acc = 32767;
              ctl |= UN;
            } else acc--;
          }
          ctl = rin ? ctl | EDGE : ctl & ~EDGE;
          ctl = acc >= pre ? ctl | DN : ctl & ~DN;
          arr[base] = ctl;
          arr[base + 2] = acc;
          return rec(rin, rin, (ctl & EDGE) !== 0);
        };
      }
      case 'MOV': {
        const src = reader(ops[0]);
        const dst = writer(ops[1]);
        return (rin) => {
          if (rin) dst(src());
          return rec(rin, rin, rin);
        };
      }
      case 'ADD':
      case 'SUB': {
        const ra = reader(ops[0]);
        const rb = reader(ops[1]);
        const dst = writer(ops[2]);
        const add = ins.mnemonic === 'ADD';
        const intMath = isInt(ops[0]) && isInt(ops[1]);
        return (rin) => {
          if (rin) {
            const x = ra();
            const y = rb();
            let r = add ? x + y : x - y;
            if (!intMath) r = Math.fround(r);
            dst(r);
            if (intMath) {
              // Carry/borrow from unsigned 16-bit arithmetic.
              const ux = x & 0xffff, uy = y & 0xffff;
              const carry = add ? ux + uy > 0xffff : ux < uy;
              setStatusBit(STATUS.ARITH_WORD, STATUS.CARRY, carry);
            } else setStatusBit(STATUS.ARITH_WORD, STATUS.CARRY, false);
          }
          return rec(rin, rin, rin);
        };
      }
      case 'EQU':
      case 'NEQ':
      case 'LES':
      case 'GRT': {
        const ra = reader(ops[0]);
        const rb = reader(ops[1]);
        const m = ins.mnemonic;
        return (rin) => {
          const x = ra();
          const y = rb();
          const cond = m === 'EQU' ? x === y : m === 'NEQ' ? x !== y : m === 'LES' ? x < y : x > y;
          return rec(rin, rin && cond, cond);
        };
      }
    }
  };

  const rungs = program.rungs.map((r, i) => compileSeries(r.elements, i));
  trace.pin = new Uint8Array(count);
  trace.pout = new Uint8Array(count);
  trace.state = new Uint8Array(count);
  return { rungs, index, rungOf, count, trace };
}

export function execSeries(series: CompiledNode[], rin: boolean, ctx: ExecContext): boolean {
  let power = rin;
  for (const node of series) {
    if (node.t === 'i') power = node.exec(power, ctx);
    else {
      let out = false;
      for (const leg of node.legs) {
        if (execSeries(leg, power, ctx)) out = true;
      }
      power = out;
    }
  }
  return power;
}
