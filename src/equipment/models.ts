/**
 * Virtual equipment ("the plant"). Each model reads the controller's field
 * outputs, advances its own physics by the simulated scan time, and writes
 * field inputs. Models are plain mutable objects so the UI can poke them
 * (press a button, open a valve) between scans.
 */
import type { EquipmentKind } from '../core/types';

export interface EquipmentIo {
  address: string;
  label: string;
  dir: 'in' | 'out';
}

export type ReadOutput = (address: string) => number;
export type WriteInput = (address: string, value: number) => void;

export interface EquipmentModel<S = unknown> {
  kind: EquipmentKind;
  title: string;
  io: EquipmentIo[];
  init(): S;
  /** Advances the physics by dtMs using the current field outputs. */
  step(state: S, out: ReadOutput, dtMs: number): void;
  /** Writes the field inputs the equipment presents to the controller. */
  writeInputs(state: S, write: WriteInput): void;
}

// ---------------------------------------------------------------- Motor starter

export interface MotorState {
  startPressed: boolean;
  stopPressed: boolean;
  resetPressed: boolean;
  heavyLoad: boolean;
  /** Motor speed 0..1 */
  speed: number;
  /** Shaft angle in degrees, for animation. */
  angle: number;
  /** Overload relay thermal element, 0..1; trips at 1, resets below 0.4. */
  heat: number;
  olTripped: boolean;
}

export const motorStarterModel: EquipmentModel<MotorState> = {
  kind: 'motor-starter',
  title: 'Motor Starter',
  io: [
    { address: 'I:1/0', label: 'START (N.O.)', dir: 'in' },
    { address: 'I:1/1', label: 'STOP (N.C.)', dir: 'in' },
    { address: 'I:1/2', label: 'Overload contact (N.C.)', dir: 'in' },
    { address: 'I:1/3', label: 'RESET (N.O.)', dir: 'in' },
    { address: 'O:2/0', label: 'Motor contactor M1', dir: 'out' },
    { address: 'O:2/1', label: 'Run light', dir: 'out' },
    { address: 'O:2/2', label: 'Fault light', dir: 'out' },
  ],
  init: () => ({ startPressed: false, stopPressed: false, resetPressed: false, heavyLoad: false, speed: 0, angle: 0, heat: 0, olTripped: false }),
  step(s, out, dt) {
    const sec = dt / 1000;
    // The contactor only powers the motor while the overload relay is closed.
    const powered = out('O:2/0') === 1 && !s.olTripped;
    const target = powered ? (s.heavyLoad ? 0.8 : 1) : 0;
    s.speed += (target - s.speed) * Math.min(1, sec * (powered ? 2.5 : 1.2));
    if (s.speed < 0.002) s.speed = 0;
    s.angle = (s.angle + s.speed * 720 * sec) % 360;
    const heating = powered ? (s.heavyLoad ? 0.28 : -0.05) : -0.12;
    s.heat = Math.max(0, Math.min(1.2, s.heat + heating * sec));
    if (s.heat >= 1) s.olTripped = true;
    if (s.olTripped && s.heat < 0.4) s.olTripped = false; // auto-reset overload relay once cool
  },
  writeInputs(s, write) {
    write('I:1/0', s.startPressed ? 1 : 0);
    write('I:1/1', s.stopPressed ? 0 : 1);
    write('I:1/2', s.olTripped ? 0 : 1);
    write('I:1/3', s.resetPressed ? 1 : 0);
  },
};

// ---------------------------------------------------------------- Conveyor

export const CONVEYOR_LENGTH = 100;
export const BOX_WIDTH = 8;
export const PE_INFEED_X = 18;
export const PE_EXIT_X = 86;

export interface Box {
  id: number;
  /** Left edge position along the belt, 0..CONVEYOR_LENGTH */
  x: number;
  jammed: boolean;
}

export interface ConveyorState {
  startPressed: boolean;
  stopPressed: boolean;
  resetPressed: boolean;
  autoFeed: boolean;
  /** Next box arriving at the infeed will jam under the infeed eye. */
  jamNext: boolean;
  boxes: Box[];
  nextId: number;
  feedTimer: number;
  beltOffset: number;
  delivered: number;
}

const BELT_SPEED = 14; // units per second

