import { useMemo, useState } from 'react';
import { isNumericConstant, isValidSymbolName, normalizeAddress } from '../../core/address';
import { findElement } from '../../core/ast';
import { INSTRUCTIONS, TIME_BASES } from '../../core/instructions';
import { MNEMONICS } from '../../core/types';
import { checkOperand, symbolLookup } from '../../core/operands';
import { getDataValue } from '../../core/project';
import type { Instruction, Mnemonic } from '../../core/types';
import { changeMnemonic, edit, setUi, undo, updateOperands, useApp } from '../../store/store';
import { Dialog } from '../Dialog';

export function InstructionEditor() {
  const editing = useApp((s) => s.editing);
  const project = useApp((s) => s.project);
  if (!editing || !project) return null;
  const rung = project.program.rungs.find((r) => r.id === editing.rungId);
  const loc = rung ? findElement(rung.elements, editing.elementId) : null;
  if (!loc || loc.element.kind !== 'instr') return null;
  return <EditorBody key={`${loc.element.id}-${loc.element.mnemonic}`} ins={loc.element} rungId={editing.rungId} isNew={editing.isNew} />;
}

function EditorBody({ ins, rungId, isNew }: { ins: Instruction; rungId: string; isNew: boolean }) {
  const project = useApp((s) => s.project)!;
  const info = INSTRUCTIONS[ins.mnemonic];
  const lookup = useMemo(() => symbolLookup(project.symbols), [project.symbols]);
  const [ops, setOps] = useState<string[]>(() => ins.operands.map((o) => (o === '?' ? '' : o)));
  const [fields, setFields] = useState<string[]>(() =>
    (info.dataFields ?? []).map((f) => {
      try {
        return String(getDataValue(project, `${ins.operands[0]}.${f.member}`));
      } catch {
        return '0';
      }
    }),
  );
  const firstAddr = normalizeAddress(ops[0] ?? '');
  const existingSym = project.symbols.find((s) => normalizeAddress(s.address) === firstAddr);
  const [symName, setSymName] = useState(existingSym?.symbol ?? '');
  const [symDesc, setSymDesc] = useState(existingSym?.description ?? '');

  const checks = info.operands.map((spec, i) => checkOperand(spec.kind, ops[i] ?? '', project.dataFiles, lookup));
  const fieldErrors = fields.map((f) => (/^-?\d+$/.test(f.trim()) && Number(f) >= -32768 && Number(f) <= 32767 ? null : 'integer -32768..32767 required'));
  const firstIsAddress = checks[0]?.ok && checks[0].type === 'address';
  const symError = symName && !isValidSymbolName(symName) ? 'letters, digits, _ (max 20), must not look like an address' : symName && project.symbols.some((s) => s.symbol.toUpperCase() === symName.toUpperCase() && normalizeAddress(s.address) !== normalizeAddress(checks[0]?.ok && checks[0].type === 'address' ? checks[0].text : '')) ? 'symbol already used for another address' : null;

  const close = () => setUi({ editing: null });
  const cancel = () => {
    close();
    if (isNew && ins.operands.every((o) => o === '?' || o === '1.0')) undo();
  };

  const accept = () => {
    // Store symbol names as addresses (symbols are display names for addresses).
    const finalOps = info.operands.map((_spec, i) => {
      const c = checks[i];
      const raw = (ops[i] ?? '').trim();
      if (!raw) return '?';
      if (c.ok && c.type === 'address') return normalizeAddress(c.text);
      if (c.ok && c.type === 'timebase') return c.ms === 10 ? '0.01' : '1.0';
      if (c.ok && c.type === 'constant') return raw;
      return raw;
    });
    const writes = (info.dataFields ?? [])
      .map((f, i) => ({ address: `${finalOps[0]}.${f.member}`, value: Number(fields[i]) }))
      .filter((w, i) => fieldErrors[i] === null && finalOps[0] !== '?' && Number.isFinite(w.value));
    updateOperands(rungId, ins.id, finalOps, writes);
    if (firstIsAddress && !symError) {
      const addr = finalOps[0];
      const name = symName.trim();
      const desc = symDesc.trim();
      const cur = project.symbols.find((s) => normalizeAddress(s.address) === normalizeAddress(addr));
      if ((cur?.symbol ?? '') !== name || (cur?.description ?? '') !== desc) {
        edit((p) => {
          const others = p.symbols.filter((s) => normalizeAddress(s.address) !== normalizeAddress(addr));
          return { ...p, symbols: name || desc ? [...others, { address: addr, symbol: name, description: desc }] : others };
        });
      }
    }
    close();
  };

  const alternatives = MNEMONICS.filter((m) => INSTRUCTIONS[m].role === info.role);
  const symbolOptions = project.symbols.filter((s) => s.symbol);

  return (
    <Dialog
      title={`${ins.mnemonic} - ${info.name}`}
      onClose={cancel}
      testId="instruction-editor"
      footer={
        <>
          <span className="hint">Enter = OK, Esc = Cancel</span>
          <button onClick={cancel}>Cancel</button>
          <button className="primary" onClick={accept} data-testid="editor-ok">
            OK
          </button>
        </>
      }
    >
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          accept();
        }}
      >
        <label>Instruction</label>
        <select value={ins.mnemonic} onChange={(e) => changeMnemonic(rungId, ins.id, e.target.value as Mnemonic)}>
          {alternatives.map((m) => (
            <option key={m} value={m}>
              {m} - {INSTRUCTIONS[m].name}
            </option>
          ))}
        </select>
        {info.operands.map((spec, i) => (
          <OperandRow key={i}>
            <label htmlFor={`op-${i}`}>{spec.name}</label>
            <div>
              {spec.kind === 'timebase' ? (
                <select id={`op-${i}`} value={checks[i].ok && checks[i].type === 'timebase' && checks[i].ms === 10 ? '0.01' : '1.0'} onChange={(e) => setOps(ops.map((o, j) => (j === i ? e.target.value : o)))}>
                  {TIME_BASES.map((t) => (
                    <option key={t} value={t}>
                      {t} {t === '1.0' ? '(seconds)' : '(hundredths)'}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={`op-${i}`}
                  data-testid={`operand-${i}`}
                  className="mono"
                  autoFocus={i === 0}
                  list="symbol-list"
                  placeholder={placeholderFor(spec.kind)}
                  value={ops[i] ?? ''}
                  onChange={(e) => setOps(ops.map((o, j) => (j === i ? e.target.value : o)))}
                />
              )}
              <div className={`field-msg ${checks[i].ok ? 'ok' : 'err'}`}>
                {checks[i].ok ? describeOk(checks[i], ops[i] ?? '', lookup) : ops[i] ? checks[i].error : 'required'}
              </div>
            </div>
          </OperandRow>
        ))}
        {(info.dataFields ?? []).map((f, i) => (
          <OperandRow key={f.member}>
            <label htmlFor={`df-${i}`}>{f.name}</label>
            <div>
              <input id={`df-${i}`} data-testid={`field-${f.member}`} className="mono" value={fields[i]} onChange={(e) => setFields(fields.map((v, j) => (j === i ? e.target.value : v)))} />
              <div className={`field-msg ${fieldErrors[i] ? 'err' : 'ok'}`}>{fieldErrors[i] ?? `stored in ${ops[0] || '?'}.${f.member}`}</div>
            </div>
          </OperandRow>
        ))}
        {firstIsAddress && (
          <>
            <label htmlFor="sym-name">Symbol</label>
            <div>
              <input id="sym-name" className="mono" value={symName} onChange={(e) => setSymName(e.target.value)} placeholder="optional, e.g. START_PB" />
              {symError && <div className="field-msg err">{symError}</div>}
            </div>
            <label htmlFor="sym-desc">Description</label>
            <input id="sym-desc" value={symDesc} onChange={(e) => setSymDesc(e.target.value)} placeholder="optional address description" />
          </>
        )}
        <button type="submit" hidden />
      </form>
      <datalist id="symbol-list">
        {symbolOptions.map((s) => (
          <option key={s.symbol} value={s.symbol}>
            {s.address} {s.description}
          </option>
        ))}
      </datalist>
      <div className="help-box">
        <strong>{info.summary}</strong>
        <ul>
          {info.details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}

function OperandRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function placeholderFor(kind: string): string {
  switch (kind) {
    case 'bit':
      return 'e.g. I:1/0, B3:0/1, T4:0/DN or a symbol';
    case 'source':
      return 'e.g. N7:0, F8:1, T4:0.ACC or a constant';
    case 'dest':
      return 'e.g. N7:0, F8:0, T4:0.PRE';
    case 'timer':
      return 'e.g. T4:0';
    case 'counter':
      return 'e.g. C5:0';
    default:
      return 'e.g. T4:0, C5:0, R6:0';
  }
}

function describeOk(c: ReturnType<typeof checkOperand>, raw: string, lookup: (s: string) => string | undefined): string {
  if (!c.ok) return '';
  if (c.type === 'constant') return `constant ${c.value}`;
  if (c.type === 'timebase') return c.ms === 10 ? '0.01 s per count' : '1 s per count';
  const viaSym = lookup(raw.trim()) && !isNumericConstant(raw) ? ` (symbol ${raw.trim()})` : '';
  return `OK: ${normalizeAddress(c.text)}${viaSym}`;
}
