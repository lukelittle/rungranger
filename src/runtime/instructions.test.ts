import { describe, expect, it } from 'vitest';
import { engineFromText, projectFromText } from './testUtil';
import { PlcEngine } from './engine';
import { FAULT_CODES, roundHalfEven } from './compiler';

describe('XIC / XIO / OTE', () => {
  it('XIC passes power only when the bit is 1', () => {
    const e = engineFromText(['XIC B3:0/0 OTE B3:0/1']);
    e.scan();
    expect(e.read('B3:0/1')).toBe(0);
    e.write('B3:0/0', 1);
    e.scan();
    expect(e.read('B3:0/1')).toBe(1);
    e.write('B3:0/0', 0);
    e.scan();
    expect(e.read('B3:0/1')).toBe(0);
  });

  it('XIO passes power only when the bit is 0', () => {
    const e = engineFromText(['XIO B3:0/0 OTE B3:0/1']);
    e.scan();
    expect(e.read('B3:0/1')).toBe(1);
    e.write('B3:0/0', 1);
    e.scan();
    expect(e.read('B3:0/1')).toBe(0);
  });

  it('OTE follows the rung condition, including bit 15 of a word', () => {
    const e = engineFromText(['XIC B3:0/0 OTE N7:0/15']);
    e.write('B3:0/0', 1);
    e.scan();
    expect(e.read('N7:0')).toBe(-32768);
    expect(e.read('N7:0/15')).toBe(1);
    e.write('B3:0/0', 0);
    e.scan();
    expect(e.read('N7:0')).toBe(0);
  });

  it('series contacts AND, branches OR', () => {
    const e = engineFromText(['BST XIC B3:0/0 NXB XIC B3:0/1 BND XIC B3:0/2 OTE B3:0/3']);
    const run = (a: number, b: number, c: number) => {
      e.write('B3:0/0', a);
      e.write('B3:0/1', b);
      e.write('B3:0/2', c);
      e.scan();
      return e.read('B3:0/3');
    };
    expect(run(0, 0, 1)).toBe(0);
    expect(run(1, 0, 1)).toBe(1);
    expect(run(0, 1, 1)).toBe(1);
    expect(run(1, 1, 0)).toBe(0);
  });

  it('nested branches and parallel outputs', () => {
    const e = engineFromText(['XIC B3:0/0 BST OTE B3:1/0 NXB XIC B3:0/1 BST OTE B3:1/1 NXB XIO B3:0/2 OTE B3:1/2 BND BND']);
    e.write('B3:0/0', 1);
    e.scan();
    expect([e.read('B3:1/0'), e.read('B3:1/1'), e.read('B3:1/2')]).toEqual([1, 0, 0]);
    e.write('B3:0/1', 1);
    e.scan();
    expect([e.read('B3:1/0'), e.read('B3:1/1'), e.read('B3:1/2')]).toEqual([1, 1, 1]);
    e.write('B3:0/2', 1);
    e.scan();
    expect([e.read('B3:1/0'), e.read('B3:1/1'), e.read('B3:1/2')]).toEqual([1, 1, 0]);
  });

  it('a seal-in circuit holds after the start input is released', () => {
    const e = engineFromText(['XIC I:1/1 BST XIC I:1/0 NXB XIC O:2/0 BND OTE O:2/0']);
    e.setFieldInput('I:1/1', 1); // stop (NC) healthy
    e.scan();
    expect(e.getFieldOutput('O:2/0')).toBe(0);
    e.setFieldInput('I:1/0', 1);
    e.scan();
    expect(e.getFieldOutput('O:2/0')).toBe(1);
    e.setFieldInput('I:1/0', 0);
    e.scan();
    expect(e.getFieldOutput('O:2/0')).toBe(1);
    e.setFieldInput('I:1/1', 0); // stop pressed
    e.scan();
    expect(e.getFieldOutput('O:2/0')).toBe(0);
    e.setFieldInput('I:1/1', 1);
    e.scan();
    expect(e.getFieldOutput('O:2/0')).toBe(0);
  });

  it('later rungs see values written by earlier rungs in the same scan', () => {
    const e = engineFromText(['XIC B3:0/0 OTE B3:0/1', 'XIC B3:0/1 OTE B3:0/2']);
    e.write('B3:0/0', 1);
    e.scan();
    expect(e.read('B3:0/2')).toBe(1);
  });

  it('the last OTE to the same bit wins', () => {
    const e = engineFromText(['XIC B3:0/0 OTE B3:0/5', 'XIC B3:0/1 OTE B3:0/5']);
    e.write('B3:0/0', 1);
    e.scan();
    expect(e.read('B3:0/5')).toBe(0);
  });
});

