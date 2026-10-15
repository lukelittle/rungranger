import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { normalizeAddress } from '../core/address';
import {
  BOX_WIDTH, CONVEYOR_LENGTH, PE_EXIT_X, PE_INFEED_X, TANK_LSH, TANK_LSL, conveyorAddBox, conveyorClearJam,
  type ConveyorState, type MotorState, type TankState,
} from '../equipment/models';
import { controller } from '../store/controller';
import { forceOf, setForce, useApp } from '../store/store';

function useController() {
  useSyncExternalStore(controller.subscribe, controller.getVersion);
  return controller;
}

function out(address: string): boolean {
  try {
    return controller.engine?.getFieldOutput(address) === 1;
  } catch {
    return false;
  }
}

function inp(address: string): number {
  try {
    return controller.engine?.mem.readAddress(address) ?? 0;
  } catch {
    return 0;
  }
}

export function EquipmentPanel() {
  const project = useApp((s) => s.project);
  const [tab, setTab] = useState<'equipment' | 'io'>('equipment');
  useController();
  if (!project) return null;
  const hasEq = !!project.equipment && !!controller.model;
  const active = hasEq ? tab : 'io';
  return (
    <div className="equipment-panel" data-testid="equipment-panel">
      <div className="tabs">
        {hasEq && (
          <button className={`tab${active === 'equipment' ? ' active' : ''}`} onClick={() => setTab('equipment')}>
            {controller.model!.title}
          </button>
        )}
        <button className={`tab${active === 'io' ? ' active' : ''}`} onClick={() => setTab('io')} data-testid="io-tab">
          I/O Panel
        </button>
      </div>
      <div className="equipment-body">
        {!controller.online && (
          <div className="notice small">Controller is offline. Press RUN (or Go Online) to power the virtual controller; the equipment responds once it is online.</div>
        )}
        {active === 'equipment' && project.equipment === 'motor-starter' && <MotorView />}
        {active === 'equipment' && project.equipment === 'conveyor' && <ConveyorView />}
        {active === 'equipment' && project.equipment === 'tank' && <TankView />}
        {active === 'io' && <IoPanel />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ shared widgets

function touch<S>(fn: (s: S) => void) {
  controller.touchEquipment(fn as (s: never) => void);
}

function PushButton({ label, color, onPress, testId, title }: { label: string; color: 'green' | 'red' | 'blue' | 'black'; onPress: (down: boolean) => void; testId?: string; title?: string }) {
  const [down, setDown] = useState(false);
  const set = (v: boolean) => {
    if (v === down) return;
    setDown(v);
    onPress(v);
  };
  return (
    <button
      className={`pushbutton pb-${color}${down ? ' down' : ''}`}
      data-testid={testId}
      title={title ?? 'Momentary push button: hold to press'}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        set(true);
      }}
      onPointerUp={() => set(false)}
      onPointerCancel={() => set(false)}
      onKeyDown={(e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
          e.preventDefault();
          set(true);
        }
      }}
      onKeyUp={(e) => {
        if (e.key === ' ' || e.key === 'Enter') set(false);
      }}
      onBlur={() => set(false)}
    >
      <span className="pb-cap" />
      <span className="pb-label">{label}</span>
    </button>
  );
}

function PilotLight({ on, color, label, testId }: { on: boolean; color: 'green' | 'red' | 'amber' | 'white'; label: string; testId?: string }) {
  return (
    <div className="pilot" data-testid={testId} data-on={on ? '1' : '0'}>
      <span className={`lamp lamp-${color}${on ? ' on' : ''}`} />
      <span className="pilot-label">{label}</span>
    </div>
  );
}

function Toggle({ checked, onChange, label, testId }: { checked: boolean; onChange: (v: boolean) => void; label: string; testId?: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      <span>{label}</span>
    </label>
  );
}

function Station({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="station">
      <div className="station-title">{title}</div>
      <div className="station-body">{children}</div>
    </div>
  );
}

