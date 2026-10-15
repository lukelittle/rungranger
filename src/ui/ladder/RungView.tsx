import { memo, type ReactNode } from 'react';
import { INSTRUCTIONS } from '../../core/instructions';
import type { Branch, Element, Instruction, Rung } from '../../core/types';
import type { Selection } from '../../store/store';
import { formatValue, type DataView } from '../dataView';
import {
  BOX_HEADER, BOX_LINE, BOX_TOP, BOX_W, BR_PAD, WIRE_Y,
  boxHeight, elementSize, hasStatusBits, seriesSize, splitRung,
} from './layout';

export const GUTTER = 58;
const PAD_TOP = 6;

export interface LiveTrace {
  index: Map<string, number>;
  pout: Uint8Array;
  state: Uint8Array;
  /** True when power flow should be drawn (controller is scanning or paused after a scan). */
  powered: boolean;
}

interface Props {
  rung: Rung;
  number: number;
  width: number;
  data: DataView;
  trace: LiveTrace | null;
  showPowerFlow: boolean;
  selection: Selection;
  symbolOf: (address: string) => string | undefined;
  describe: (address: string) => string | undefined;
  errorIds: Set<string>;
  rungHasError: boolean;
  onSelect: (sel: Selection) => void;
  onEdit: (elementId: string) => void;
  onEditComment: () => void;
}

interface Ctx extends Props {
  out: ReactNode[];
}

export function rungContentWidth(rung: Rung): number {
  const { inputs, outputs } = splitRung(rung.elements);
  return seriesSize(inputs).w + seriesSize(outputs).w + 60;
}

function RungViewImpl(props: Props) {
  const { rung, number, width, trace, selection } = props;
  const { inputs, outputs } = splitRung(rung.elements);
  const inSize = seriesSize(inputs);
  const outSize = outputs.length ? seriesSize(outputs) : { w: 0, h: 0 };
  const railL = GUTTER;
  const railR = Math.max(width - 12, railL + inSize.w + outSize.w + 60);
  const height = Math.max(inSize.h, outSize.h, 60) + PAD_TOP + 4;
  const ctx: Ctx = { ...props, out: [] };
  const live = !!trace && trace.powered;

  const wy = PAD_TOP + WIRE_Y;
  const x0 = railL + 14;
  const outX = railR - 14 - outSize.w;
  const p0 = live ? true : null;
  const pAfterInputs = drawSeries(ctx, inputs, x0, PAD_TOP, p0, inSize.w);
  const pAfterOutputs = outputs.length ? drawSeries(ctx, outputs, outX, PAD_TOP, pAfterInputs, outSize.w) : pAfterInputs;

  const rungSelected = selection.kind === 'rung' && selection.rungId === rung.id;
  const hasComment = rung.comment.trim().length > 0;

  return (
    <div className={`rung${rungSelected ? ' rung-selected' : ''}`} id={`rung-${rung.id}`} data-testid={`rung-${number}`}>
      {hasComment && (
        <div className="rung-comment" style={{ marginLeft: railL }} onDoubleClick={props.onEditComment} title="Double-click to edit the rung comment">
          {rung.comment}
        </div>
      )}
      <svg width={railR + 8} height={height} className="rung-svg" role="img" aria-label={`Rung ${number}`}>
        <rect
          x={0}
          y={0}
          width={railL - 4}
          height={height}
          className={`rung-gutter${rungSelected ? ' selected' : ''}${props.rungHasError ? ' error' : ''}`}
          onClick={() => props.onSelect({ kind: 'rung', rungId: rung.id })}
          onDoubleClick={props.onEditComment}
        />
        <text x={8} y={wy + 4} className={`rung-number${props.rungHasError ? ' error' : ''}`} onClick={() => props.onSelect({ kind: 'rung', rungId: rung.id })}>
          {String(number).padStart(4, '0')}
        </text>
        {props.rungHasError && (
          <text x={12} y={wy + 20} className="rung-error-mark">
            E
          </text>
        )}
        <line x1={railL} y1={0} x2={railL} y2={height} className={`rail${live ? ' powered' : ''}`} />
        <line x1={railR} y1={0} x2={railR} y2={height} className="rail" />
        <Wire x1={railL} x2={x0} y={wy} p={p0} />
        {inputs.length === 0 && outputs.length === 0 ? (
          <>
            <Wire x1={x0} x2={railR} y={wy} p={null} />
            <rect x={x0} y={PAD_TOP + 8} width={railR - x0 - 10} height={60} className="hit" onClick={() => props.onSelect({ kind: 'rung', rungId: rung.id })} />
            <text x={x0 + 20} y={wy - 10} className="empty-hint">
              Empty rung: select it and pick an instruction from the toolbar (or press Insert to type one)
            </text>
          </>
        ) : (
          <>
            <Wire x1={x0 + inSize.w} x2={outputs.length ? outX : railR} y={wy} p={pAfterInputs} />
            {outputs.length > 0 && <Wire x1={outX + outSize.w} x2={railR} y={wy} p={pAfterOutputs} />}
          </>
        )}
        {ctx.out}
      </svg>
    </div>
  );
}