describe('OTL / OTU', () => {
  it('latches and unlatches, retaining state when the rung is false', () => {
    const e = engineFromText(['XIC B3:0/0 OTL B3:0/2', 'XIC B3:0/1 OTU B3:0/2']);
    e.scan();
    expect(e.read('B3:0/2')).toBe(0);
    e.write('B3:0/0', 1);
    e.scan();
    expect(e.read('B3:0/2')).toBe(1);
    e.write('B3:0/0', 0);
    e.scan();
    expect(e.read('B3:0/2')).toBe(1);
    e.write('B3:0/1', 1);
    e.scan();
    expect(e.read('B3:0/2')).toBe(0);
    e.write('B3:0/1', 0);
    e.scan();
    expect(e.read('B3:0/2')).toBe(0);
  });
});

describe('TON', () => {
  it('times while true, sets DN at preset, and resets when false', () => {
    // 100 ms scans, 1.0 s time base, preset 2 s
    const e = engineFromText(['XIC B3:0/0 TON T4:0 1.0 2 0'], 100);
    e.write('B3:0/0', 1);
    e.scan(); // enable scan: no time accumulated yet
    expect(e.read('T4:0/EN')).toBe(1);
    expect(e.read('T4:0/TT')).toBe(1);
    expect(e.read('T4:0/DN')).toBe(0);
    e.runScans(9); // 900 ms
    expect(e.read('T4:0.ACC')).toBe(0);
    e.scan(); // 1000 ms
    expect(e.read('T4:0.ACC')).toBe(1);
    e.runScans(10); // 2000 ms
    expect(e.read('T4:0.ACC')).toBe(2);
    expect(e.read('T4:0/DN')).toBe(1);
    expect(e.read('T4:0/TT')).toBe(0);
    e.runScans(20);
    expect(e.read('T4:0.ACC')).toBe(2); // stops at preset
    e.write('B3:0/0', 0);
    e.scan();
    expect(e.read('T4:0.ACC')).toBe(0);
    expect(e.read('T4:0/EN')).toBe(0);
    expect(e.read('T4:0/DN')).toBe(0);
  });

  it('supports the 0.01 time base and carries sub-tick remainders', () => {
    const e = engineFromText(['XIC B3:0/0 TON T4:1 0.01 100 0'], 15);
    e.write('B3:0/0', 1);
    e.scan();
    e.runScans(10); // 150 ms
    expect(e.read('T4:1.ACC')).toBe(15);
    e.runScans(1); // 165 ms
    expect(e.read('T4:1.ACC')).toBe(16);
  });

  it('done immediately with preset 0', () => {
    const e = engineFromText(['XIC B3:0/0 TON T4:0 1.0 0 0']);
    e.write('B3:0/0', 1);
    e.scan();
    expect(e.read('T4:0/DN')).toBe(1);
  });

  it('faults on a negative preset', () => {
    const e = engineFromText(['XIC B3:0/0 TON T4:0 1.0 5 0']);
    e.write('T4:0.PRE', -1);
    e.write('B3:0/0', 1);
    e.scan();
    expect(e.mode).toBe('FAULT');
    expect(e.fault?.code).toBe(FAULT_CODES.NEGATIVE_TIMER);
    expect(e.fault?.rung).toBe(0);
    expect(e.read('S:6')).toBe(FAULT_CODES.NEGATIVE_TIMER);
  });

  it('is deterministic: same inputs give the same result', () => {
    const run = () => {
      const e = engineFromText(['XIC B3:0/0 TON T4:0 0.01 1234 0'], 7);
      e.write('B3:0/0', 1);
      e.runScans(500);
      return [e.read('T4:0.ACC'), e.read('T4:0/DN'), e.simTimeMs];
    };
    expect(run()).toEqual(run());
  });
});

