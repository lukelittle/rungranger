/**
 * Couples the PLC engine with a virtual equipment model.
 * One simulation step = write field inputs -> PLC scan -> advance plant physics.
 */
import type { EquipmentModel } from '../equipment/models';
import type { PlcEngine } from './engine';

export function writeEquipmentInputs(engine: PlcEngine, model: EquipmentModel<unknown> | null, state: unknown): void {
  if (!model) return;
  model.writeInputs(state, (addr, v) => {
    try {
      engine.setFieldInput(addr, v);
    } catch {
      // the user may have shrunk the I file below what the equipment uses
    }
  });
}

/**
 * Advances the simulation by one scan interval.
 * In RUN mode the PLC scans; in PROGRAM/FAULT mode the plant keeps running with outputs off.
 * TEST mode (paused) freezes everything.
 */
export function simulationStep(engine: PlcEngine, model: EquipmentModel<unknown> | null, state: unknown): void {
  if (engine.mode === 'TEST') return;
  writeEquipmentInputs(engine, model, state);
  if (engine.mode === 'RUN') engine.scan();
  else engine.inputScan();
  if (model) {
    model.step(state, (addr) => {
      try {
        return engine.getFieldOutput(addr);
      } catch {
        return 0;
      }
    }, engine.scanIntervalMs);
  }
}
