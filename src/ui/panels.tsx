import { useMemo, useState, useSyncExternalStore } from 'react';
import { FILE_TYPE_NAMES, fileKeyOf, isValidSymbolName, normalizeAddress, resolveAddress, STRUCT_BITS, wordsPerElement } from '../core/address';
import { CATEGORY_ORDER, INSTRUCTIONS } from '../core/instructions';
import { MNEMONICS, type DataFileDef, type Mnemonic, type Project } from '../core/types';
import { buildXref, searchXref } from '../core/xref';
import { controller } from '../store/controller';
import { captureLiveData, edit, forceOf, setForce, setUi, showInLadder, useApp, writeData, type BottomTab } from '../store/store';
import { formatValue, makeDataView, type DataView } from './dataView';

const TABS: [BottomTab, string][] = [
  ['data', 'Data Table'],
  ['xref', 'Cross Reference'],
  ['verify', 'Verify'],
  ['symbols', 'Symbols'],
  ['help', 'Instruction Help'],
  ['log', 'Messages'],
];

export function BottomPanel() {
  const tab = useApp((s) => s.bottomTab);
  const diags = useApp((s) => s.diagnostics);
  const errors = diags.filter((d) => d.severity === 'error').length;
  const warnings = diags.filter((d) => d.severity === 'warning').length;
  return (
    <div className="bottom-panel">
      <div className="tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`tab${tab === k ? ' active' : ''}`} onClick={() => setUi({ bottomTab: k })} data-testid={`tab-${k}`}>
            {label}
            {k === 'verify' && (errors > 0 || warnings > 0) && (
              <span className={`badge ${errors ? 'err' : 'warn'}`}>{errors ? `${errors}E` : ''}{errors && warnings ? ' ' : ''}{warnings ? `${warnings}W` : ''}</span>
            )}
          </button>
        ))}
      </div>
      <div className="tab-body">
        {tab === 'data' && <DataTableView />}
        {tab === 'xref' && <XrefView />}
        {tab === 'verify' && <VerifyView />}
        {tab === 'symbols' && <SymbolsView />}
        {tab === 'help' && <HelpView />}
        {tab === 'log' && <LogView />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ data table

type Radix = 'dec' | 'hex' | 'bin';

function fmtWord(v: number | null, radix: Radix): string {
  if (v === null) return '?';
  if (radix === 'hex') return (v & 0xffff).toString(16).toUpperCase().padStart(4, '0');
  if (radix === 'bin') return (v & 0xffff).toString(2).padStart(16, '0');
  return String(v);
}

function parseWord(text: string, radix: Radix): number | null {
  const t = text.trim();
  let n: number;
  if (radix === 'hex') n = parseInt(t, 16);
  else if (radix === 'bin') n = parseInt(t, 2);
  else n = Number(t);
  if (!Number.isFinite(n)) return null;
  if (radix !== 'dec') n = (n << 16) >> 16;
  return n;
}

const STATUS_LABELS: Record<number, string> = {
  0: 'Arithmetic flags: /0 carry, /1 overflow, /2 zero, /3 sign',
  1: '/15 first pass (on during the first scan)',
  4: 'Free-running clock (10 ms per count)',
  5: '/0 overflow trap (major fault at end of scan if set)',
  6: 'Major fault code',
};

export function DataTableView() {
  const project = useApp((s) => s.project)!;
  const key = useApp((s) => s.dataFileKey);
  useSyncExternalStore(controller.subscribe, controller.getVersion);
  const [radix, setRadix] = useState<Radix>('dec');
  const def = project.dataFiles.find((f) => fileKeyOf(f) === key) ?? project.dataFiles[0];
  const data = makeDataView(project, controller.engine);
  const online = !!controller.engine;
  return (
    <div className="datatable" data-testid="data-table">
      <div className="toolbar-row">
        {project.dataFiles.map((f) => (
          <button key={fileKeyOf(f)} className={`chip${fileKeyOf(f) === fileKeyOf(def) ? ' active' : ''}`} onClick={() => setUi({ dataFileKey: fileKeyOf(f) })} data-testid={`file-${fileKeyOf(f)}`}>
            {fileKeyOf(f)}
          </button>
        ))}
        <span className="spacer" />
        {['B', 'N', 'I', 'O', 'S'].includes(def.type) && (
          <label className="inline">
            Radix{' '}
            <select value={radix} onChange={(e) => setRadix(e.target.value as Radix)}>
              <option value="dec">Decimal</option>
              <option value="hex">Hex</option>
              <option value="bin">Binary</option>
            </select>
          </label>
        )}
        <span className={`live-tag ${online ? 'on' : ''}`}>{online ? 'LIVE controller data' : 'Offline project values'}</span>
        {online && (
          <button onClick={captureLiveData} title="Copy the live data table into the project so it is saved and used as initial values">
            Save live values to project
          </button>
        )}
      </div>
      <div className="file-caption">
        {fileKeyOf(def)} {FILE_TYPE_NAMES[def.type]} — {def.elements} element{def.elements === 1 ? '' : 's'}
        {(def.type === 'I' || def.type === 'O') && ' — click a bit to cycle its force: none → ON → OFF'}
        {['B', 'N', 'T', 'C', 'R'].includes(def.type) && ' — click bits to toggle, double-click values to edit'}
      </div>
      <div className="datatable-body">
        {def.type === 'T' || def.type === 'C' || def.type === 'R' ? (
          <StructTable def={def} data={data} />
        ) : def.type === 'F' ? (
          <WordGrid def={def} data={data} radix="dec" float />
        ) : def.type === 'B' || def.type === 'I' || def.type === 'O' || radix === 'bin' ? (
          <BitGrid def={def} data={data} project={project} radix={radix} />
        ) : (
          <WordGrid def={def} data={data} radix={radix} />
        )}
      </div>
    </div>
  );
}

function prefix(def: DataFileDef): string {
  return def.type === 'I' || def.type === 'O' || def.type === 'S' ? `${def.type}:` : `${def.type}${def.number}:`;
}

function BitGrid({ def, data, project, radix }: { def: DataFileDef; data: DataView; project: Project; radix: Radix }) {
  const io = def.type === 'I' || def.type === 'O';
  const symbols = useMemo(() => new Map(project.symbols.map((s) => [normalizeAddress(s.address), s.symbol])), [project.symbols]);
  const rows = Array.from({ length: def.elements }, (_, e) => e);
  return (
    <table className="bit-grid">
      <thead>
        <tr>
          <th>Address</th>
          {Array.from({ length: 16 }, (_, i) => (
            <th key={i}>{15 - i}</th>
          ))}
          <th>{radix === 'bin' ? 'Dec' : radix === 'hex' ? 'Hex' : 'Dec'}</th>
          {def.type === 'S' && <th>Meaning</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((e) => {
          const w = data.read(`${prefix(def)}${e}`);
          return (
            <tr key={e}>
              <td className="mono addr">{`${prefix(def)}${e}`}</td>
              {Array.from({ length: 16 }, (_, i) => {
                const b = 15 - i;
                const addr = `${prefix(def)}${e}/${b}`;
                const v = w === null ? 0 : (w >> b) & 1;
                const force = io ? forceOf(project, addr) : null;
                const sym = symbols.get(normalizeAddress(addr));
                return (
                  <td
                    key={b}
                    className={`bit ${v ? 'on' : ''}${force !== null ? ' forced' : ''}${sym ? ' has-sym' : ''}`}
                    title={`${addr}${sym ? ` (${sym})` : ''} = ${v}${force !== null ? ` — FORCED ${force ? 'ON' : 'OFF'}` : ''}`}
                    data-testid={`bit-${addr}`}
                    onClick={() => {
                      if (io) setForce(addr, force === null ? 1 : force === 1 ? 0 : null);
                      else writeData(addr, v ? 0 : 1);
                    }}
                  >
                    {v}
                    {force !== null && <span className="force-mark">F</span>}
                  </td>
                );
              })}
              <td className="mono">{radix === 'hex' ? fmtWord(w, 'hex') : fmtWord(w, 'dec')}</td>
              {def.type === 'S' && <td className="meaning">{STATUS_LABELS[e] ?? ''}</td>}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function EditableValue({ address, text, parse, testId }: { address: string; text: string; parse: (s: string) => number | null; testId?: string }) {
  const [editing, setEditing] = useState<string | null>(null);
  if (editing !== null) {
    return (
      <input
        className="cell-input mono"
        autoFocus
        value={editing}
        data-testid={testId ? `${testId}-input` : undefined}
        onChange={(e) => setEditing(e.target.value)}
        onBlur={() => setEditing(null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const n = parse(editing);
            if (n !== null) writeData(address, n);
            setEditing(null);
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            setEditing(null);
          }
        }}
      />
    );
  }
  return (
    <span className="cell-value" onDoubleClick={() => setEditing(text)} title={`${address} — double-click to edit`} data-testid={testId}>
      {text}
    </span>
  );
}

function WordGrid({ def, data, radix, float }: { def: DataFileDef; data: DataView; radix: Radix; float?: boolean }) {
  const perRow = float ? 5 : 10;
  const rows = Math.ceil(def.elements / perRow);
  return (
    <table className="word-grid">
      <thead>
        <tr>
          <th>Address</th>
          {Array.from({ length: perRow }, (_, i) => (
            <th key={i}>{i}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }, (_, r) => (
          <tr key={r}>
            <td className="mono addr">{`${prefix(def)}${r * perRow}`}</td>
            {Array.from({ length: perRow }, (_, c) => {
              const e = r * perRow + c;
              if (e >= def.elements) return <td key={c} />;
              const addr = `${prefix(def)}${e}`;
              const v = data.read(addr);
              return (
                <td key={c} className="mono value" title={def.type === 'S' ? STATUS_LABELS[e] : undefined}>
                  <EditableValue
                    address={addr}
                    testId={`val-${addr}`}
                    text={float ? formatValue(v, true) : fmtWord(v, radix)}
                    parse={(s) => (float ? (Number.isFinite(Number(s)) ? Number(s) : null) : parseWord(s, radix))}
                  />
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StructTable({ def, data }: { def: DataFileDef; data: DataView }) {
  const bits = Object.keys(STRUCT_BITS[def.type] ?? {});
  const words = def.type === 'R' ? ['LEN', 'POS'] : ['PRE', 'ACC'];
  const project = useApp((s) => s.project)!;
  const used = useMemo(() => {
    const set = new Set<number>();
    for (const x of buildXref(project)) if (x.address.key === fileKeyOf(def)) set.add(x.address.element);
    return set;
  }, [project, def]);
  return (
    <table className="grid-table struct">
      <thead>
        <tr>
          <th>Address</th>
          {bits.map((b) => (
            <th key={b}>{b}</th>
          ))}
          {words.map((w) => (
            <th key={w}>{w}</th>
          ))}
          <th>Used</th>
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: def.elements }, (_, e) => {
          const base = `${def.type}${def.number}:${e}`;
          return (
            <tr key={e} className={used.has(e) ? '' : 'unused'}>
              <td className="mono addr">{base}</td>
              {bits.map((b) => {
                const v = data.read(`${base}/${b}`);
                return (
                  <td key={b} className={`bit ${v ? 'on' : ''}`} onClick={() => writeData(`${base}/${b}`, v ? 0 : 1)} data-testid={`bit-${base}/${b}`}>
                    {v ?? '?'}
                  </td>
                );
              })}
              {words.map((w) => (
                <td key={w} className="mono value">
                  <EditableValue address={`${base}.${w}`} testId={`val-${base}.${w}`} text={String(data.read(`${base}.${w}`) ?? '?')} parse={(s) => parseWord(s, 'dec')} />
                </td>
              ))}
              <td>{used.has(e) ? '✓' : ''}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ------------------------------------------------------------------ cross reference

export function XrefView() {
  const project = useApp((s) => s.project)!;
  const query = useApp((s) => s.xrefQuery);
  const entries = useMemo(() => buildXref(project), [project]);
  const result = query.trim() ? searchXref(project, query, entries) : null;
  const symbolOf = (a: string) => project.symbols.find((s) => normalizeAddress(s.address) === a)?.symbol;
  const summary = useMemo(() => {
    const m = new Map<string, { count: number; rungs: Set<number> }>();
    for (const e of entries) {
      const x = m.get(e.canonical) ?? { count: 0, rungs: new Set() };
      x.count++;
      x.rungs.add(e.rung);
      m.set(e.canonical, x);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  }, [entries]);
  return (
    <div className="xref" data-testid="xref">
      <div className="toolbar-row">
        <input
          className="mono"
          placeholder="Address or symbol, e.g. O:2/0, T4:0, START_PB"
          value={query}
          onChange={(e) => setUi({ xrefQuery: e.target.value })}
          data-testid="xref-input"
          style={{ width: 320 }}
        />
        {query && <button onClick={() => setUi({ xrefQuery: '' })}>Show all</button>}
        <span className="hint">Matches overlapping data too: searching T4:0 finds T4:0/DN and T4:0.ACC.</span>
      </div>
      {result && 'error' in result && <div className="field-msg err">{result.error}</div>}
      {result && !('error' in result) && (
        <table className="grid-table">
          <thead>
            <tr>
              <th>Address</th>
              <th>Symbol</th>
              <th>Rung</th>
              <th>Instruction</th>
              <th>Access</th>
            </tr>
          </thead>
          <tbody>
            {result.length === 0 && (
              <tr>
                <td colSpan={5}>Not used in the program.</td>
              </tr>
            )}
            {result.map((e, i) => (
              <tr key={i} className="clickable" onClick={() => showInLadder(e.rung, e.elementId)}>
                <td className="mono">{e.canonical}</td>
                <td>{symbolOf(e.canonical) ?? ''}</td>
                <td className="mono">{String(e.rung).padStart(4, '0')}</td>
                <td className="mono">{e.mnemonic}</td>
                <td>{e.access}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!result && (
        <table className="grid-table">
          <thead>
            <tr>
              <th>Address</th>
              <th>Symbol</th>
              <th>References</th>
              <th>Rungs</th>
            </tr>
          </thead>
          <tbody>
            {summary.map(([addr, x]) => (
              <tr key={addr} className="clickable" onClick={() => setUi({ xrefQuery: addr })}>
                <td className="mono">{addr}</td>
                <td>{symbolOf(addr) ?? ''}</td>
                <td>{x.count}</td>
                <td className="mono">{[...x.rungs].join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ verify

export function VerifyView() {
  const diags = useApp((s) => s.diagnostics);
  useSyncExternalStore(controller.subscribe, controller.getVersion);
  const pending = controller.pendingEditError;
  const sorted = [...diags].sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || (a.rung ?? -1) - (b.rung ?? -1));
  const errors = diags.filter((d) => d.severity === 'error').length;
  return (
    <div className="verify" data-testid="verify">
      <div className={`verify-summary ${errors ? 'err' : 'ok'}`}>
        {errors ? `${errors} error(s) — the program cannot be downloaded until they are fixed.` : 'No errors. The program can be run.'}{' '}
        {diags.length - errors > 0 && `${diags.length - errors} warning/info message(s).`}
      </div>
      {pending && <div className="field-msg err">Online edit pending: {pending}</div>}
      <table className="grid-table">
        <tbody>
          {sorted.map((d, i) => (
            <tr key={i} className={`clickable sev-${d.severity}`} onClick={() => d.rung !== null && showInLadder(d.rung, d.elementId)}>
              <td className="sev">{d.severity.toUpperCase()}</td>
              <td className="mono">{d.rung === null ? '—' : `Rung ${String(d.rung).padStart(4, '0')}`}</td>
              <td>{d.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function sevRank(s: string): number {
  return s === 'error' ? 0 : s === 'warning' ? 1 : 2;
}

// ------------------------------------------------------------------ symbols

export function SymbolsView() {
  const project = useApp((s) => s.project)!;
  const [addr, setAddr] = useState('');
  const [sym, setSym] = useState('');
  const [desc, setDesc] = useState('');
  let addrErr: string | null = null;
  if (addr) {
    try {
      resolveAddress(addr, project.dataFiles);
    } catch (e) {
      addrErr = (e as Error).message;
    }
  }
  const symErr = sym && !isValidSymbolName(sym) ? 'Invalid symbol name' : sym && project.symbols.some((s) => s.symbol.toUpperCase() === sym.toUpperCase()) ? 'Symbol already exists' : null;
  const update = (i: number, patch: Partial<{ symbol: string; description: string }>) =>
    edit((p) => ({ ...p, symbols: p.symbols.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  return (
    <div className="symbols">
      <div className="toolbar-row">
        <input className="mono" placeholder="Address" value={addr} onChange={(e) => setAddr(e.target.value)} style={{ width: 110 }} />
        <input className="mono" placeholder="SYMBOL" value={sym} onChange={(e) => setSym(e.target.value)} style={{ width: 150 }} />
        <input placeholder="Description" value={desc} onChange={(e) => setDesc(e.target.value)} style={{ width: 260 }} />
        <button
          disabled={!addr || !!addrErr || !!symErr || (!sym && !desc)}
          onClick={() => {
            const a = normalizeAddress(addr);
            edit((p) => ({ ...p, symbols: [...p.symbols.filter((s) => normalizeAddress(s.address) !== a), { address: a, symbol: sym, description: desc }] }));
            setAddr('');
            setSym('');
            setDesc('');
          }}
        >
          Add / replace
        </button>
        {(addrErr || symErr) && <span className="field-msg err">{addrErr ?? symErr}</span>}
      </div>
      <table className="grid-table">
        <thead>
          <tr>
            <th>Address</th>
            <th>Symbol</th>
            <th>Description</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {[...project.symbols.entries()]
            .sort((a, b) => a[1].address.localeCompare(b[1].address, undefined, { numeric: true }))
            .map(([i, s]) => (
              <tr key={`${s.address}-${i}`}>
                <td className="mono">{s.address}</td>
                <td>
                  <input className={`mono cell-input ${s.symbol && !isValidSymbolName(s.symbol) ? 'invalid' : ''}`} defaultValue={s.symbol} onBlur={(e) => e.target.value !== s.symbol && update(i, { symbol: e.target.value.trim() })} />
                </td>
                <td>
                  <input className="cell-input" defaultValue={s.description} onBlur={(e) => e.target.value !== s.description && update(i, { description: e.target.value })} />
                </td>
                <td>
                  <button className="danger" onClick={() => edit((p) => ({ ...p, symbols: p.symbols.filter((_, j) => j !== i) }))}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ help

export function HelpView() {
  const selected = useApp((s) => s.helpMnemonic) ?? 'XIC';
  const info = INSTRUCTIONS[selected];
  return (
    <div className="help-view" data-testid="help">
      <div className="help-list">
        {CATEGORY_ORDER.map((cat) => (
          <div key={cat}>
            <div className="help-cat">{cat}</div>
            {MNEMONICS.filter((m) => INSTRUCTIONS[m].category === cat).map((m) => (
              <button key={m} className={`help-item${m === selected ? ' active' : ''}`} onClick={() => setUi({ helpMnemonic: m as Mnemonic })}>
                <span className="mono">{m}</span> {INSTRUCTIONS[m].name}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="help-detail">
        <h3>
          <span className="mono">{info.mnemonic}</span> — {info.name}
        </h3>
        <p>
          <strong>{info.summary}</strong>
        </p>
        <p className="hint">
          {info.role === 'input' ? 'Input instruction: conditions the rung (placed on the left).' : 'Output instruction: acts on the rung condition (placed on the right).'}
        </p>
        <ul>
          {info.details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
        <p>
          Operands: {info.operands.map((o) => o.name).join(', ')}
          {info.dataFields ? `, plus ${info.dataFields.map((f) => f.name).join(' and ')} stored in the data table` : ''}
        </p>
        <p>
          Example: <code>{info.example}</code>
        </p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ messages

export function LogView() {
  const log = useApp((s) => s.log);
  return (
    <div className="log" data-testid="log">
      {log.length === 0 && <div className="hint">No messages.</div>}
      {[...log].reverse().map((l, i) => (
        <div key={i} className={`log-${l.level}`}>
          <span className="mono">{l.time}</span> {l.text}
        </div>
      ))}
    </div>
  );
}

export function wordsOf(def: DataFileDef): number {
  return def.elements * wordsPerElement(def.type);
}