describe('TOF', () => {
  it('DN on while true; times out after the rung goes false', () => {
    const e = engineFromText(['XIC B3:0/0 TOF T4:0 1.0 1 0'], 250);
    e.scan();
    expect(e.read('T4:0/DN')).toBe(0);
    e.write('B3:0/0', 1);
    e.scan();
    expect(e.read('T4:0/DN')).toBe(1);
    expect(e.read('T4:0/EN')).toBe(1);
    e.write('B3:0/0', 0);
    e.scan(); // first false scan: timing starts
    expect(e.read('T4:0/EN')).toBe(0);
    expect(e.read('T4:0/TT')).toBe(1);
    expect(e.read('T4:0/DN')).toBe(1);
    e.runScans(3); // 750 ms
    expect(e.read('T4:0/DN')).toBe(1);
    e.scan(); // 1000 ms
    expect(e.read('T4:0.ACC')).toBe(1);
    expect(e.read('T4:0/DN')).toBe(0);
    expect(e.read('T4:0/TT')).toBe(0);
  });

  it('re-energizing during timing resets the accumulator', () => {
    const e = engineFromText(['XIC B3:0/0 TOF T4:0 0.01 100 0'], 100);
    e.write('B3:0/0', 1);
    e.scan();
    e.write('B3:0/0', 0);
    e.runScans(5);
    expect(e.read('T4:0.ACC')).toBe(40);
    e.write('B3:0/0', 1);
    e.scan();
    expect(e.read('T4:0.ACC')).toBe(0);
    expect(e.read('T4:0/DN')).toBe(1);
  });
});

describe('RTO and RES', () => {
  it('RTO retains its accumulator when the rung goes false', () => {
    const e = engineFromText(['XIC B3:0/0 RTO T4:0 1.0 3 0', 'XIC B3:0/1 RES T4:0'], 500);
    e.write('B3:0/0', 1);
    e.runScans(5); // enable + 4*500ms = 2s
    expect(e.read('T4:0.ACC')).toBe(2);
    e.write('B3:0/0', 0);
    e.runScans(10);
    expect(e.read('T4:0.ACC')).toBe(2);
    expect(e.read('T4:0/EN')).toBe(0);
    e.write('B3:0/0', 1);
    e.runScans(3); // enable scan + 1s
    expect(e.read('T4:0.ACC')).toBe(3);
    expect(e.read('T4:0/DN')).toBe(1);
    e.write('B3:0/0', 0);
    e.scan();
    expect(e.read('T4:0/DN')).toBe(1); // DN retained too
    e.write('B3:0/1', 1);
    e.scan();
    expect(e.read('T4:0.ACC')).toBe(0);
    expect(e.read('T4:0/DN')).toBe(0);
    expect(e.read('T4:0.PRE')).toBe(3);
  });

  it('RES resets a counter (accumulator and status bits) but not the preset', () => {
    const e = engineFromText(['XIC B3:0/0 CTU C5:0 2 0', 'XIC B3:0/1 RES C5:0']);
    for (let i = 0; i < 3; i++) {
      e.write('B3:0/0', 1);
      e.scan();
      e.write('B3:0/0', 0);
      e.scan();
    }
    expect(e.read('C5:0.ACC')).toBe(3);
    expect(e.read('C5:0/DN')).toBe(1);
    e.write('B3:0/1', 1);
    e.scan();
    expect(e.read('C5:0.ACC')).toBe(0);
    expect(e.read('C5:0/DN')).toBe(0);
    expect(e.read('C5:0.PRE')).toBe(2);
  });

  it('RES resets a control element', () => {
    const e = engineFromText(['XIC B3:0/0 RES R6:0']);
    e.write('R6:0.POS', 5);
    e.write('R6:0/DN', 1);
    e.write('R6:0.LEN', 8);
    e.write('B3:0/0', 1);
    e.scan();
    expect(e.read('R6:0.POS')).toBe(0);
    expect(e.read('R6:0/DN')).toBe(0);
    expect(e.read('R6:0.LEN')).toBe(8);
  });

  it('RES does nothing when the rung is false', () => {
    const e = engineFromText(['XIC B3:0/0 RES T4:0']);
    e.write('T4:0.ACC', 7);
    e.scan();
    expect(e.read('T4:0.ACC')).toBe(7);
  });
});

