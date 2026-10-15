import { describe, expect, it } from 'vitest';
import { validateProject } from '../core/validate';
import { conveyorModel, motorStarterModel, tankModel, type ConveyorState, type MotorState, type TankState } from '../equipment/models';
import { PlcEngine } from '../runtime/engine';
import { simulationStep } from '../runtime/simulation';
import type { EquipmentModel } from '../equipment/models';
import { createExample, EXAMPLES } from './index';

function rig<S>(key: string, model: EquipmentModel<S>) {
  const project = createExample(key);
  const engine = new PlcEngine(project);
  const state = model.init();
  engine.setMode('RUN');
  const run = (ms: number) => {
    const n = Math.round(ms / engine.scanIntervalMs);
    for (let i = 0; i < n; i++) simulationStep(engine, model as EquipmentModel<unknown>, state);
  };
  return { engine, state, run };
}

describe('example projects', () => {
  it.each(EXAMPLES.map((e) => e.key))('%s has no validation errors', (key) => {
    const diags = validateProject(createExample(key));
    expect(diags.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('motor starter: start, seal in, stop, overload trip and reset', () => {
    const { engine, state, run } = rig<MotorState>('motor-starter', motorStarterModel);
    run(200);
    expect(engine.getFieldOutput('O:2/0')).toBe(0);
    state.startPressed = true;
    run(200);
    state.startPressed = false;
    run(500);
    expect(engine.getFieldOutput('O:2/0')).toBe(1);
    expect(engine.getFieldOutput('O:2/1')).toBe(1);
    expect(engine.read('C5:0.ACC')).toBe(1);
    expect(state.speed).toBeGreaterThan(0.5);

    state.stopPressed = true;
    run(200);
    state.stopPressed = false;
    run(200);
    expect(engine.getFieldOutput('O:2/0')).toBe(0);

    // overload
    state.startPressed = true;
    run(100);
    state.startPressed = false;
    state.heavyLoad = true;
    run(6000);
    expect(state.olTripped || engine.read('B3:0/0') === 1).toBe(true);
    expect(engine.read('B3:0/0')).toBe(1);
    expect(engine.getFieldOutput('O:2/0')).toBe(0);
    expect(engine.read('C5:0.ACC')).toBe(2);

    // wait for overload relay to cool, then reset the alarm and restart
    state.heavyLoad = false;
    run(10000);
    expect(state.olTripped).toBe(false);
    expect(engine.read('B3:0/0')).toBe(1); // still latched
    state.startPressed = true;
    run(200);
    state.startPressed = false;
    expect(engine.getFieldOutput('O:2/0')).toBe(0); // cannot start while alarm latched
    state.resetPressed = true;
    run(200);
    state.resetPressed = false;
    expect(engine.read('B3:0/0')).toBe(0);
    state.startPressed = true;
    run(200);
    state.startPressed = false;
    run(200);
    expect(engine.getFieldOutput('O:2/0')).toBe(1);
    expect(engine.read('T4:0.ACC')).toBeGreaterThan(3);
  });

  it('conveyor: counts boxes to a batch of 5 and stops', () => {
    const { engine, state, run } = rig<ConveyorState>('conveyor', conveyorModel);
    state.startPressed = true;
    run(200);
    state.startPressed = false;
    expect(engine.getFieldOutput('O:2/0')).toBe(1);
    run(40000);
    expect(engine.read('C5:0.ACC')).toBe(5);
    expect(engine.getFieldOutput('O:2/2')).toBe(1);
    expect(engine.getFieldOutput('O:2/0')).toBe(0);
    expect(engine.read('N7:0')).toBe(5);
    expect(state.delivered).toBeGreaterThanOrEqual(4);
    state.resetPressed = true;
    run(200);
    state.resetPressed = false;
    expect(engine.read('C5:0.ACC')).toBe(0);
  });

  it('conveyor: a jammed box trips the jam alarm', () => {
    const { engine, state, run } = rig<ConveyorState>('conveyor', conveyorModel);
    state.jamNext = true;
    state.startPressed = true;
    run(200);
    state.startPressed = false;
    run(12000);
    expect(engine.read('B3:0/0')).toBe(1);
    expect(engine.getFieldOutput('O:2/3')).toBe(1);
    expect(engine.getFieldOutput('O:2/0')).toBe(0);
  });

  it('tank: fills between level switches', () => {
    const { engine, state, run } = rig<TankState>('tank', tankModel);
    state.level = 15;
    state.outletValve = 0.3;
    run(500);
    expect(engine.getFieldOutput('O:2/0')).toBe(1);
    run(20000);
    expect(state.level).toBeGreaterThan(70);
    // Pump stopped at the high switch at some point and level never overflowed
    expect(state.level).toBeLessThan(95);
    expect(engine.read('B3:0/1')).toBe(0);
    expect(engine.read('N7:0')).toBe(engine.read('I:3'));
  });

  it('tank: closed supply valve trips the max fill timer', () => {
    const { engine, state, run } = rig<TankState>('tank', tankModel);
    state.level = 10;
    state.outletValve = 0;
    state.supplyOpen = false;
    run(27000);
    expect(engine.read('B3:0/1')).toBe(1);
    expect(engine.getFieldOutput('O:2/0')).toBe(0);
    expect(engine.getFieldOutput('O:2/1')).toBe(1);
  });

  it('tank: failed pump trips the feedback timer', () => {
    const { engine, state, run } = rig<TankState>('tank', tankModel);
    state.level = 10;
    state.pumpFailed = true;
    run(4000);
    expect(engine.read('B3:0/1')).toBe(1);
  });
});
