import { useRef, useState } from 'react';
import { FILE_TYPE_NAMES, fileKey } from '../core/address';
import { formatRungText } from '../core/ascii';
import { getDataValue, MAX_ELEMENTS } from '../core/project';
import type { DataFileDef, FileType } from '../core/types';
import { EXAMPLES } from '../examples';
import {
  createProject, deleteProject, duplicateProject, edit, exportCurrentProject, importProjectFile, openProject,
  renameProject, replaceRungText, setRungComment, setUi, useApp,
} from '../store/store';
import { Dialog } from './Dialog';
import { STORAGE_NOTICE } from './text';

export function Dialogs() {
  const dialog = useApp((s) => s.dialog);
  const close = () => setUi({ dialog: null });
  return (
    <>
      {dialog === 'projects' && <ProjectsDialog onClose={close} />}
      {dialog === 'controller' && <ControllerDialog onClose={close} />}
      {dialog === 'datafiles' && <DataFilesDialog onClose={close} />}
      {dialog === 'about' && <AboutDialog onClose={close} />}
      {dialog === 'shortcuts' && <ShortcutsDialog onClose={close} />}
      {dialog === 'welcome' && <WelcomeDialog onClose={close} />}
      <RungTextDialog />
      <CommentDialog />
    </>
  );
}

function ProjectsDialog({ onClose }: { onClose: () => void }) {
  const projects = useApp((s) => s.projects);
  const current = useApp((s) => s.project);
  const storageLabel = useApp((s) => s.storageLabel);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [newName, setNewName] = useState('');
  const [importMsg, setImportMsg] = useState<string[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onImport = async (file: File) => {
    const text = await file.text();
    const r = await importProjectFile(text);
    if (r.ok) {
      setImportMsg(r.warnings.length ? ['Imported with repairs:', ...r.warnings] : ['Imported successfully.']);
    } else setImportMsg(['Import failed:', ...r.errors]);
  };

  return (
    <Dialog title="Projects" onClose={onClose} width={720} testId="projects-dialog">
      <div className="notice">{STORAGE_NOTICE}</div>
      <div className="row gap">
        <input placeholder="New project name" value={newName} onChange={(e) => setNewName(e.target.value)} data-testid="new-project-name" />
        <button
          onClick={async () => {
            await createProject(newName || 'Untitled');
            setNewName('');
            onClose();
          }}
          data-testid="create-project"
        >
          New blank project
        </button>
        <button onClick={() => fileRef.current?.click()} data-testid="import-button">
          Import JSON…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          data-testid="import-file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onImport(f);
            e.target.value = '';
          }}
        />
        <button onClick={exportCurrentProject}>Export current…</button>
      </div>
      {importMsg && (
        <div className={`notice ${importMsg[0].startsWith('Import failed') ? 'error' : ''}`}>
          {importMsg.map((m, i) => (
            <div key={i}>{m}</div>
          ))}
        </div>
      )}
      <div className="subhead">Open an example</div>
      <div className="row gap wrap">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.key}
            onClick={async () => {
              await createProject('', ex.key);
              onClose();
            }}
            title={ex.spec.description}
            data-testid={`example-${ex.key}`}
          >
            {ex.spec.name}
          </button>
        ))}
      </div>
      <div className="subhead">Saved in {storageLabel}</div>
      <table className="grid-table projects">
        <thead>
          <tr>
            <th>Name</th>
            <th>Rungs</th>
            <th>Modified</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.id} className={p.id === current?.id ? 'current' : ''}>
              <td>
                {renaming === p.id ? (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      await renameProject(p.id, name);
                      setRenaming(null);
                    }}
                  >
                    <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setRenaming(null)} data-testid="rename-input" />
                  </form>
                ) : (
                  <span>
                    {p.name} {p.id === current?.id && <em>(open)</em>}
                  </span>
                )}
              </td>
              <td>{p.rungCount}</td>
              <td>{p.modifiedAt ? new Date(p.modifiedAt).toLocaleString() : '-'}</td>
              <td className="actions">
                <button
                  disabled={p.id === current?.id}
                  onClick={async () => {
                    await openProject(p.id);
                    onClose();
                  }}
                >
                  Open
                </button>
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setRenaming(p.id);
                    setName(p.name);
                  }}
                >
                  Rename
                </button>
                <button onClick={() => void duplicateProject(p.id)}>Duplicate</button>
                <button
                  className="danger"
                  onClick={() => {
                    if (confirm(`Delete project "${p.name}" from browser storage? This cannot be undone. Export it first if you want a backup.`)) void deleteProject(p.id);
                  }}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}

