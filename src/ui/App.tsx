import { useEffect } from 'react';
import { findElement } from '../core/ast';
import {
  addBranch, addBranchLeg, addRung, copySelection, currentRung, cutSelection, deleteSelection, initApp, moveSelected,
  navigate, paste, redo, setUi, undo, useApp,
} from '../store/store';
import { programMode, runMode, saveNow, singleScan } from './actions';
import { Dialogs } from './dialogs';
import { EquipmentPanel } from './equipment';
import { Explorer } from './Explorer';
import { InstructionEditor } from './ladder/InstructionEditor';
import { LadderView } from './ladder/LadderView';
import { MenuBar } from './MenuBar';
import { BottomPanel } from './panels';
import { StatusBar } from './StatusBar';
import { ControllerBar, EditBar } from './Toolbar';

export function App() {
  const ready = useApp((s) => s.ready);

  useEffect(() => {
    void initApp();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => handleKey(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!ready) return <div className="loading">Loading RungRanger…</div>;
  return (
    <div className="app">
      <MenuBar />
      <ControllerBar />
      <EditBar />
      <div className="workspace">
        <Explorer />
        <main className="center">
          <div className="ladder-title">
            <span>LAD 2 - MAIN</span>
            <span className="hint">Click to select · double-click to edit · keys: arrows, Enter, Insert, Del, B, L</span>
          </div>
          <LadderView />
          <BottomPanel />
        </main>
        <EquipmentPanel />
      </div>
      <StatusBar />
      <InstructionEditor />
      <Dialogs />
    </div>
  );
}

function handleKey(e: KeyboardEvent): void {
  const s = useApp.getState();
  const target = e.target as HTMLElement | null;
  const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
  const modal = s.dialog !== null || s.editing !== null || s.rungTextEditing !== null || s.commentEditing !== null;
  const ctrl = e.ctrlKey || e.metaKey;

  // Global function keys
  if (!modal) {
    if (e.key === 'F5') {
      e.preventDefault();
      runMode();
      return;
    }
    if (e.key === 'F6') {
      e.preventDefault();
      programMode();
      return;
    }
    if (e.key === 'F7') {
      e.preventDefault();
      singleScan();
      return;
    }
    if (e.key === 'F1') {
      e.preventDefault();
      setUi({ bottomTab: 'help' });
      return;
    }
  }
  if (ctrl && e.key.toLowerCase() === 's') {
    e.preventDefault();
    saveNow();
    return;
  }
  if (typing || modal) return;

  if (ctrl) {
    const k = e.key.toLowerCase();
    const map: Record<string, () => void> = { z: undo, y: redo, c: copySelection, x: cutSelection, v: paste, r: () => addRung() };
    if (k === 'z' && e.shiftKey) {
      e.preventDefault();
      redo();
      return;
    }
    if (map[k]) {
      e.preventDefault();
      map[k]();
    }
    return;
  }
  if (e.altKey) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      moveSelected(-1);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      moveSelected(1);
    }
    return;
  }
  const sel = s.selection;
  switch (e.key) {
    case 'ArrowUp':
      e.preventDefault();
      navigate('up');
      scrollToSelection();
      break;
    case 'ArrowDown':
      e.preventDefault();
      navigate('down');
      scrollToSelection();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      navigate('left');
      break;
    case 'ArrowRight':
      e.preventDefault();
      navigate('right');
      break;
    case 'Home':
      navigate('home');
      scrollToSelection();
      break;
    case 'End':
      navigate('end');
      scrollToSelection();
      break;
    case 'Delete':
    case 'Backspace':
      e.preventDefault();
      deleteSelection();
      break;
    case 'Enter': {
      e.preventDefault();
      if (sel.kind === 'element') {
        const r = currentRung();
        const loc = r ? findElement(r.elements, sel.elementId) : null;
        if (loc?.element.kind === 'instr') setUi({ editing: { rungId: sel.rungId, elementId: sel.elementId, isNew: false } });
      } else if (sel.kind === 'rung') setUi({ commentEditing: sel.rungId });
      break;
    }
    case 'Insert':
    case '/':
      e.preventDefault();
      document.getElementById('quick-entry')?.focus();
      break;
    case 'b':
    case 'B':
      addBranch();
      break;
    case 'l':
    case 'L':
      addBranchLeg();
      break;
    case 't':
    case 'T':
      e.preventDefault(); // keep the key out of the dialog that opens
      if (sel.kind !== 'none') setUi({ rungTextEditing: sel.rungId });
      break;
    case 'c':
    case 'C':
      e.preventDefault();
      if (sel.kind !== 'none') setUi({ commentEditing: sel.rungId });
      break;
    case 'n':
    case 'N':
      addRung();
      break;
  }
}

function scrollToSelection(): void {
  const sel = useApp.getState().selection;
  if (sel.kind === 'none') return;
  requestAnimationFrame(() => document.getElementById(`rung-${sel.rungId}`)?.scrollIntoView({ block: 'nearest' }));
}
