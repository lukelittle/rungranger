import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { normalizeAddress } from '../../core/address';
import { controller } from '../../store/controller';
import { select, setUi, useApp, type Selection } from '../../store/store';
import { makeDataView } from '../dataView';
import { GUTTER, RungView, rungContentWidth, type LiveTrace } from './RungView';

export function LadderView() {
  const project = useApp((s) => s.project);
  const selection = useApp((s) => s.selection);
  const diagnostics = useApp((s) => s.diagnostics);
  const showPowerFlow = useApp((s) => s.showPowerFlow);
  useSyncExternalStore(controller.subscribe, controller.getVersion);
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth - 4));
    ro.observe(el);
    setWidth(el.clientWidth - 4);
    return () => ro.disconnect();
  }, []);

  const symbols = project?.symbols;
  const { symbolOf, describe } = useMemo(() => {
    const bySym = new Map<string, { symbol: string; description: string }>();
    for (const s of symbols ?? []) bySym.set(normalizeAddress(s.address), s);
    return {
      symbolOf: (a: string) => bySym.get(normalizeAddress(a))?.symbol || undefined,
      describe: (a: string) => bySym.get(normalizeAddress(a))?.description || undefined,
    };
  }, [symbols]);

  const { errorIds, errorRungs } = useMemo(() => {
    const ids = new Set<string>();
    const rungs = new Set<number>();
    for (const d of diagnostics) {
      if (d.severity !== 'error') continue;
      if (d.elementId) ids.add(d.elementId);
      if (d.rung !== null) rungs.add(d.rung);
    }
    return { errorIds: ids, errorRungs: rungs };
  }, [diagnostics]);

  if (!project) return null;
  const engine = controller.engine;
  const data = makeDataView(project, engine);
  const prog = engine?.program;
  const trace: LiveTrace | null =
    engine && prog
      ? { index: prog.index, pout: prog.trace.pout, state: prog.trace.state, powered: engine.scanCount > 0 && (engine.mode === 'RUN' || engine.mode === 'TEST') }
      : null;
  const rungs = project.program.rungs;
  const contentW = Math.max(width, ...rungs.map(rungContentWidth).map((w) => w + GUTTER + 20));

  const onSelect = (sel: Selection) => select(sel);

  return (
    <div className="ladder-scroll" ref={ref} data-testid="ladder">
      <div className="ladder" style={{ width: contentW }}>
        {rungs.map((r, i) => (
          <RungView
            key={r.id}
            rung={r}
            number={i}
            width={contentW}
            data={data}
            trace={trace}
            showPowerFlow={showPowerFlow}
            selection={selection}
            symbolOf={symbolOf}
            describe={describe}
            errorIds={errorIds}
            rungHasError={errorRungs.has(i)}
            onSelect={onSelect}
            onEdit={(elementId) => setUi({ editing: { rungId: r.id, elementId, isNew: false } })}
            onEditComment={() => setUi({ commentEditing: r.id })}
          />
        ))}
        <div className="rung end-rung">
          <svg width={contentW} height={34}>
            <text x={8} y={22} className="rung-number">
              {String(rungs.length).padStart(4, '0')}
            </text>
            <line x1={GUTTER} y1={0} x2={GUTTER} y2={34} className="rail" />
            <line x1={contentW - 12} y1={0} x2={contentW - 12} y2={34} className="rail" />
            <line x1={GUTTER} y1={18} x2={contentW - 12} y2={18} className="wire" />
            <rect x={contentW / 2 - 30} y={9} width={60} height={18} className="end-box" />
            <text x={contentW / 2} y={22} className="end-text">
              END
            </text>
          </svg>
        </div>
      </div>
    </div>
  );
}