export const RungView = memo(RungViewImpl);

function Wire({ x1, x2, y, p }: { x1: number; x2: number; y: number; p: boolean | null }) {
  if (x2 <= x1) return null;
  return <line x1={x1} y1={y} x2={x2} y2={y} className={`wire${p ? ' powered' : ''}`} />;
}

/** Draws a series starting at x; returns power out (null when not live). */
function drawSeries(ctx: Ctx, series: Element[], x: number, y: number, pin: boolean | null, width: number): boolean | null {
  let cx = x;
  let p = pin;
  for (const el of series) {
    const s = elementSize(el);
    p = el.kind === 'instr' ? drawInstr(ctx, el, cx, y, p) : drawBranch(ctx, el, cx, y, p);
    cx += s.w;
  }
  if (cx < x + width) ctx.out.push(<Wire key={`ext-${series[0]?.id ?? 'e'}-${x}-${y}`} x1={cx} x2={x + width} y={y + WIRE_Y} p={p} />);
  return p;
}

function drawBranch(ctx: Ctx, br: Branch, x: number, y: number, pin: boolean | null): boolean | null {
  const size = elementSize(br);
  const selected = ctx.selection.kind === 'element' && ctx.selection.elementId === br.id;
  const innerW = size.w - BR_PAD * 2;
  let ly = y;
  let pout: boolean | null = pin === null ? null : false;
  const legYs: number[] = [];
  br.legs.forEach((leg, i) => {
    const ls = seriesSize(leg);
    legYs.push(ly + WIRE_Y);
    const legSelected = ctx.selection.kind === 'leg' && ctx.selection.branchId === br.id && ctx.selection.leg === i;
    // Hit area for selecting the leg (insertion point)
    ctx.out.push(
      <rect
        key={`leghit-${br.id}-${i}`}
        x={x + BR_PAD - 4}
        y={ly + WIRE_Y - 14}
        width={leg.length === 0 ? innerW + 8 : 10}
        height={28}
        className={`hit leg-hit${legSelected ? ' selected' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          ctx.onSelect({ kind: 'leg', rungId: ctx.rung.id, branchId: br.id, leg: i });
        }}
      >
        <title>Branch leg {i + 1}: click to select, then insert instructions here</title>
      </rect>,
    );
    ctx.out.push(<Wire key={`legin-${br.id}-${i}`} x1={x + 4} x2={x + BR_PAD} y={ly + WIRE_Y} p={pin} />);
    const lp = drawSeries(ctx, leg, x + BR_PAD, ly, pin, innerW);
    ctx.out.push(<Wire key={`legout-${br.id}-${i}`} x1={x + BR_PAD + innerW} x2={x + size.w - 4} y={ly + WIRE_Y} p={lp} />);
    if (legSelected) {
      ctx.out.push(<rect key={`legsel-${br.id}-${i}`} x={x + BR_PAD - 3} y={ly + WIRE_Y - 12} width={innerW + 6} height={24} className="leg-selected" />);
    }
    if (pout !== null && lp) pout = true;
    ly += ls.h;
  });
  const top = legYs[0];
  const bottom = legYs[legYs.length - 1];
  ctx.out.push(
    <g key={`br-${br.id}`} className={`branch${selected ? ' selected' : ''}`}>
      <line x1={x} y1={top} x2={x + 4} y2={top} className={`wire${pin ? ' powered' : ''}`} />
      <line x1={x + 4} y1={top} x2={x + 4} y2={bottom} className={`wire branch-rail${pin ? ' powered' : ''}`} />
      <line x1={x + size.w - 4} y1={top} x2={x + size.w - 4} y2={bottom} className={`wire branch-rail${pout ? ' powered' : ''}`} />
      <line x1={x + size.w - 4} y1={top} x2={x + size.w} y2={top} className={`wire${pout ? ' powered' : ''}`} />
      <rect
        x={x - 2}
        y={top - 6}
        width={10}
        height={bottom - top + 12}
        className="hit"
        onClick={(e) => {
          e.stopPropagation();
          ctx.onSelect({ kind: 'element', rungId: ctx.rung.id, elementId: br.id });
        }}
      >
        <title>Branch: click to select</title>
      </rect>
      <rect
        x={x + size.w - 8}
        y={top - 6}
        width={10}
        height={bottom - top + 12}
        className="hit"
        onClick={(e) => {
          e.stopPropagation();
          ctx.onSelect({ kind: 'element', rungId: ctx.rung.id, elementId: br.id });
        }}
      />
      {selected && <rect x={x} y={top - 8} width={size.w} height={bottom - top + 16} className="sel-box" />}
    </g>,
  );
  return pout;
}

function drawInstr(ctx: Ctx, ins: Instruction, x: number, y: number, pin: boolean | null): boolean | null {
  const info = INSTRUCTIONS[ins.mnemonic];
  const size = elementSize(ins);
  const idx = ctx.trace?.index.get(ins.id);
  const live = ctx.trace !== null && idx !== undefined;
  const state = live ? ctx.trace!.state[idx!] === 1 : null;
  const pout: boolean | null = pin === null || !live || !ctx.trace!.powered ? null : ctx.trace!.pout[idx!] === 1;
  const selected = ctx.selection.kind === 'element' && ctx.selection.elementId === ins.id;
  const hasError = ctx.errorIds.has(ins.id);
  const wy = y + WIRE_Y;
  const pinShow = ctx.showPowerFlow ? pin : null;
  const poutShow = ctx.showPowerFlow ? pout : null;
  const op0 = ins.operands[0] ?? '?';
  const sym = ctx.symbolOf(op0);
  const desc = ctx.describe(op0);
  const tooltip = `${ins.mnemonic} - ${info.name}\n${info.summary}${sym ? `\n${op0} = ${sym}` : ''}${desc ? `\n${desc}` : ''}\nDouble-click to edit operands.`;

  let body: ReactNode;
  if (!info.box) {
    const cx = x + size.w / 2;
    const isCoil = info.role === 'output';
    // Bit value for monitoring: contacts and coils show the addressed bit
    const bit = ctx.data.read(op0);
    const truthy = state ?? (ctx.data.live ? (ins.mnemonic === 'XIO' ? bit === 0 : bit === 1) : false);
    body = (
      <>
        <Wire x1={x} x2={cx - (isCoil ? 12 : 9)} y={wy} p={pinShow} />
        <Wire x1={cx + (isCoil ? 12 : 9)} x2={x + size.w} y={wy} p={isCoil ? pinShow : poutShow} />
        {truthy && ctx.data.live && <rect x={cx - 13} y={wy - 15} width={26} height={30} className="true-fill" />}
        {isCoil ? (
          <>
            <path d={`M ${cx - 7} ${wy - 13} Q ${cx - 16} ${wy} ${cx - 7} ${wy + 13}`} className="sym" />
            <path d={`M ${cx + 7} ${wy - 13} Q ${cx + 16} ${wy} ${cx + 7} ${wy + 13}`} className="sym" />
            {ins.mnemonic !== 'OTE' && (
              <text x={cx} y={wy + 4} className={`coil-letter${ins.mnemonic === 'RES' ? ' small' : ''}`}>
                {ins.mnemonic === 'OTL' ? 'L' : ins.mnemonic === 'OTU' ? 'U' : 'RES'}
              </text>
            )}
          </>
        ) : (
          <>
            <line x1={cx - 9} y1={wy - 13} x2={cx - 9} y2={wy + 13} className="sym" />
            <line x1={cx + 9} y1={wy - 13} x2={cx + 9} y2={wy + 13} className="sym" />
            {ins.mnemonic === 'XIO' && <line x1={cx - 7} y1={wy + 11} x2={cx + 7} y2={wy - 11} className="sym" />}
          </>
        )}
        {sym && (
          <text x={cx} y={y + 11} className="symbol-text">
            {truncate(sym, 13)}
          </text>
        )}
        <text x={cx} y={y + 25} className={`addr-text${hasError ? ' error' : ''}`}>
          {truncate(op0 || '?', 13)}
        </text>
        <text x={cx + 18} y={wy + 26} className="mnemonic-small">
          {ins.mnemonic}
        </text>
      </>
    );
  } else {
    const bx = x + 8;
    const by = y + BOX_TOP;
    const statusW = hasStatusBits(ins) && info.role === 'output' ? 40 : 0;
    const bw = BOX_W - 16;
    const bh = boxHeight(ins);
    const lines: [string, string, string | null, boolean][] = []; // label, text, live value, isAddress
    info.operands.forEach((spec, i) => {
      const t = ins.operands[i] ?? '?';
      let value: string | null = null;
      if (spec.kind === 'source' || spec.kind === 'dest') {
        const v = /^[-+]?[\d.]/.test(t) ? null : ctx.data.read(t);
        if (v !== null) value = formatValue(v, /^F\d+:/i.test(t));
      }
      lines.push([shortLabel(spec.name), ctx.symbolOf(t) ?? t, value, spec.kind !== 'timebase']);
    });
    for (const f of info.dataFields ?? []) {
      const v = ctx.data.read(`${op0}.${f.member}`);
      lines.push([f.name, formatValue(v), null, false]);
    }
    const bits: [string, number | null][] =
      ins.mnemonic === 'CTU' ? [['CU', ctx.data.read(`${op0}/CU`)], ['DN', ctx.data.read(`${op0}/DN`)]]
        : ins.mnemonic === 'CTD' ? [['CD', ctx.data.read(`${op0}/CD`)], ['DN', ctx.data.read(`${op0}/DN`)]]
          : hasStatusBits(ins) ? [['EN', ctx.data.read(`${op0}/EN`)], ['DN', ctx.data.read(`${op0}/DN`)]] : [];
    const compare = info.role === 'input';
    body = (
      <>
        <Wire x1={x} x2={bx} y={wy} p={pinShow} />
        <Wire x1={bx + bw} x2={x + size.w} y={wy} p={compare ? poutShow : pinShow} />
        <rect x={bx} y={by} width={bw} height={bh} className={`box${state && ctx.data.live ? ' box-true' : ''}${hasError ? ' error' : ''}`} />
        <rect x={bx} y={by} width={bw} height={BOX_HEADER} className="box-header" />
        <text x={bx + 6} y={by + 14} className="box-title">
          {ins.mnemonic}
        </text>
        <text x={bx + bw - 6} y={by + 14} className="box-name">
          {truncate(info.name, 18)}
        </text>
        {lines.map(([label, text, value], i) => (
          <g key={i}>
            <text x={bx + 6} y={by + BOX_HEADER + 12 + i * BOX_LINE} className="box-label">
              {label}
            </text>
            <text x={bx + 64} y={by + BOX_HEADER + 12 + i * BOX_LINE} className="box-value">
              {truncate(text, value ? 11 : 15)}
            </text>
            {value !== null && (
              <text x={bx + bw - 6} y={by + BOX_HEADER + 12 + i * BOX_LINE} className="box-live">
                {truncate(value, 8)}
              </text>
            )}
          </g>
        ))}
        {statusW > 0 &&
          bits.map(([name, v], i) => (
            <g key={name}>
              {i > 0 && <line x1={bx + bw} y1={wy + i * 20} x2={bx + bw + 8} y2={wy + i * 20} className="wire" />}
              <rect x={bx + bw + 8} y={wy - 8 + i * 20} width={24} height={16} rx={7} className={`status-bit${v ? ' on' : ''}`} />
              <text x={bx + bw + 20} y={wy + 4 + i * 20} className="status-bit-text">
                {name}
              </text>
            </g>
          ))}
      </>
    );
  }

  ctx.out.push(
    <g
      key={ins.id}
      className={`instr${selected ? ' selected' : ''}`}
      data-testid={`instr-${ins.mnemonic}-${op0}`}
      onClick={(e) => {
        e.stopPropagation();
        ctx.onSelect({ kind: 'element', rungId: ctx.rung.id, elementId: ins.id });
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        ctx.onEdit(ins.id);
      }}
    >
      <title>{tooltip}</title>
      <rect x={x + 1} y={y + 1} width={size.w - 2} height={Math.max(size.h, 60) - 4} className="hit" />
      {body}
      {selected && <rect x={x + 2} y={y + 1} width={size.w - 4} height={size.h - 6} className="sel-box" />}
    </g>,
  );
  return info.role === 'output' ? pin : pout;
}

function shortLabel(name: string): string {
  return { 'Source A': 'Src A', 'Source B': 'Src B', 'Time Base': 'Base' }[name] ?? name;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