describe('CTU / CTD', () => {
  it('CTU counts rising edges only', () => {
    const e = engineFromText(['XIC B3:0/0 CTU C5:0 3 0']);
    e.write('B3:0/0', 1);
    e.runScans(5);
    expect(e.read('C5:0.ACC')).toBe(1);
    expect(e.read('C5:0/CU')).toBe(1);
    e.write('B3:0/0', 0);
    e.scan();
    expect(e.read('C5:0/CU')).toBe(0);
    for (let i = 0; i < 2; i++) {
      e.write('B3:0/0', 1);
      e.scan();
      e.write('B3:0/0', 0);
      e.scan();
    }
    expect(e.read('C5:0.ACC')).toBe(3);
    expect(e.read('C5:0/DN')).toBe(1);
  });

  it('CTU overflows from 32767 to -32768 and sets OV', () => {
    const e = engineFromText(['XIC B3:0/0 CTU C5:0 10 32767']);
    e.write('B3:0/0', 1);
    e.scan();
    expect(e.read('C5:0.ACC')).toBe(-32768);
    expect(e.read('C5:0/OV')).toBe(1);
    expect(e.read('C5:0/DN')).toBe(0);
  });

  it('CTD counts down and underflows', () => {
    const e = engineFromText(['XIC B3:0/0 CTD C5:0 0 1']);
    const pulse = () => {
      e.write('B3:0/0', 1);
      e.scan();
      e.write('B3:0/0', 0);
      e.scan();
    };
    pulse();
    expect(e.read('C5:0.ACC')).toBe(0);
    expect(e.read('C5:0/DN')).toBe(1);
    pulse();
    expect(e.read('C5:0.ACC')).toBe(-1);
    expect(e.read('C5:0/DN')).toBe(0);
    e.write('C5:0.ACC', -32768);
    pulse();
    expect(e.read('C5:0.ACC')).toBe(32767);
    expect(e.read('C5:0/UN')).toBe(1);
  });

  it('CTU and CTD share a counter for up/down counting', () => {
    const e = engineFromText(['XIC B3:0/0 CTU C5:0 2 0', 'XIC B3:0/1 CTD C5:0 2 0']);
    const pulse = (bit: string) => {
      e.write(bit, 1);
      e.scan();
      e.write(bit, 0);
      e.scan();
    };
    pulse('B3:0/0');
    pulse('B3:0/0');
    expect(e.read('C5:0/DN')).toBe(1);
    pulse('B3:0/1');
    expect(e.read('C5:0.ACC')).toBe(1);
    expect(e.read('C5:0/DN')).toBe(0);
  });
});

describe('MOV', () => {
  it('moves constants and words only while true', () => {
    const e = engineFromText(['XIC B3:0/0 MOV 1234 N7:0', 'XIC B3:0/0 MOV N7:0 N7:1']);
    e.scan();
    expect(e.read('N7:0')).toBe(0);
    e.write('B3:0/0', 1);
    e.scan();
    expect(e.read('N7:0')).toBe(1234);
    expect(e.read('N7:1')).toBe(1234);
  });

  it('rounds float to integer (half to even) and moves int to float', () => {
    const e = engineFromText(['MOV F8:0 N7:0', 'MOV N7:5 F8:1', 'MOV 2.5 N7:2', 'MOV 3.5 N7:3', 'MOV -1.6 N7:4']);
    e.write('F8:0', 12.7);
    e.write('N7:5', -42);
    e.scan();
    expect(e.read('N7:0')).toBe(13);
    expect(e.read('F8:1')).toBe(-42);
    expect(e.read('N7:2')).toBe(2);
    expect(e.read('N7:3')).toBe(4);
    expect(e.read('N7:4')).toBe(-2);
    expect(roundHalfEven(-2.5)).toBe(-2);
  });

  it('can write timer presets', () => {
    const e = engineFromText(['MOV 25 T4:0.PRE']);
    e.scan();
    expect(e.read('T4:0.PRE')).toBe(25);
  });

  it('sets zero and sign status bits', () => {
    const e = engineFromText(['MOV -5 N7:0']);
    e.scan();
    expect(e.read('S:0/3')).toBe(1);
    expect(e.read('S:0/2')).toBe(0);
  });
});

