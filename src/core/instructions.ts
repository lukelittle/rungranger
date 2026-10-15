/**
 * Instruction set metadata: operand specifications, categories and help text.
 * Help text is original, written for RungRanger from general ladder logic knowledge.
 */
import type { Mnemonic } from './types';

export type OperandKind =
  | 'bit' // bit address
  | 'source' // word/float address or numeric constant
  | 'dest' // writable word/float address
  | 'timer' // T element
  | 'counter' // C element
  | 'resettable' // T, C or R element
  | 'timebase'; // 1.0 or 0.01

export interface OperandSpec {
  name: string;
  kind: OperandKind;
}

export type InstructionCategory = 'Bit' | 'Timer/Counter' | 'Compare' | 'Math/Move';

export interface InstructionInfo {
  mnemonic: Mnemonic;
  name: string;
  category: InstructionCategory;
  /** Input instructions condition the rung; output instructions act on the rung condition. */
  role: 'input' | 'output';
  /** Drawn as a box (vs. a contact or coil symbol). */
  box: boolean;
  operands: OperandSpec[];
  /** Extra values that live in the data table but are shown/entered with the instruction (e.g. timer preset). */
  dataFields?: { name: string; member: 'PRE' | 'ACC' }[];
  summary: string;
  details: string[];
  example: string;
}

const T_FIELDS: InstructionInfo['dataFields'] = [
  { name: 'Preset', member: 'PRE' },
  { name: 'Accum', member: 'ACC' },
];