function ControllerDialog({ onClose }: { onClose: () => void }) {
  const project = useApp((s) => s.project)!;
  const [name, setName] = useState(project.controller.name);
  const [scan, setScan] = useState(String(project.controller.scanIntervalMs));
  const [desc, setDesc] = useState(project.description);
  const scanN = Number(scan);
  const scanOk = Number.isInteger(scanN) && scanN >= 5 && scanN <= 2000;
  return (
    <Dialog
      title="Controller Properties"
      onClose={onClose}
      testId="controller-dialog"
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            disabled={!scanOk}
            onClick={() => {
              edit((p) => ({ ...p, description: desc, controller: { name: name.trim() || 'VIRTUAL_PLC', scanIntervalMs: scanN } }));
              onClose();
            }}
          >
            OK
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label>Controller name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className="mono" />
        <label>Scan interval (ms)</label>
        <div>
          <input value={scan} onChange={(e) => setScan(e.target.value)} className="mono" data-testid="scan-interval" />
          <div className={`field-msg ${scanOk ? 'ok' : 'err'}`}>
            {scanOk ? 'Simulated time advances by this amount every scan (5-2000 ms).' : 'Enter a whole number from 5 to 2000'}
          </div>
        </div>
        <label>Project description</label>
        <textarea rows={4} value={desc} onChange={(e) => setDesc(e.target.value)} />
      </div>
      <p className="hint">Data file sizes are configured under Controller &gt; Data Files.</p>
    </Dialog>
  );
}

const ADDABLE: FileType[] = ['B', 'T', 'C', 'R', 'N', 'F'];

