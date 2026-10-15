import { useSyncExternalStore } from 'react';
import { findElement } from '../core/ast';
import { controller } from '../store/controller';
import { setUi, useApp } from '../store/store';

export function StatusBar() {
  const project = useApp((s) => s.project);
  const sel = useApp((s) => s.selection);
  const saveState = useApp((s) => s.saveState);
  const lastSavedAt = useApp((s) => s.lastSavedAt);
  const diags = useApp((s) => s.diagnostics);
  useSyncExternalStore(controller.subscribe, controller.getVersion);
  const rungs = project?.program.rungs ?? [];
  let where = '';
  if (sel.kind !== 'none') {
    const i = rungs.findIndex((r) => r.id === sel.rungId);
    where = `Rung ${i}`;
    if (sel.kind === 'element' && rungs[i]) {
      const loc = findElement(rungs[i].elements, sel.elementId);
      if (loc?.element.kind === 'instr') where += ` · ${loc.element.mnemonic} ${loc.element.operands.join(' ')}`;
      else if (loc) where += ' · branch';
    }
    if (sel.kind === 'leg') where += ` · branch leg ${sel.leg + 1}`;
  }
  const errors = diags.filter((d) => d.severity === 'error').length;
  const saveText = {
    saved: lastSavedAt ? `Saved locally ${lastSavedAt}` : 'Saved locally',
    pending: 'Unsaved changes…',
    saving: 'Saving…',
    error: 'SAVE FAILED — export a backup!',
    memory: 'NOT SAVED (browser storage unavailable) — export to keep work',
  }[saveState];
  return (
    <footer className="statusbar">
      <div className="status-row">
        <span className="status-cell" data-testid="status-mode">
          {controller.mode}
        </span>
        <span className="status-cell">{where || 'No selection'}</span>
        <span className={`status-cell clickable ${errors ? 'err' : ''}`} onClick={() => setUi({ bottomTab: 'verify' })}>
          {errors ? `${errors} error(s)` : 'Verified OK'}
        </span>
        <span className={`status-cell save-${saveState}`} data-testid="save-state" title="Projects are saved in this browser. Export a backup from the File menu.">
          {saveText}
        </span>
        <span className="status-cell clickable" onClick={() => setUi({ dialog: 'about' })}>
          About
        </span>
      </div>
    </footer>
  );
}
