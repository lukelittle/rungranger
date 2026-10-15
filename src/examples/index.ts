import type { Project } from '../core/types';
import { buildExample, type ExampleSpec } from './build';

export const MOTOR_STARTER: ExampleSpec = {
  name: 'Motor Starter',
  equipment: 'motor-starter',
  description:
    'Classic three-wire start/stop seal-in circuit with a thermal overload. Press START to run the motor, STOP to stop it. Switch on "Heavy load" and the overload relay will trip after a few seconds; the fault must be reset before the motor can restart.',
  scanIntervalMs: 50,
  rungs: [
    {
      text: 'XIC I:1/1 XIC I:1/2 XIO B3:0/0 BST XIC I:1/0 NXB XIC O:2/0 BND OTE O:2/0',
      comment:
        'MOTOR SEAL-IN. The STOP button and the overload contact are wired normally closed, so their inputs are ON when healthy (fail-safe wiring) and are examined with XIC. Pressing START energizes the motor; the parallel O:2/0 contact seals the circuit in after START is released.',
    },
    { text: 'XIC O:2/0 OTE O:2/1', comment: 'RUN PILOT LIGHT follows the motor contactor.' },
    {
      text: 'XIO I:1/2 OTL B3:0/0',
      comment: 'OVERLOAD ALARM. If the overload contact opens, latch the alarm so it is remembered even after the overload relay cools down.',
    },
    {
      text: 'XIC I:1/3 XIC I:1/2 OTU B3:0/0',
      comment: 'ALARM RESET. Pressing RESET clears the alarm, but only once the overload relay has reset (contact closed again).',
    },
    {
      text: 'XIC B3:0/0 XIC S:4/6 OTE O:2/2',
      comment: 'FAULT LIGHT flashes while the alarm is latched. S:4 is the free-running clock (10 ms per count); bit 6 toggles about every 0.64 s.',
    },
    { text: 'XIC O:2/0 CTU C5:0 9999 0', comment: 'START COUNTER. Counts how many times the motor has been started (one count per false-to-true transition).' },
    { text: 'XIC O:2/0 RTO T4:0 1.0 32767 0', comment: 'RUN TIME. Retentive timer accumulates total motor running seconds; it keeps its value while the motor is stopped.' },
  ],
  symbols: [
    ['I:1/0', 'START_PB', 'Start push button (N.O., momentary)'],
    ['I:1/1', 'STOP_PB', 'Stop push button (N.C., ON when not pressed)'],
    ['I:1/2', 'OL_OK', 'Overload relay contact (N.C., ON when healthy)'],
    ['I:1/3', 'RESET_PB', 'Alarm reset push button (N.O.)'],
    ['O:2/0', 'MOTOR', 'Motor contactor M1'],
    ['O:2/1', 'RUN_LT', 'Run pilot light (green)'],
    ['O:2/2', 'FAULT_LT', 'Overload fault light (amber)'],
    ['B3:0/0', 'OL_ALARM', 'Latched overload alarm'],
    ['C5:0', 'START_CNT', 'Motor start counter'],
    ['T4:0', 'RUN_TIME', 'Accumulated run time (s)'],
  ],
};

export const CONVEYOR: ExampleSpec = {
  name: 'Conveyor Box Counter',
  equipment: 'conveyor',
  description:
    'A conveyor with start/stop controls, an infeed photo-eye and an exit photo-eye. Boxes are counted as they leave; the conveyor stops when a batch of 5 is complete. A box blocking the infeed eye for more than 4 seconds is treated as a jam.',
  scanIntervalMs: 50,
  rungs: [
    {
      text: 'XIC I:1/1 XIO C5:0/DN XIO B3:0/0 BST XIC I:1/0 NXB XIC O:2/0 BND OTE O:2/0',
      comment: 'CONVEYOR RUN. Start/stop seal-in. The conveyor also stops when the batch is complete (C5:0/DN) or a jam is latched (B3:0/0).',
    },
    { text: 'XIC O:2/0 OTE O:2/1', comment: 'RUN LIGHT.' },
    { text: 'XIC I:1/3 CTU C5:0 5 0', comment: 'BOX COUNTER. Each box that blocks the exit photo-eye counts once (CTU counts rising edges).' },
    { text: 'XIC C5:0/DN OTE O:2/2', comment: 'BATCH COMPLETE LIGHT when the count reaches the preset.' },
    { text: 'XIC I:1/4 BST RES C5:0 NXB OTU B3:0/0 BND', comment: 'RESET clears the batch count and any jam alarm.' },
    { text: 'XIC O:2/0 XIC I:1/2 TON T4:0 1.0 4 0', comment: 'JAM DETECTION. A box normally clears the infeed eye in under 4 s. If the eye stays blocked while running, the timer completes.' },
    { text: 'XIC T4:0/DN OTL B3:0/0', comment: 'Latch the jam alarm.' },
    { text: 'XIC B3:0/0 OTE O:2/3', comment: 'JAM ALARM LIGHT.' },
    {
      text: 'XIC I:1/3 XIO B3:0/1 ADD N7:0 1 N7:0',
      comment: 'TOTAL BOXES (all batches). ADD runs every scan the rung is true, so B3:0/1 (set on the next rung) makes this a manual one-shot: it adds once per box.',
    },
    { text: 'XIC I:1/3 OTE B3:0/1', comment: 'One-shot storage bit for the rung above.' },
    { text: 'XIC S:1/15 MOV 0 N7:0', comment: 'FIRST SCAN. Clear the total when the controller goes to RUN (S:1/15 is on for the first scan only).' },
  ],
  symbols: [
    ['I:1/0', 'START_PB', 'Start push button'],
    ['I:1/1', 'STOP_PB', 'Stop push button (N.C.)'],
    ['I:1/2', 'PE_INFEED', 'Infeed photo-eye (ON = blocked)'],
    ['I:1/3', 'PE_EXIT', 'Exit photo-eye (ON = blocked)'],
    ['I:1/4', 'RESET_PB', 'Batch / jam reset'],
    ['O:2/0', 'CONV_MTR', 'Conveyor motor'],
    ['O:2/1', 'RUN_LT', 'Run light'],
    ['O:2/2', 'BATCH_LT', 'Batch complete light'],
    ['O:2/3', 'JAM_LT', 'Jam alarm light'],
    ['B3:0/0', 'JAM_ALARM', 'Latched jam alarm'],
    ['B3:0/1', 'EXIT_OS', 'Exit eye one-shot storage'],
    ['C5:0', 'BOX_CNT', 'Boxes in current batch'],
    ['T4:0', 'JAM_TMR', 'Infeed jam timer'],
    ['N7:0', 'TOTAL_BOXES', 'Total boxes since RUN'],
  ],
};