describe('ADD / SUB', () => {
  it('adds and subtracts integers', () => {
    const e = engineFromText(['ADD N7:0 N7:1 N7:2', 'SUB N7:0 N7:1 N7:3', 'SUB 5 5 N7:4']);
    e.write('N7:0', 100);
    e.write('N7:1', 30);
    e.scan();
    expect(e.read('N7:2')).toBe(130);
    expect(e.read('N7:3')).toBe(70);
    expect(e.read('N7:4')).toBe(0);
    expect(e.read('S:0/2')).toBe(1); // zero flag from the last math instruction
  });

  it('executes every scan while true (ADD counts scans)', () => {
    const e = engineFromText(['XIC B3:0/0 ADD N7:0 1 N7:0']);
    e.write('B3:0/0', 1);
    e.runScans(5);
    expect(e.read('N7:0')).toBe(5);
    e.write('B3:0/0', 0);
    e.runScans(5);
    expect(e.read('N7:0')).toBe(5);
  });

  it('works with floats', () => {
    const e = engineFromText(['ADD F8:0 0.5 F8:1', 'SUB F8:0 N7:0 F8:2']);
    e.write('F8:0', 1.25);
    e.write('N7:0', 2);
    e.scan();
    expect(e.read('F8:1')).toBeCloseTo(1.75);
    expect(e.read('F8:2')).toBeCloseTo(-0.75);
  });

  it('integer overflow clamps, sets V and faults at end of scan if the trap bit is not cleared', () => {
    const e = engineFromText(['ADD 32000 1000 N7:0']);
    e.scan();
    expect(e.read('N7:0')).toBe(32767);
    expect(e.read('S:0/1')).toBe(1);
    expect(e.mode).toBe('FAULT');
    expect(e.fault?.code).toBe(FAULT_CODES.OVERFLOW_TRAP);
  });

  it('no fault when the program clears the overflow trap bit', () => {
    const e = engineFromText(['SUB -32000 1000 N7:0', 'OTU S:5/0']);
    e.scan();
    expect(e.read('N7:0')).toBe(-32768);
    expect(e.mode).toBe('RUN');
  });

  it('sets carry on unsigned carry out', () => {
    const e = engineFromText(['ADD -1 1 N7:0']);
    e.scan();
    expect(e.read('N7:0')).toBe(0);
    expect(e.read('S:0/0')).toBe(1);
  });
});

describe('Compare instructions', () => {
  const cases: [string, number, number, number][] = [
    ['EQU', 5, 5, 1], ['EQU', 5, 6, 0],
    ['NEQ', 5, 5, 0], ['NEQ', 5, 6, 1],
    ['LES', 4, 5, 1], ['LES', 5, 5, 0], ['LES', -3, -2, 1],
    ['GRT', 6, 5, 1], ['GRT', 5, 5, 0], ['GRT', -1, -2, 1],
  ];
  for (const [m, a, b, want] of cases) {
    it(`${m} ${a} ${b} -> ${want}`, () => {
      const e = engineFromText([`${m} N7:0 N7:1 OTE B3:0/0`]);
      e.write('N7:0', a);
      e.write('N7:1', b);
      e.scan();
      expect(e.read('B3:0/0')).toBe(want);
    });
  }

  it('compares constants, floats and timer accumulators', () => {
    const e = engineFromText(['GRT F8:0 1.5 OTE B3:0/0', 'EQU T4:0.ACC 0 OTE B3:0/1', 'LES N7:0 F8:0 OTE B3:0/2']);
    e.write('F8:0', 1.75);
    e.write('N7:0', 1);
    e.scan();
    expect(e.read('B3:0/0')).toBe(1);
    expect(e.read('B3:0/1')).toBe(1);
    expect(e.read('B3:0/2')).toBe(1);
  });

  it('records compare result in the trace even when the rung-in is false', () => {
    const e = engineFromText(['XIC B3:0/5 EQU 1 1 OTE B3:0/0']);
    e.scan();
    const p = e.program!;
    expect(Array.from(p.trace.state)).toEqual([0, 1, 0]);
    expect(Array.from(p.trace.pout)).toEqual([0, 0, 0]);
  });
});