function IoLegend({ items }: { items: [string, string][] }) {
  return (
    <table className="io-legend">
      <tbody>
        {items.map(([a, l]) => (
          <tr key={a}>
            <td className="mono">{a}</td>
            <td>{l}</td>
            <td className={`io-state ${inpOrOut(a) ? 'on' : ''}`}>{inpOrOut(a) ? 'ON' : 'off'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function inpOrOut(a: string): boolean {
  return a.startsWith('O') ? out(a) : inp(a) === 1;
}

// ------------------------------------------------------------------ motor starter

function MotorView() {
  const c = useController();
  const s = c.eqState as MotorState | null;
  if (!s) return null;
  const run = out('O:2/1');
  const fault = out('O:2/2');
  const contactor = out('O:2/0');
  const blades = [0, 90, 180, 270];
  return (
    <div className="eq motor" data-testid="motor-view">
      <svg viewBox="0 0 300 170" className="eq-svg">
        {/* Supply and contactor */}
        <text x={10} y={16} className="eq-text">
          3-PHASE SUPPLY
        </text>
        {[0, 1, 2].map((i) => (
          <line key={i} x1={20 + i * 12} y1={22} x2={20 + i * 12} y2={50} className="eq-wire" />
        ))}
        <rect x={10} y={50} width={46} height={30} className={`eq-device${contactor ? ' energized' : ''}`} />
        <text x={33} y={69} className="eq-label" textAnchor="middle">
          M1
        </text>
        {[0, 1, 2].map((i) => (
          <line key={i} x1={20 + i * 12} y1={80} x2={20 + i * 12} y2={100} className={`eq-wire${contactor ? ' live' : ''}`} />
        ))}
        <rect x={10} y={100} width={46} height={26} className={`eq-device${s.olTripped ? ' tripped' : ''}`} />
        <text x={33} y={117} className="eq-label" textAnchor="middle">
          OL
        </text>
        <rect x={10} y={130} width={46} height={6} className="heat-bg" />
        <rect x={10} y={130} width={Math.min(46, 46 * s.heat)} height={6} className={`heat-bar${s.heat > 0.75 ? ' hot' : ''}`} />
        <text x={62} y={122} className="eq-small">
          {s.olTripped ? 'TRIPPED' : `heat ${Math.round(s.heat * 100)}%`}
        </text>
        {[0, 1, 2].map((i) => (
          <path key={i} d={`M ${20 + i * 12} 126 L ${20 + i * 12} ${160 - i * 4} L 120 ${160 - i * 4}`} className={`eq-wire${contactor && !s.olTripped ? ' live' : ''}`} fill="none" />
        ))}
        {/* Motor */}
        <rect x={120} y={92} width={110} height={72} rx={8} className="motor-body" />
        {Array.from({ length: 6 }, (_, i) => (
          <line key={i} x1={130 + i * 16} y1={96} x2={130 + i * 16} y2={160} className="motor-fin" />
        ))}
        <rect x={230} y={120} width={30} height={14} className="motor-shaft" />
        <g transform={`translate(270 127) rotate(${s.angle})`}>
          <circle r={26} className="fan-guard" />
          {blades.map((b) => (
            <ellipse key={b} cx={0} cy={-13} rx={6} ry={13} transform={`rotate(${b})`} className="fan-blade" />
          ))}
          <circle r={5} className="fan-hub" />
        </g>
        <text x={175} y={84} className="eq-text" textAnchor="middle">
          MOTOR {Math.round(s.speed * 1750)} RPM
        </text>
      </svg>
      <div className="row gap wrap">
        <Station title="Operator station">
          <PushButton label="START" color="green" testId="pb-start" onPress={(d) => touch<MotorState>((st) => (st.startPressed = d))} />
          <PushButton label="STOP" color="red" testId="pb-stop" onPress={(d) => touch<MotorState>((st) => (st.stopPressed = d))} />
          <PushButton label="RESET" color="blue" testId="pb-reset" onPress={(d) => touch<MotorState>((st) => (st.resetPressed = d))} />
          <PilotLight on={run} color="green" label="RUN" testId="lamp-run" />
          <PilotLight on={fault} color="amber" label="FAULT" testId="lamp-fault" />
        </Station>
        <Station title="Process">
          <Toggle checked={s.heavyLoad} onChange={(v) => touch<MotorState>((st) => (st.heavyLoad = v))} label="Heavy load (overheats the motor)" testId="heavy-load" />
        </Station>
      </div>
      <IoLegend
        items={[
          ['I:1/0', 'START push button (N.O.)'],
          ['I:1/1', 'STOP push button (N.C.)'],
          ['I:1/2', 'Overload contact (N.C.)'],
          ['I:1/3', 'RESET push button'],
          ['O:2/0', 'Motor contactor M1'],
          ['O:2/1', 'Run light'],
          ['O:2/2', 'Fault light'],
        ]}
      />
    </div>
  );
}

// ------------------------------------------------------------------ conveyor

function ConveyorView() {
  const c = useController();
  const s = c.eqState as ConveyorState | null;
  if (!s) return null;
  const W = 300;
  const scale = (W - 20) / CONVEYOR_LENGTH;
  const X = (u: number) => 10 + u * scale;
  const beltY = 90;
  const blocked = (pe: number) => s.boxes.some((b) => b.x <= pe && b.x + BOX_WIDTH >= pe);
  const running = out('O:2/0');
  return (
    <div className="eq conveyor" data-testid="conveyor-view">
      <svg viewBox={`0 0 ${W} 160`} className="eq-svg">
        <text x={10} y={16} className="eq-text">
          INFEED →
        </text>
        <text x={W - 10} y={16} className="eq-text" textAnchor="end">
          → TO BIN ({s.delivered})
        </text>
        {/* photo-eyes */}
        {[PE_INFEED_X, PE_EXIT_X].map((pe, i) => (
          <g key={pe}>
            <rect x={X(pe) - 4} y={38} width={8} height={12} className="pe-head" />
            <rect x={X(pe) - 4} y={beltY + 2} width={8} height={8} className="pe-reflector" />
            <line x1={X(pe)} y1={50} x2={X(pe)} y2={beltY + 2} className={`pe-beam${blocked(pe) ? ' blocked' : ''}`} />
            <text x={X(pe)} y={34} className="eq-small" textAnchor="middle">
              {i === 0 ? 'PE1 I:1/2' : 'PE2 I:1/3'}
            </text>
          </g>
        ))}
        {/* boxes */}
        {s.boxes.map((b) => (
          <g key={b.id}>
            <rect x={X(b.x)} y={beltY - 26} width={BOX_WIDTH * scale} height={26} className={`box-item${b.jammed ? ' jammed' : ''}`} />
            <line x1={X(b.x)} y1={beltY - 18} x2={X(b.x) + BOX_WIDTH * scale} y2={beltY - 18} className="box-tape" />
          </g>
        ))}
        {/* belt */}
        <rect x={6} y={beltY} width={W - 12} height={12} rx={6} className="belt" />
        {Array.from({ length: 30 }, (_, i) => {
          const x = 10 + ((i * 10 + s.beltOffset * scale * 1.2) % (W - 20));
          return <line key={i} x1={x} y1={beltY + 2} x2={x} y2={beltY + 10} className="belt-mark" />;
        })}
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <circle key={i} cx={14 + i * ((W - 28) / 5)} cy={beltY + 18} r={5} className="roller" />
        ))}
        <rect x={W - 60} y={beltY + 26} width={44} height={22} className={`eq-device${running ? ' energized' : ''}`} />
        <text x={W - 38} y={beltY + 41} className="eq-label" textAnchor="middle">
          M
        </text>
        <text x={10} y={beltY + 44} className="eq-small">
          {s.jamNext ? 'Next box will jam at PE1' : s.boxes.some((b) => b.jammed) ? 'JAMMED box at PE1' : ''}
        </text>
      </svg>
      <div className="row gap wrap">
        <Station title="Operator station">
          <PushButton label="START" color="green" testId="pb-start" onPress={(d) => touch<ConveyorState>((st) => (st.startPressed = d))} />
          <PushButton label="STOP" color="red" testId="pb-stop" onPress={(d) => touch<ConveyorState>((st) => (st.stopPressed = d))} />
          <PushButton label="RESET" color="blue" testId="pb-reset" onPress={(d) => touch<ConveyorState>((st) => (st.resetPressed = d))} />
          <PilotLight on={out('O:2/1')} color="green" label="RUN" />
          <PilotLight on={out('O:2/2')} color="white" label="BATCH" />
          <PilotLight on={out('O:2/3')} color="red" label="JAM" />
        </Station>
        <Station title="Process">
          <Toggle checked={s.autoFeed} onChange={(v) => touch<ConveyorState>((st) => (st.autoFeed = v))} label="Automatic box feed" testId="auto-feed" />
          <button onClick={() => touch<ConveyorState>((st) => void conveyorAddBox(st))}>Add box</button>
          <button onClick={() => touch<ConveyorState>((st) => (st.jamNext = true))}>Jam next box</button>
          <button onClick={() => touch<ConveyorState>((st) => conveyorClearJam(st))}>Clear jam</button>
          <button onClick={() => touch<ConveyorState>((st) => (st.boxes = []))}>Remove boxes</button>
        </Station>
      </div>
      <div className="readout mono">
        Batch count C5:0.ACC = {controller.engine ? inp('C5:0.ACC') : '-'} / {controller.engine ? inp('C5:0.PRE') : '-'} &nbsp; Total N7:0 = {controller.engine ? inp('N7:0') : '-'}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ tank

function TankView() {
  const c = useController();
  const s = c.eqState as TankState | null;
  if (!s) return null;
  const tx = 136, ty = 30, tw = 100, th = 120;
  const levelY = ty + th - (th * s.level) / 100;
  const pumpOn = out('O:2/0');
  const markY = (pct: number) => ty + th - (th * pct) / 100;
  return (
    <div className="eq tank" data-testid="tank-view">
      <svg viewBox="0 0 300 175" className="eq-svg">
        {/* supply line and valve */}
        <text x={6} y={156} className="eq-small">
          SUPPLY
        </text>
        <line x1={6} y1={140} x2={60} y2={140} className={`pipe${s.supplyOpen ? '' : ' closed'}`} />
        <path d="M 22 132 L 34 148 L 34 132 L 22 148 Z" className={`valve${s.supplyOpen ? ' open' : ''}`} />
        {/* pump */}
        <circle cx={80} cy={140} r={18} className={`pump-body${pumpOn ? ' energized' : ''}${s.pumpFailed ? ' failed' : ''}`} />
        <g transform={`translate(80 140) rotate(${s.impeller})`}>
          {[0, 120, 240].map((a) => (
            <line key={a} x1={0} y1={0} x2={0} y2={-13} transform={`rotate(${a})`} className="impeller" />
          ))}
        </g>
        <text x={80} y={170} className="eq-small" textAnchor="middle">
          PUMP {s.pumpFailed ? '(FAILED)' : ''}
        </text>
        <path d={`M 98 140 L 120 140 L 120 18 L ${tx + 20} 18 L ${tx + 20} ${ty + 4}`} className={`pipe${pumpOn && s.supplyOpen && !s.pumpFailed ? ' flowing' : ''}`} fill="none" />
        {/* tank */}
        <rect x={tx} y={ty} width={tw} height={th} className="tank-shell" />
        <rect x={tx + 1} y={levelY} width={tw - 2} height={ty + th - levelY} className="liquid" />
        <text x={tx + tw / 2} y={ty + th / 2} className="tank-pct" textAnchor="middle">
          {s.level.toFixed(1)}%
        </text>
        {/* level switches */}
        {[
          [TANK_LSH, 'LSH', s.level > TANK_LSH],
          [TANK_LSL, 'LSL', s.level > TANK_LSL],
        ].map(([pct, name, on]) => (
          <g key={String(name)}>
            <line x1={tx + tw} y1={markY(pct as number)} x2={tx + tw + 12} y2={markY(pct as number)} className="eq-wire" />
            <circle cx={tx + tw + 16} cy={markY(pct as number)} r={4} className={`switch-dot${on ? ' on' : ''}`} />
            <text x={tx + tw + 24} y={markY(pct as number) + 4} className="eq-small">
              {name as string} {pct}%
            </text>
          </g>
        ))}
        {/* outlet */}
        <line x1={tx + tw / 2} y1={ty + th} x2={tx + tw / 2} y2={ty + th + 18} className={`pipe${s.outletValve > 0 && s.level > 0 ? ' flowing' : ''}`} />
        <text x={tx + tw / 2 + 6} y={ty + th + 16} className="eq-small">
          OUTLET {Math.round(s.outletValve * 100)}%
        </text>
        <text x={tx + tw - 4} y={ty + 12} className="eq-small" textAnchor="end">
          LT I:3 = {Math.round(s.level * 10)}
        </text>
      </svg>
      <div className="row gap wrap">
        <Station title="Operator station">
          <label className="selector">
            <span>OFF</span>
            <input type="checkbox" checked={s.auto} onChange={(e) => touch<TankState>((st) => (st.auto = e.target.checked))} data-testid="auto-switch" />
            <span>AUTO</span>
          </label>
          <PushButton label="RESET" color="blue" testId="pb-reset" onPress={(d) => touch<TankState>((st) => (st.resetPressed = d))} />
          <PilotLight on={out('O:2/0')} color="green" label="PUMP" />
          <PilotLight on={out('O:2/1')} color="red" label="FAULT" />
          <PilotLight on={out('O:2/2')} color="amber" label="HIGH" />
        </Station>
        <Station title="Process">
          <label className="slider">
            Outlet valve
            <input type="range" min={0} max={100} value={Math.round(s.outletValve * 100)} onChange={(e) => touch<TankState>((st) => (st.outletValve = Number(e.target.value) / 100))} />
          </label>
          <Toggle checked={s.supplyOpen} onChange={(v) => touch<TankState>((st) => (st.supplyOpen = v))} label="Supply valve open" />
          <Toggle checked={s.pumpFailed} onChange={(v) => touch<TankState>((st) => (st.pumpFailed = v))} label="Pump failure" />
        </Station>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ generic I/O panel

export function IoPanel() {
  const project = useApp((s) => s.project)!;
  const c = useController();
  const driven = new Set((c.model?.io ?? []).filter((x) => x.dir === 'in').map((x) => normalizeAddress(x.address)));
  const iFile = project.dataFiles.find((f) => f.type === 'I');
  const oFile = project.dataFiles.find((f) => f.type === 'O');
  const sym = (a: string) => project.symbols.find((s) => normalizeAddress(s.address) === a)?.symbol;
  const engine = c.engine;
  const inSlot = 1;
  const outSlot = 2;
  return (
    <div className="io-panel" data-testid="io-panel">
      <p className="hint">
        Simulated hardware: slot 1 = 16-point input card (I:1), slot 2 = 16-point output card (O:2), slot 3 = analog input (I:3). Toggle switches set field inputs; the
        controller reads them at the next input scan. Use F to force a point.
      </p>
      {iFile && iFile.elements > inSlot ? (
        <div className="io-card">
          <div className="io-card-title">I:1 — Digital inputs</div>
          {Array.from({ length: 16 }, (_, b) => {
            const a = `I:${inSlot}/${b}`;
            const field = engine ? engine.getFieldInput(a) : 0;
            const image = engine ? inp(a) : 0;
            const isDriven = driven.has(a);
            const force = forceOf(project, a);
            return (
              <div className="io-point" key={a}>
                <label className={`switch${isDriven ? ' disabled' : ''}`} title={isDriven ? 'Driven by the virtual equipment' : 'Field switch'}>
                  <input
                    type="checkbox"
                    disabled={isDriven || !engine}
                    checked={field === 1}
                    data-testid={`io-in-${b}`}
                    onChange={(e) => {
                      engine?.setFieldInput(a, e.target.checked ? 1 : 0);
                      if (engine && engine.mode !== 'RUN') engine.inputScan();
                      c.notify();
                    }}
                  />
                  <span className="slider-knob" />
                </label>
                <span className={`led${image ? ' on' : ''}`} />
                <span className="mono">{a}</span>
                <span className="io-sym">{sym(a) ?? (isDriven ? '(equipment)' : '')}</span>
                <ForceButtons address={a} force={force} />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="hint">Input file I1 has no slot 1. Increase its size under Controller &gt; Data Files.</div>
      )}
      {oFile && oFile.elements > outSlot ? (
        <div className="io-card">
          <div className="io-card-title">O:2 — Digital outputs</div>
          {Array.from({ length: 16 }, (_, b) => {
            const a = `O:${outSlot}/${b}`;
            const on = engine ? engine.getFieldOutput(a) === 1 : false;
            return (
              <div className="io-point" key={a}>
                <span className={`led big${on ? ' on' : ''}`} data-testid={`io-out-${b}`} />
                <span className="mono">{a}</span>
                <span className="io-sym">{sym(a) ?? ''}</span>
                <ForceButtons address={a} force={forceOf(project, a)} />
              </div>
            );
          })}
        </div>
      ) : null}
      {iFile && iFile.elements > 3 && !driven.has('I:3') && (
        <div className="io-card">
          <div className="io-card-title">I:3 — Analog input (0-1000)</div>
          <input
            type="range"
            min={0}
            max={1000}
            disabled={!engine}
            value={engine ? engine.getFieldInput('I:3') : 0}
            onChange={(e) => {
              engine?.setFieldInput('I:3', Number(e.target.value));
              c.notify();
            }}
          />
          <span className="mono"> {engine ? engine.getFieldInput('I:3') : 0}</span>
        </div>
      )}
    </div>
  );
}

function ForceButtons({ address, force }: { address: string; force: 0 | 1 | null }) {
  return (
    <span className="force-btns">
      <button className={`mini${force === 1 ? ' forced-on' : ''}`} title={`Force ${address} ON`} onClick={() => setForce(address, force === 1 ? null : 1)}>
        F1
      </button>
      <button className={`mini${force === 0 ? ' forced-off' : ''}`} title={`Force ${address} OFF`} onClick={() => setForce(address, force === 0 ? null : 0)}>
        F0
      </button>
    </span>
  );
}
