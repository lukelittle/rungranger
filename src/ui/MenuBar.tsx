import { useEffect, useRef, useState } from 'react';
import { controller } from '../store/controller';
import {
  addBranch, addBranchLeg, addRung, captureLiveData, copySelection, cutSelection, deleteSelection, exportCurrentProject, paste, redo,
  setUi, undo, useApp,
} from '../store/store';
import { clearFault, goOffline, goOnline, pauseMode, programMode, resetController, runMode, saveNow, singleScan } from './actions';

interface Item {
  label: string;
  shortcut?: string;
  action?: () => void;
  disabled?: boolean;
  sep?: boolean;
}

export function MenuBar() {
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const project = useApp((s) => s.project);
  const sel = useApp((s) => s.selection);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const rungSel = sel.kind !== 'none' ? sel.rungId : null;
  const menus: Record<string, Item[]> = {
    File: [
      { label: 'Projects / Open…', action: () => setUi({ dialog: 'projects' }) },
      { label: 'Save now', shortcut: 'Ctrl+S', action: saveNow },
      { label: 'Export project (JSON)…', action: exportCurrentProject },
      { label: 'Import project (JSON)…', action: () => setUi({ dialog: 'projects' }) },
      { sep: true, label: '' },
      { label: 'Controller properties…', action: () => setUi({ dialog: 'controller' }) },
    ],
    Edit: [
      { label: 'Undo', shortcut: 'Ctrl+Z', action: undo },
      { label: 'Redo', shortcut: 'Ctrl+Y', action: redo },
      { sep: true, label: '' },
      { label: 'Cut', shortcut: 'Ctrl+X', action: cutSelection },
      { label: 'Copy', shortcut: 'Ctrl+C', action: copySelection },
      { label: 'Paste', shortcut: 'Ctrl+V', action: paste },
      { label: 'Delete', shortcut: 'Del', action: deleteSelection },
      { sep: true, label: '' },
      { label: 'New rung', shortcut: 'Ctrl+R', action: () => addRung() },
      { label: 'Insert rung above', action: () => addRung('before') },
      { label: 'Add branch', shortcut: 'B', action: addBranch },
      { label: 'Add branch leg', shortcut: 'L', action: addBranchLeg },
      { label: 'Edit rung comment…', shortcut: 'C', action: () => rungSel && setUi({ commentEditing: rungSel }), disabled: !rungSel },
      { label: 'Edit rung as text…', shortcut: 'T', action: () => rungSel && setUi({ rungTextEditing: rungSel }), disabled: !rungSel },
    ],
    View: [
      { label: 'Data table', action: () => setUi({ bottomTab: 'data' }) },
      { label: 'Cross reference', action: () => setUi({ bottomTab: 'xref' }) },
      { label: 'Verify (diagnostics)', action: () => setUi({ bottomTab: 'verify' }) },
      { label: 'Symbols', action: () => setUi({ bottomTab: 'symbols' }) },
      { label: 'Instruction help', shortcut: 'F1', action: () => setUi({ bottomTab: 'help' }) },
      { label: 'Messages', action: () => setUi({ bottomTab: 'log' }) },
    ],
    Controller: [
      { label: controller.online ? 'Go offline' : 'Go online (download)', action: () => (controller.online ? goOffline() : goOnline()) },
      { sep: true, label: '' },
      { label: 'Run', shortcut: 'F5', action: runMode },
      { label: 'Program', shortcut: 'F6', action: programMode },
      { label: 'Pause', action: pauseMode },
      { label: 'Single scan', shortcut: 'F7', action: singleScan },
      { label: 'Reset controller', action: resetController },
      { label: 'Clear major fault', action: clearFault, disabled: controller.mode !== 'FAULT' },
      { sep: true, label: '' },
      { label: 'Save live data values to project', action: captureLiveData, disabled: !controller.online },
      { label: 'Data files…', action: () => setUi({ dialog: 'datafiles' }) },
      { label: 'Properties…', action: () => setUi({ dialog: 'controller' }) },
    ],
    Help: [
      { label: 'Instruction reference', action: () => setUi({ bottomTab: 'help' }) },
      { label: 'Keyboard shortcuts', action: () => setUi({ dialog: 'shortcuts' }) },
      { label: 'Getting started', action: () => setUi({ dialog: 'welcome' }) },
      { label: 'About RungRanger', action: () => setUi({ dialog: 'about' }) },
    ],
  };

  return (
    <div className="menubar" ref={ref}>
      <span className="brand" title="RungRanger">
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <line x1="2" y1="1" x2="2" y2="17" stroke="currentColor" strokeWidth="2" />
          <line x1="16" y1="1" x2="16" y2="17" stroke="currentColor" strokeWidth="2" />
          <line x1="2" y1="5" x2="16" y2="5" stroke="currentColor" strokeWidth="1.5" />
          <line x1="2" y1="12" x2="16" y2="12" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        RungRanger
      </span>
      {Object.entries(menus).map(([name, items]) => (
        <div key={name} className="menu">
          <button className={`menu-title${open === name ? ' open' : ''}`} onClick={() => setOpen(open === name ? null : name)} onMouseEnter={() => open && setOpen(name)} data-testid={`menu-${name}`}>
            {name}
          </button>
          {open === name && (
            <div className="menu-dropdown">
              {items.map((it, i) =>
                it.sep ? (
                  <div key={i} className="menu-sep" />
                ) : (
                  <button
                    key={i}
                    className="menu-item"
                    disabled={it.disabled}
                    onClick={() => {
                      setOpen(null);
                      it.action?.();
                    }}
                  >
                    <span>{it.label}</span>
                    {it.shortcut && <span className="menu-shortcut">{it.shortcut}</span>}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      ))}
      <span className="project-title" title={project?.description}>
        {project?.name}
      </span>
    </div>
  );
}
