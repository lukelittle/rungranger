import { useRef, useState, useSyncExternalStore } from 'react';
import { CATEGORY_ORDER, INSTRUCTIONS } from '../core/instructions';
import { MNEMONICS, type Mnemonic } from '../core/types';
import { controller } from '../store/controller';
import { addBranch, addBranchLeg, addRung, deleteSelection, insertInstruction, insertText, redo, setForcesEnabled, setUi, undo, useApp } from '../store/store';
import { clearFault, goOffline, goOnline, pauseMode, programMode, resetController, runMode, singleScan } from './actions';

export const GLYPHS: Record<Mnemonic, string> = {
  XIC: '┤ ├',
  XIO: '┤/├',
  OTE: '( )',
  OTL: '(L)',
  OTU: '(U)',
  RES: '(RES)',
  TON: '[TON]',
  TOF: '[TOF]',
  RTO: '[RTO]',
  CTU: '[CTU]',
  CTD: '[CTD]',
  MOV: '[MOV]',
  EQU: '[EQU]',
  NEQ: '[NEQ]',
  LES: '[LES]',
  GRT: '[GRT]',
  ADD: '[ADD]',
  SUB: '[SUB]',
};

export function ControllerBar() {
  useSyncExternalStore(controller.subscribe, controller.getVersion);
  const project = useApp((s) => s.project);
  const showPowerFlow = useApp((s) => s.showPowerFlow);
  const mode = controller.mode;
  const e = controller.engine;
  const online = controller.online;
  const forcesInstalled = (project?.forces.length ?? 0) > 0;
  const modeLabel = { OFFLINE: 'OFFLINE', PROGRAM: 'PROGRAM', RUN: 'RUN', TEST: 'PAUSED', FAULT: 'FAULTED' }[mode];
  return (
    <div className="controller-bar">
      <div className={`mode-panel mode-${mode.toLowerCase()}`} data-testid="mode-indicator" title="Controller mode">
        <span className={`led ${online ? 'on' : ''}`} />
        <span className="mode-text">{modeLabel}</span>
      </div>
      <button className={`tb ${online ? 'active' : ''}`} onClick={() => (online ? goOffline() : goOnline())} data-testid="btn-online" title="Download the program to the virtual controller and go online / disconnect">
        {online ? 'Go Offline' : 'Go Online'}
      </button>
      <div className="tb-group">
        <button className={`tb run ${mode === 'RUN' ? 'active' : ''}`} onClick={runMode} data-testid="btn-run" title="RUN mode (F5). Goes online automatically.">
          ▶ RUN
        </button>
        <button className={`tb ${mode === 'PROGRAM' ? 'active' : ''}`} onClick={programMode} disabled={!online || mode === 'FAULT'} data-testid="btn-program" title="PROGRAM mode: scanning stops, outputs off (F6)">
          ■ PROG
        </button>
        <button className={`tb ${mode === 'TEST' ? 'active' : ''}`} onClick={pauseMode} disabled={mode !== 'RUN'} data-testid="btn-pause" title="Pause: freeze scanning and the equipment">
          ❚❚ PAUSE
        </button>
        <button className="tb" onClick={singleScan} disabled={mode === 'FAULT'} data-testid="btn-step" title="Execute one scan, then pause (F7)">
          ▷| SCAN
        </button>
        <button className="tb" onClick={resetController} data-testid="btn-reset" title="Reset: reload initial data values, reset equipment, PROGRAM mode">
          ⟲ RESET
        </button>
        {mode === 'FAULT' && (
          <button className="tb fault" onClick={clearFault} data-testid="btn-clear-fault">
            Clear Fault
          </button>
        )}
      </div>
      <div className="tb-group">
        <label className="inline" title="Simulation speed relative to real time">
          Speed
          <select
            value={controller.speed}
            onChange={(ev) => {
              controller.speed = Number(ev.target.value);
              controller.notify();
            }}
          >
            {[0.25, 0.5, 1, 2, 5, 10].map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>
        <label className="inline" title="Color wires that carry logical power">
          <input type="checkbox" checked={showPowerFlow} onChange={(ev) => setUi({ showPowerFlow: ev.target.checked })} /> Power flow
        </label>
      </div>
      <div className="tb-group">
        <button
          className={`tb forces ${forcesInstalled ? (project?.forcesEnabled ? 'forces-on' : 'forces-installed') : ''}`}
          disabled={!forcesInstalled}
          onClick={() => setForcesEnabled(!project?.forcesEnabled)}
          title={forcesInstalled ? 'Forces are installed. Click to enable/disable them.' : 'No forces installed'}
          data-testid="btn-forces"
        >
          FORCES {forcesInstalled ? (project?.forcesEnabled ? 'ENABLED' : 'DISABLED') : 'NONE'}
        </button>
      </div>
      <div className="scan-info mono" data-testid="scan-info">
        {e ? (
          <>
            Scans {e.scanCount} · t={(e.simTimeMs / 1000).toFixed(2)} s · {e.scanIntervalMs} ms/scan
          </>
        ) : (
          <>Scan interval {project?.controller.scanIntervalMs ?? '-'} ms</>
        )}
      </div>
      {e?.fault && (
        <div className="fault-banner" data-testid="fault-banner">
          MAJOR FAULT {e.fault.code.toString(16).toUpperCase().padStart(4, '0')}h{e.fault.rung !== null ? ` at rung ${e.fault.rung}` : ''}: {e.fault.message}
        </div>
      )}
      {controller.pendingEditError && <div className="pending-banner">Online edit not applied: {controller.pendingEditError}</div>}
    </div>
  );
}

export function EditBar() {
  const [cat, setCat] = useState(CATEGORY_ORDER[0]);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const undoN = useApp((s) => s.undoStack.length);
  const redoN = useApp((s) => s.redoStack.length);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="edit-bar">
      <div className="tb-group">
        <button className="tb" onClick={() => addRung()} title="New rung (Ctrl+R)" data-testid="btn-new-rung">
          ═ Rung
        </button>
        <button className="tb" onClick={addBranch} title="Branch around the selected instruction (B)" data-testid="btn-branch">
          ╦ Branch
        </button>
        <button className="tb" onClick={addBranchLeg} title="Add a leg to the selected branch (L)" data-testid="btn-leg">
          ╠ Leg
        </button>
        <button className="tb" onClick={deleteSelection} title="Delete selection (Del)" data-testid="btn-delete">
          ✕ Delete
        </button>
        <button className="tb" onClick={undo} disabled={!undoN} title="Undo (Ctrl+Z)" data-testid="btn-undo">
          ↶
        </button>
        <button className="tb" onClick={redo} disabled={!redoN} title="Redo (Ctrl+Y)" data-testid="btn-redo">
          ↷
        </button>
      </div>
      <div className="palette">
        <div className="palette-tabs">
          {CATEGORY_ORDER.map((c) => (
            <button key={c} className={`ptab${c === cat ? ' active' : ''}`} onClick={() => setCat(c)}>
              {c}
            </button>
          ))}
        </div>
        <div className="palette-items">
          {MNEMONICS.filter((m) => INSTRUCTIONS[m].category === cat).map((m) => (
            <button key={m} className="pal-btn" onClick={() => insertInstruction(m)} title={`${m} - ${INSTRUCTIONS[m].name}\n${INSTRUCTIONS[m].summary}`} data-testid={`pal-${m}`}>
              <span className="glyph">{GLYPHS[m]}</span>
              <span className="pal-m">{m}</span>
            </button>
          ))}
        </div>
      </div>
      <form
        className="quick-entry"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          const r = insertText(text);
          setErr(r);
          if (!r) setText('');
        }}
      >
        <input
          ref={ref}
          id="quick-entry"
          className={`mono${err ? ' invalid' : ''}`}
          placeholder="Type: XIC I:1/0  (Insert or / to focus)"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setErr(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setText('');
              setErr(null);
              ref.current?.blur();
            }
          }}
          title={err ?? 'Type instructions in mnemonic form and press Enter to insert after the selection. BST/NXB/BND create branches.'}
          data-testid="quick-entry"
        />
        {err && <span className="field-msg err quick-err">{err}</span>}
      </form>
    </div>
  );
}