export const conveyorModel: EquipmentModel<ConveyorState> = {
  kind: 'conveyor',
  title: 'Conveyor',
  io: [
    { address: 'I:1/0', label: 'START', dir: 'in' },
    { address: 'I:1/1', label: 'STOP (N.C.)', dir: 'in' },
    { address: 'I:1/2', label: 'Infeed photo-eye', dir: 'in' },
    { address: 'I:1/3', label: 'Exit photo-eye', dir: 'in' },
    { address: 'I:1/4', label: 'RESET', dir: 'in' },
    { address: 'O:2/0', label: 'Conveyor motor', dir: 'out' },
    { address: 'O:2/1', label: 'Run light', dir: 'out' },
    { address: 'O:2/2', label: 'Batch complete', dir: 'out' },
    { address: 'O:2/3', label: 'Jam alarm', dir: 'out' },
  ],
  init: () => ({ startPressed: false, stopPressed: false, resetPressed: false, autoFeed: true, jamNext: false, boxes: [], nextId: 1, feedTimer: 0, beltOffset: 0, delivered: 0 }),
  step(s, out, dt) {
    const sec = dt / 1000;
    const running = out('O:2/0') === 1;
    if (running) s.beltOffset = (s.beltOffset + BELT_SPEED * sec) % 10;
    // Move boxes front to back so they queue instead of overlapping.
    const sorted = [...s.boxes].sort((a, b) => b.x - a.x);
    let limit = Infinity;
    for (const b of sorted) {
      if (running && !b.jammed) {
        b.x = Math.max(b.x, Math.min(b.x + BELT_SPEED * sec, limit - BOX_WIDTH - 1));
        if (s.jamNext && b.x + BOX_WIDTH > PE_INFEED_X + 3 && b.x < PE_INFEED_X) {
          b.jammed = true;
          s.jamNext = false;
        }
      }
      limit = b.x;
    }
    const before = s.boxes.length;
    s.boxes = s.boxes.filter((b) => b.x < CONVEYOR_LENGTH);
    s.delivered += before - s.boxes.length;
    if (s.autoFeed) {
      s.feedTimer += dt;
      if (s.feedTimer >= 2600) {
        s.feedTimer = 0;
        conveyorAddBox(s);
      }
    }
  },
  writeInputs(s, write) {
    const blocks = (x: number) => s.boxes.some((b) => b.x <= x && b.x + BOX_WIDTH >= x);
    write('I:1/0', s.startPressed ? 1 : 0);
    write('I:1/1', s.stopPressed ? 0 : 1);
    write('I:1/2', blocks(PE_INFEED_X) ? 1 : 0);
    write('I:1/3', blocks(PE_EXIT_X) ? 1 : 0);
    write('I:1/4', s.resetPressed ? 1 : 0);
  },
};

/** Places a new box at the start of the belt if there is room. */
export function conveyorAddBox(s: ConveyorState): boolean {
  if (s.boxes.some((b) => b.x < BOX_WIDTH + 2)) return false;
  s.boxes.push({ id: s.nextId++, x: 0, jammed: false });
  return true;
}

export function conveyorClearJam(s: ConveyorState): void {
  s.jamNext = false;
  for (const b of s.boxes) b.jammed = false;
}

// ---------------------------------------------------------------- Tank

export const TANK_LSL = 20;
export const TANK_LSH = 80;

export interface TankState {
  auto: boolean;
  resetPressed: boolean;
  /** 0..100 % */
  level: number;
  /** Outlet (demand) valve opening 0..1 */
  outletValve: number;
  supplyOpen: boolean;
  pumpFailed: boolean;
  pumpSpeed: number;
  impeller: number;
}

const FILL_RATE = 5; // % per second with the pump running
const DRAIN_RATE = 3; // % per second at full outlet opening

export const tankModel: EquipmentModel<TankState> = {
  kind: 'tank',
  title: 'Tank',
  io: [
    { address: 'I:1/0', label: 'AUTO selector', dir: 'in' },
    { address: 'I:1/1', label: 'Low level switch (LSL)', dir: 'in' },
    { address: 'I:1/2', label: 'High level switch (LSH)', dir: 'in' },
    { address: 'I:1/3', label: 'Pump aux contact', dir: 'in' },
    { address: 'I:1/4', label: 'RESET', dir: 'in' },
    { address: 'I:3', label: 'Level transmitter (0-1000)', dir: 'in' },
    { address: 'O:2/0', label: 'Pump', dir: 'out' },
    { address: 'O:2/1', label: 'Fault light', dir: 'out' },
    { address: 'O:2/2', label: 'High level light', dir: 'out' },
  ],
  init: () => ({ auto: true, resetPressed: false, level: 35, outletValve: 0.5, supplyOpen: true, pumpFailed: false, pumpSpeed: 0, impeller: 0 }),
  step(s, out, dt) {
    const sec = dt / 1000;
    const running = out('O:2/0') === 1 && !s.pumpFailed;
    s.pumpSpeed += ((running ? 1 : 0) - s.pumpSpeed) * Math.min(1, sec * 3);
    if (s.pumpSpeed < 0.002) s.pumpSpeed = 0;
    s.impeller = (s.impeller + s.pumpSpeed * 900 * sec) % 360;
    const inflow = s.supplyOpen ? FILL_RATE * s.pumpSpeed : 0;
    const outflow = DRAIN_RATE * s.outletValve * Math.min(1, s.level / 5);
    s.level = Math.max(0, Math.min(100, s.level + (inflow - outflow) * sec));
  },
  writeInputs(s, write) {
    write('I:1/0', s.auto ? 1 : 0);
    write('I:1/1', s.level > TANK_LSL ? 1 : 0);
    write('I:1/2', s.level > TANK_LSH ? 1 : 0);
    write('I:1/3', s.pumpSpeed > 0.5 ? 1 : 0);
    write('I:1/4', s.resetPressed ? 1 : 0);
    write('I:3', Math.round(s.level * 10));
  },
};

export const EQUIPMENT_MODELS: Record<EquipmentKind, EquipmentModel<never>> = {
  'motor-starter': motorStarterModel as EquipmentModel<never>,
  conveyor: conveyorModel as EquipmentModel<never>,
  tank: tankModel as EquipmentModel<never>,
};