export const INSTRUCTIONS: Record<Mnemonic, InstructionInfo> = {
  XIC: {
    mnemonic: 'XIC', name: 'Examine If Closed', category: 'Bit', role: 'input', box: false,
    operands: [{ name: 'Bit', kind: 'bit' }],
    summary: 'True when the addressed bit is 1 (ON).',
    details: [
      'Think of it as a normally-open contact that "looks at" a bit in the data table.',
      'If the bit is 1 the instruction is true and passes rung power to the right.',
      'Note: a field device wired normally-closed (such as a stop button) sets its input bit to 1 when NOT pressed, so it is usually programmed with XIC.',
    ],
    example: 'XIC I:1/0',
  },
  XIO: {
    mnemonic: 'XIO', name: 'Examine If Open', category: 'Bit', role: 'input', box: false,
    operands: [{ name: 'Bit', kind: 'bit' }],
    summary: 'True when the addressed bit is 0 (OFF).',
    details: [
      'Behaves like a normally-closed contact that looks at a bit in the data table.',
      'If the bit is 0 the instruction is true; if the bit is 1 it is false.',
    ],
    example: 'XIO B3:0/0',
  },
  OTE: {
    mnemonic: 'OTE', name: 'Output Energize', category: 'Bit', role: 'output', box: false,
    operands: [{ name: 'Bit', kind: 'bit' }],
    summary: 'Sets the bit to 1 when the rung is true, and to 0 when the rung is false.',
    details: [
      'Non-retentive: the bit follows the rung condition every scan.',
      'Using the same OTE address on more than one rung is legal but usually a mistake: the last rung scanned wins.',
    ],
    example: 'OTE O:2/0',
  },
  OTL: {
    mnemonic: 'OTL', name: 'Output Latch', category: 'Bit', role: 'output', box: false,
    operands: [{ name: 'Bit', kind: 'bit' }],
    summary: 'Sets the bit to 1 when the rung is true. Does nothing when the rung is false.',
    details: [
      'Retentive: once latched, the bit stays 1 until an OTU (or other logic) clears it.',
      'Normally used in pairs with OTU on the same address.',
    ],
    example: 'OTL B3:0/0',
  },
  OTU: {
    mnemonic: 'OTU', name: 'Output Unlatch', category: 'Bit', role: 'output', box: false,
    operands: [{ name: 'Bit', kind: 'bit' }],
    summary: 'Clears the bit to 0 when the rung is true. Does nothing when the rung is false.',
    details: ['Used with OTL to release a latched bit.'],
    example: 'OTU B3:0/0',
  },
  TON: {
    mnemonic: 'TON', name: 'Timer On-Delay', category: 'Timer/Counter', role: 'output', box: true,
    operands: [{ name: 'Timer', kind: 'timer' }, { name: 'Time Base', kind: 'timebase' }],
    dataFields: T_FIELDS,
    summary: 'Times while the rung is true; sets DN when the accumulator reaches the preset.',
    details: [
      'Rung true: EN = 1. The accumulator (ACC) counts time-base units while ACC < PRE, with TT = 1.',
      'When ACC reaches PRE, DN = 1 and TT = 0. In RungRanger the accumulator stops at the preset.',
      'Rung false: EN, TT and DN are cleared and ACC is reset to 0.',
      'Time base 1.0 = seconds, 0.01 = hundredths of a second. A preset of 50 with time base 0.1 is not available; use 5 at 1.0 or 500 at 0.01.',
      'A negative preset or accumulator causes a simulated major fault.',
    ],
    example: 'TON T4:0 1.0 5 0',
  },
  TOF: {
    mnemonic: 'TOF', name: 'Timer Off-Delay', category: 'Timer/Counter', role: 'output', box: true,
    operands: [{ name: 'Timer', kind: 'timer' }, { name: 'Time Base', kind: 'timebase' }],
    dataFields: T_FIELDS,
    summary: 'DN turns on immediately with a true rung and turns off PRE time after the rung goes false.',
    details: [
      'Rung true: EN = 1, DN = 1, TT = 0, ACC = 0.',
      'Rung false: EN = 0. While DN is 1 the timer times (TT = 1). When ACC reaches PRE, DN and TT are cleared.',
      'Useful for keeping a cooling fan running for a while after a motor stops.',
      'Use RES carefully with TOF: resetting a TOF clears its bits and accumulator.',
    ],
    example: 'TOF T4:1 1.0 10 0',
  },
  RTO: {
    mnemonic: 'RTO', name: 'Retentive Timer On', category: 'Timer/Counter', role: 'output', box: true,
    operands: [{ name: 'Timer', kind: 'timer' }, { name: 'Time Base', kind: 'timebase' }],
    dataFields: T_FIELDS,
    summary: 'Like TON, but keeps its accumulated value when the rung goes false.',
    details: [
      'Rung true: EN = 1, timing while ACC < PRE (TT = 1). DN = 1 when ACC reaches PRE.',
      'Rung false: EN and TT are cleared, but ACC and DN are retained.',
      'Use a RES instruction with the same timer address to clear it.',
    ],
    example: 'RTO T4:2 1.0 3600 0',
  },
  RES: {
    mnemonic: 'RES', name: 'Reset', category: 'Timer/Counter', role: 'output', box: false,
    operands: [{ name: 'Structure', kind: 'resettable' }],
    summary: 'Resets a timer, counter or control element when the rung is true.',
    details: [
      'Timer: ACC = 0 and EN, TT, DN cleared.',
      'Counter: ACC = 0 and CU, CD, DN, OV, UN cleared.',
      'Control: POS = 0 and status bits cleared.',
      'The preset is not changed.',
    ],
    example: 'RES C5:0',
  },
  CTU: {
    mnemonic: 'CTU', name: 'Count Up', category: 'Timer/Counter', role: 'output', box: true,
    operands: [{ name: 'Counter', kind: 'counter' }],
    dataFields: T_FIELDS,
    summary: 'Adds 1 to the accumulator on each false-to-true transition of the rung.',
    details: [
      'The CU bit remembers the previous rung state, so the count only advances on a rising edge.',
      'DN = 1 while ACC >= PRE.',
      'Counting above 32767 wraps to -32768 and sets the overflow bit OV.',
      'The accumulator is retained when the rung goes false. Use RES to clear it.',
    ],
    example: 'CTU C5:0 10 0',
  },
  CTD: {
    mnemonic: 'CTD', name: 'Count Down', category: 'Timer/Counter', role: 'output', box: true,
    operands: [{ name: 'Counter', kind: 'counter' }],
    dataFields: T_FIELDS,
    summary: 'Subtracts 1 from the accumulator on each false-to-true transition of the rung.',
    details: [
      'The CD bit remembers the previous rung state, so the count only changes on a rising edge.',
      'DN = 1 while ACC >= PRE.',
      'Counting below -32768 wraps to 32767 and sets the underflow bit UN.',
      'Often paired with a CTU on the same counter address for up/down counting.',
    ],
    example: 'CTD C5:0 10 0',
  },
  MOV: {
    mnemonic: 'MOV', name: 'Move', category: 'Math/Move', role: 'output', box: true,
    operands: [{ name: 'Source', kind: 'source' }, { name: 'Dest', kind: 'dest' }],
    summary: 'Copies Source into Dest every scan the rung is true.',
    details: [
      'Source may be a constant or an address. Moving a float into an integer rounds the value.',
      'Values that do not fit a 16-bit integer are clamped and set the overflow status bit.',
    ],
    example: 'MOV 100 N7:0',
  },
  EQU: {
    mnemonic: 'EQU', name: 'Equal', category: 'Compare', role: 'input', box: true,
    operands: [{ name: 'Source A', kind: 'source' }, { name: 'Source B', kind: 'source' }],
    summary: 'True when Source A equals Source B.',
    details: ['Either source may be a constant or an address. Comparing floats for exact equality is rarely a good idea.'],
    example: 'EQU N7:0 10',
  },
  NEQ: {
    mnemonic: 'NEQ', name: 'Not Equal', category: 'Compare', role: 'input', box: true,
    operands: [{ name: 'Source A', kind: 'source' }, { name: 'Source B', kind: 'source' }],
    summary: 'True when Source A is not equal to Source B.',
    details: ['Either source may be a constant or an address.'],
    example: 'NEQ N7:0 0',
  },
  LES: {
    mnemonic: 'LES', name: 'Less Than', category: 'Compare', role: 'input', box: true,
    operands: [{ name: 'Source A', kind: 'source' }, { name: 'Source B', kind: 'source' }],
    summary: 'True when Source A is less than Source B.',
    details: ['Either source may be a constant or an address. Integers are compared as signed values.'],
    example: 'LES N7:0 250',
  },
  GRT: {
    mnemonic: 'GRT', name: 'Greater Than', category: 'Compare', role: 'input', box: true,
    operands: [{ name: 'Source A', kind: 'source' }, { name: 'Source B', kind: 'source' }],
    summary: 'True when Source A is greater than Source B.',
    details: ['Either source may be a constant or an address. Integers are compared as signed values.'],
    example: 'GRT N7:0 750',
  },
  ADD: {
    mnemonic: 'ADD', name: 'Add', category: 'Math/Move', role: 'output', box: true,
    operands: [{ name: 'Source A', kind: 'source' }, { name: 'Source B', kind: 'source' }, { name: 'Dest', kind: 'dest' }],
    summary: 'Dest = Source A + Source B, every scan the rung is true.',
    details: [
      'Executes every scan while the rung is true, so "ADD N7:0 1 N7:0" counts up once per scan.',
      'Integer overflow clamps the result to 32767 / -32768, sets S:0/1 (V) and the overflow trap S:5/0.',
      'If S:5/0 is still set at the end of the scan, the simulated processor major-faults. Clear it with OTU S:5/0 if overflow is expected.',
    ],
    example: 'ADD N7:0 1 N7:0',
  },
  SUB: {
    mnemonic: 'SUB', name: 'Subtract', category: 'Math/Move', role: 'output', box: true,
    operands: [{ name: 'Source A', kind: 'source' }, { name: 'Source B', kind: 'source' }, { name: 'Dest', kind: 'dest' }],
    summary: 'Dest = Source A - Source B, every scan the rung is true.',
    details: [
      'Executes every scan while the rung is true.',
      'Integer overflow behaves as for ADD.',
    ],
    example: 'SUB N7:1 N7:0 N7:2',
  },
};

export const CATEGORY_ORDER: InstructionCategory[] = ['Bit', 'Timer/Counter', 'Compare', 'Math/Move'];

export function isMnemonic(text: string): text is Mnemonic {
  return Object.prototype.hasOwnProperty.call(INSTRUCTIONS, text);
}

/** Number of tokens the instruction takes in ASCII rung text (includes preset/accum for timers and counters). */
export function asciiOperandCount(m: Mnemonic): number {
  const info = INSTRUCTIONS[m];
  return info.operands.length + (info.dataFields?.length ?? 0);
}

export const TIME_BASES = ['1.0', '0.01'] as const;

export function timeBaseMs(tb: string): number | null {
  const t = tb.trim();
  if (t === '1.0' || t === '1' || t === '1.00') return 1000;
  if (t === '0.01' || t === '.01') return 10;
  return null;
}