export const TANK: ExampleSpec = {
  name: 'Tank Fill Control',
  equipment: 'tank',
  description:
    'A pump fills a tank between a low and a high level switch. Timer-based protection stops the pump if filling takes too long (dry supply) or if the pump does not report running. An analog level transmitter drives a high-level warning.',
  scanIntervalMs: 50,
  rungs: [
    { text: 'XIC I:1/0 XIO I:1/1 OTL B3:0/0', comment: 'FILL REQUEST. In AUTO, start filling when the level drops below the low level switch.' },
    { text: 'BST XIC I:1/2 NXB XIO I:1/0 BND OTU B3:0/0', comment: 'END FILL at the high level switch, or when AUTO is switched off.' },
    { text: 'XIC I:1/0 XIC B3:0/0 XIO B3:0/1 OTE O:2/0', comment: 'PUMP runs while a fill is requested and no pump fault is latched.' },
    {
      text: 'XIC O:2/0 TON T4:0 1.0 25 0',
      comment: 'MAX FILL TIME protection. A normal fill takes about 15 s. If the pump has been running for 25 s, something is wrong (closed supply valve, leak, failed switch).',
    },
    {
      text: 'XIC O:2/0 XIO I:1/3 TON T4:1 0.01 300 0',
      comment: 'PUMP FEEDBACK check. The pump auxiliary contact must close within 3.00 s of the pump being commanded on.',
    },
    { text: 'BST XIC T4:0/DN NXB XIC T4:1/DN BND OTL B3:0/1', comment: 'Latch the PUMP FAULT on either protection timer.' },
    { text: 'XIC I:1/4 OTU B3:0/1', comment: 'RESET the pump fault.' },
    { text: 'XIC B3:0/1 OTE O:2/1', comment: 'FAULT LIGHT.' },
    { text: 'MOV I:3 N7:0', comment: 'Copy the analog level (0-1000 = 0.0-100.0 %) from the analog input slot I:3 into N7:0.' },
    { text: 'GRT N7:0 900 OTE O:2/2', comment: 'HIGH LEVEL WARNING light above 90.0 %.' },
    { text: 'SUB 1000 N7:0 N7:1', comment: 'Remaining capacity in tenths of a percent.' },
    { text: 'LES N7:0 100 OTE B3:0/2', comment: 'LOW-LOW level indication below 10.0 % (shown in the data table, B3:0/2).' },
  ],
  symbols: [
    ['I:1/0', 'AUTO_SW', 'Auto / Off selector (ON = auto)'],
    ['I:1/1', 'LSL', 'Low level switch (ON = liquid above 20 %)'],
    ['I:1/2', 'LSH', 'High level switch (ON = liquid above 80 %)'],
    ['I:1/3', 'PUMP_AUX', 'Pump running feedback contact'],
    ['I:1/4', 'RESET_PB', 'Fault reset push button'],
    ['I:3', 'LEVEL_AI', 'Analog level 0-1000'],
    ['O:2/0', 'PUMP', 'Fill pump starter'],
    ['O:2/1', 'FAULT_LT', 'Pump fault light'],
    ['O:2/2', 'HI_LT', 'High level warning light'],
    ['B3:0/0', 'FILL_REQ', 'Fill requested'],
    ['B3:0/1', 'PUMP_FLT', 'Latched pump fault'],
    ['B3:0/2', 'LOW_LOW', 'Level below 10 %'],
    ['T4:0', 'FILL_TMR', 'Maximum fill time'],
    ['T4:1', 'FBK_TMR', 'Pump feedback timer'],
    ['N7:0', 'LEVEL', 'Level, tenths of %'],
    ['N7:1', 'SPACE', 'Remaining capacity, tenths of %'],
  ],
};

export const EXAMPLES: { key: string; spec: ExampleSpec }[] = [
  { key: 'motor-starter', spec: MOTOR_STARTER },
  { key: 'conveyor', spec: CONVEYOR },
  { key: 'tank', spec: TANK },
];

export function createExample(key: string): Project {
  const ex = EXAMPLES.find((e) => e.key === key);
  if (!ex) throw new Error(`Unknown example ${key}`);
  return buildExample(ex.spec);
}