function DataFilesDialog({ onClose }: { onClose: () => void }) {
  const project = useApp((s) => s.project)!;
  const [files, setFiles] = useState<DataFileDef[]>(project.dataFiles.map((f) => ({ ...f })));
  const [newType, setNewType] = useState<FileType>('N');
  const [newNum, setNewNum] = useState('9');
  const errs: string[] = [];
  for (const f of files) {
    const max = MAX_ELEMENTS[f.type] ?? MAX_ELEMENTS.default;
    if (!Number.isInteger(f.elements) || f.elements < 1 || f.elements > max) errs.push(`${f.type}${f.number}: elements must be 1-${max}`);
  }
  const num = Number(newNum);
  const addErr = !Number.isInteger(num) || num < 9 || num > 255 ? 'File number must be 9-255' : files.some((f) => f.number === num) ? `File number ${num} is in use` : null;
  return (
    <Dialog
      title="Data Files"
      onClose={onClose}
      width={620}
      testId="datafiles-dialog"
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            disabled={errs.length > 0}
            onClick={() => {
              edit((p) => ({ ...p, dataFiles: [...files].sort((a, b) => a.number - b.number) }));
              onClose();
            }}
          >
            Apply
          </button>
        </>
      }
    >
      <p className="hint">
        Set how many elements each data file holds. I/O files hold one 16-bit word per slot. Shrinking a file discards values beyond the new size. Timer, counter and control
        elements use three words each.
      </p>
      <table className="grid-table">
        <thead>
          <tr>
            <th>File</th>
            <th>Type</th>
            <th>Elements</th>
            <th>Last address</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {files.map((f, i) => (
            <tr key={fileKey(f.type, f.number)}>
              <td className="mono">
                {f.type}
                {f.number}
              </td>
              <td>{FILE_TYPE_NAMES[f.type]}</td>
              <td>
                <input
                  className="mono small-input"
                  type="number"
                  min={1}
                  value={f.elements}
                  disabled={f.type === 'S'}
                  data-testid={`elements-${f.type}${f.number}`}
                  onChange={(e) => setFiles(files.map((g, j) => (j === i ? { ...g, elements: Math.floor(Number(e.target.value)) } : g)))}
                />
              </td>
              <td className="mono">{f.elements > 0 ? `${f.type === 'I' || f.type === 'O' || f.type === 'S' ? f.type : `${f.type}${f.number}`}:${f.elements - 1}` : '-'}</td>
              <td>
                {f.number >= 9 && (
                  <button className="danger" onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {errs.map((e) => (
        <div key={e} className="field-msg err">
          {e}
        </div>
      ))}
      <div className="row gap" style={{ marginTop: 8 }}>
        <span>Add file:</span>
        <select value={newType} onChange={(e) => setNewType(e.target.value as FileType)}>
          {ADDABLE.map((t) => (
            <option key={t} value={t}>
              {t} - {FILE_TYPE_NAMES[t]}
            </option>
          ))}
        </select>
        <input className="mono small-input" value={newNum} onChange={(e) => setNewNum(e.target.value)} />
        <button disabled={!!addErr} onClick={() => setFiles([...files, { type: newType, number: num, elements: 16 }])}>
          Add
        </button>
        {addErr && <span className="field-msg err">{addErr}</span>}
      </div>
    </Dialog>
  );
}

function RungTextDialog() {
  const rungId = useApp((s) => s.rungTextEditing);
  const project = useApp((s) => s.project);
  const rung = project?.program.rungs.find((r) => r.id === rungId);
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!rung || !project) return null;
  const initial = formatRungText(rung.elements, (a) => {
    try {
      return getDataValue(project, a);
    } catch {
      return undefined;
    }
  });
  const value = text ?? initial;
  const close = () => {
    setText(null);
    setErr(null);
    setUi({ rungTextEditing: null });
  };
  const apply = () => {
    const e = replaceRungText(rung.id, value);
    if (e) setErr(e);
    else close();
  };
  return (
    <Dialog
      title={`Edit Rung ${project.program.rungs.indexOf(rung)} as Text`}
      onClose={close}
      width={760}
      testId="rung-text-dialog"
      footer={
        <>
          <button onClick={close}>Cancel</button>
          <button className="primary" onClick={apply} data-testid="rung-text-apply">
            Apply
          </button>
        </>
      }
    >
      <p className="hint">
        Mnemonic notation: instructions with their operands, separated by spaces. <code>BST</code> starts a branch, <code>NXB</code> starts the next leg, <code>BND</code> ends it.
        Timers and counters take their preset and accumulator inline, e.g. <code>TON T4:0 1.0 5 0</code>.
      </p>
      <textarea
        className="mono"
        rows={5}
        autoFocus
        value={value}
        data-testid="rung-text"
        onChange={(e) => {
          setText(e.target.value);
          setErr(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) apply();
        }}
      />
      {err && <div className="field-msg err">{err}</div>}
    </Dialog>
  );
}

function CommentDialog() {
  const rungId = useApp((s) => s.commentEditing);
  const project = useApp((s) => s.project);
  const rung = project?.program.rungs.find((r) => r.id === rungId);
  const [text, setText] = useState<string | null>(null);
  if (!rung || !project) return null;
  const value = text ?? rung.comment;
  const close = () => {
    setText(null);
    setUi({ commentEditing: null });
  };
  return (
    <Dialog
      title={`Rung ${project.program.rungs.indexOf(rung)} Comment`}
      onClose={close}
      testId="comment-dialog"
      footer={
        <>
          <button onClick={close}>Cancel</button>
          <button
            className="primary"
            data-testid="comment-ok"
            onClick={() => {
              setRungComment(rung.id, value);
              close();
            }}
          >
            OK
          </button>
        </>
      }
    >
      <textarea autoFocus rows={6} value={value} onChange={(e) => setText(e.target.value)} data-testid="comment-text" placeholder="Describe what this rung does…" />
    </Dialog>
  );
}

function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="About RungRanger" onClose={onClose} width={600}>
      <p>
        <strong>RungRanger</strong> is a free, open-source, browser-based ladder logic editor and PLC simulator for learning and practice. It runs entirely in your browser, needs
        no installation, account or hardware, and works offline once loaded.
      </p>
      <p>
        The simulator implements documented, general ladder logic concepts and classic file-based PLC addressing independently. It is not a bit-for-bit emulation of any commercial
        controller and has not been verified against real hardware. Do not use it to validate programs for real machinery.
      </p>
      <p>Licensed under the MIT License. Contains no proprietary software, code, icons, fonts or documentation.</p>
      <p className="hint">{STORAGE_NOTICE}</p>
    </Dialog>
  );
}

export const SHORTCUTS: [string, string][] = [
  ['↑ / ↓', 'Previous / next rung'],
  ['← / →', 'Previous / next instruction in the rung'],
  ['Enter', 'Edit selected instruction (or rung comment when a rung is selected)'],
  ['Insert or /', 'Type an instruction in mnemonic form (e.g. XIC I:1/0)'],
  ['Delete', 'Delete selected instruction, branch, leg or rung'],
  ['Ctrl+R', 'New rung after the selected rung'],
  ['B', 'Add a branch around the selected instruction'],
  ['L', 'Add a leg to the selected branch'],
  ['T', 'Edit selected rung as text'],
  ['C', 'Edit rung comment'],
  ['Alt+← / Alt+→', 'Move instruction left / right (Alt+↑/↓ moves a rung)'],
  ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
  ['Ctrl+C / Ctrl+X / Ctrl+V', 'Copy / cut / paste instruction or rung'],
  ['Ctrl+S', 'Save now (projects also autosave)'],
  ['F5 / F6 / F7', 'Run / Program / Single scan'],
  ['F1', 'Instruction help'],
];

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard Shortcuts" onClose={onClose} width={560}>
      <table className="grid-table">
        <tbody>
          {SHORTCUTS.map(([k, d]) => (
            <tr key={k}>
              <td className="mono nowrap">{k}</td>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}

function WelcomeDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      title="Welcome to RungRanger"
      onClose={onClose}
      width={620}
      testId="welcome-dialog"
      footer={
        <button className="primary" onClick={onClose} data-testid="welcome-ok">
          Start
        </button>
      }
    >
      <p>The Motor Starter example is open. To try it:</p>
      <ol>
        <li>
          Press <b>RUN</b> on the toolbar. The program is downloaded to the virtual controller and starts scanning.
        </li>
        <li>
          In the equipment panel on the right, press <b>START</b>. Watch the rungs light up and the motor spin.
        </li>
        <li>
          Press <b>STOP</b>, or switch on <b>Heavy load</b> and wait for the overload to trip.
        </li>
        <li>Double-click any instruction to change its address. Your edits are saved automatically in this browser.</li>
      </ol>
      <p className="notice">{STORAGE_NOTICE}</p>
    </Dialog>
  );
}
