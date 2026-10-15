/**
 * Controller actions shared by the toolbar, menus and keyboard shortcuts.
 */
import { controller } from '../store/controller';
import { hasErrors } from '../core/validate';
import { flushSave, log, setUi, useApp } from '../store/store';

export function goOnline(): boolean {
  if (controller.online) return true;
  const { project, diagnostics } = useApp.getState();
  if (!project) return false;
  if (hasErrors(diagnostics)) {
    log('Cannot go online: the program has errors. Fix them first (see the Verify tab).', 'error');
    setUi({ bottomTab: 'verify' });
    return false;
  }
  const err = controller.goOnline(project);
  if (err) {
    log(err, 'error');
    setUi({ bottomTab: 'verify' });
    return false;
  }
  log(`Downloaded program to ${project.controller.name} — online (PROGRAM mode)`);
  return true;
}

export function goOffline(): void {
  if (!controller.online) return;
  controller.goOffline();
  log('Went offline. The virtual controller is powered down.');
}

export function runMode(): void {
  if (!goOnline()) return;
  if (controller.mode === 'FAULT') {
    log('Controller is faulted. Clear the fault first.', 'error');
    return;
  }
  controller.setMode('RUN');
  log('Controller in RUN mode');
}

export function programMode(): void {
  if (!controller.online) return;
  controller.setMode('PROGRAM');
  log('Controller in PROGRAM mode (outputs off)');
}

export function pauseMode(): void {
  if (!controller.online || controller.mode !== 'RUN') return;
  controller.setMode('TEST');
  log('Paused (TEST mode): scanning and equipment frozen. Use Single Scan to step.');
}

export function singleScan(): void {
  if (!goOnline()) return;
  controller.singleScan();
}

export function resetController(): void {
  if (!controller.online) {
    controller.resetEquipment();
    return;
  }
  controller.reset();
  log('Controller reset: data table reloaded from the project, equipment reset, PROGRAM mode');
}

export function clearFault(): void {
  controller.clearFault();
  log('Fault cleared (PROGRAM mode)');
}

export function saveNow(): void {
  void flushSave().then(() => log('Project saved to browser storage'));
}