describe('scan cycle, modes, forces and faults', () => {
  it('sets S:1/15 only on the first scan after entering run', () => {
    const e = engineFromText(['XIC S:1/15 OTL B3:0/0', 'XIC S:1/15 ADD N7:0 1 N7:0']);
    e.runScans(5);
    expect(e.read('N7:0')).toBe(1);
    expect(e.read('S:1/15')).toBe(0);
    e.setMode('PROGRAM');
    e.setMode('RUN');
    e.scan();
    expect(e.read('N7:0')).toBe(2);
  });

  it('input image is updated from field inputs at the start of the scan only', () => {
    const e = engineFromText(['XIC I:1/0 OTE O:2/0']);
    e.setFieldInput('I:1/0', 1);
    expect(e.read('I:1/0')).toBe(0);
    e.scan();
    expect(e.read('I:1/0')).toBe(1);
    expect(e.getFieldOutput('O:2/0')).toBe(1);
  });

  it('input forces override field values; output forces override the output image', () => {
    const p = projectFromText(['XIC I:1/0 OTE O:2/0', 'XIC I:1/0 OTE O:2/1']);
    p.forces = [{ address: 'I:1/0', value: 1 }, { address: 'O:2/1', value: 0 }];
    const e = new PlcEngine(p);
    e.setMode('RUN');
    e.scan();
    expect(e.read('I:1/0')).toBe(1);
    expect(e.getFieldOutput('O:2/0')).toBe(1);
    expect(e.read('O:2/1')).toBe(1); // logic says on
    expect(e.getFieldOutput('O:2/1')).toBe(0); // forced off at the terminal
    e.setForces(p.forces, false);
    e.scan();
    expect(e.read('I:1/0')).toBe(0);
  });

  it('PROGRAM mode de-energizes field outputs; single scan enters TEST mode', () => {
    const p = projectFromText(['OTE O:2/0']);
    const e = new PlcEngine(p);
    expect(e.mode).toBe('PROGRAM');
    e.scan();
    expect(e.mode).toBe('TEST');
    expect(e.getFieldOutput('O:2/0')).toBe(1);
    expect(e.scanCount).toBe(1);
    e.setMode('PROGRAM');
    expect(e.getFieldOutput('O:2/0')).toBe(0);
  });

  it('faulted controller stops scanning until the fault is cleared', () => {
    const e = engineFromText(['ADD 32767 1 N7:0']);
    e.scan();
    expect(e.mode).toBe('FAULT');
    const n = e.scanCount;
    e.scan();
    expect(e.scanCount).toBe(n);
    e.setMode('RUN');
    expect(e.mode).toBe('FAULT');
    e.clearFault();
    expect(e.mode).toBe('PROGRAM');
    expect(e.read('S:6')).toBe(0);
  });

  it('reset reloads initial data values', () => {
    const e = engineFromText(['ADD N7:0 1 N7:0']);
    e.runScans(3);
    expect(e.read('N7:0')).toBe(3);
    e.reset();
    expect(e.read('N7:0')).toBe(0);
    expect(e.mode).toBe('PROGRAM');
    expect(e.scanCount).toBe(0);
  });

  it('online edits keep live data and survive data file resizing', () => {
    const p = projectFromText(['ADD N7:0 1 N7:0']);
    const e = new PlcEngine(p);
    e.setMode('RUN');
    e.runScans(4);
    const p2 = projectFromText(['ADD N7:0 10 N7:0']);
    p2.dataFiles = p2.dataFiles.map((f) => (f.type === 'N' ? { ...f, elements: 64 } : f));
    e.updateProject(p2);
    e.scan();
    expect(e.read('N7:0')).toBe(14);
    expect(e.read('N7:63')).toBe(0);
  });

  it('a program with invalid operands is rejected without disturbing the running one', () => {
    const p = projectFromText(['ADD N7:0 1 N7:0']);
    const e = new PlcEngine(p);
    e.setMode('RUN');
    e.scan();
    const bad = projectFromText(['XIC N7:0 OTE B3:0/0']);
    expect(() => e.updateProject(bad)).toThrow();
    e.scan();
    expect(e.read('N7:0')).toBe(2);
  });

  it('S:4 free-running clock follows simulated time', () => {
    const e = engineFromText(['OTE B3:0/0'], 50);
    e.runScans(4);
    expect(e.read('S:4')).toBe(20);
  });
});
