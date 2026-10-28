// CurveEditor.tsx — `Controls/CurveEditor.swift`: click to add a point, drag
// to move it, right-click (or drag off the plot) to remove it; double-click
// resets the channel, matching the Mac. The output
// histogram sits behind the curve.

import { useEffect, useRef, useState } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { type CurveChannel, evaluateCurve, insertPoint, movePoint, removePoint } from '@shared/adjustments';
import { beginGesture, endGesture, setAdjustments, shownAdjustments, useSession } from '../state/session';
import { useOutput } from '../canvas/output';
import { computeHistogram } from '../canvas/histogram';
import { t, tz } from '../i18n';

const S = 200;
const STROKE: Record<CurveChannel, string> = {
  rgb: 'var(--text)',
  luma: 'var(--hist-y)',
  red: 'var(--hist-r)',
  green: 'var(--hist-g)',
  blue: 'var(--hist-b)',
};

export function CurveEditor({ channel }: { channel: CurveChannel }) {
  const curve = useSession((s) => shownAdjustments(s).curves[channel]);
  const out = useOutput();
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const lastDown = useRef({ time: -Infinity, x: 0, y: 0 });
  const [readout, setReadout] = useState<string>('');
  const [contextPoint, setContextPoint] = useState(-1);
  const finish = () => { if (drag.current !== null) { drag.current = null; endGesture(); } };
  useEffect(() => () => { if (drag.current !== null) endGesture(); }, []);

  const at = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: 1 - (e.clientY - r.top) / r.height };
  };
  const set = (fn: (c: typeof curve) => typeof curve, coalesce = false) => setAdjustments((a) => ({ ...a, curves: { ...a.curves, [channel]: fn(a.curves[channel]) } }), { coalesce });

  const near = (p: { x: number; y: number }) => {
    let best = -1;
    let bd = 10 / S;
    curve.points.forEach(([x, y], i) => {
      const d = Math.hypot(x - p.x, y - p.y);
      if (d <= bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  };

  let hist = '';
  if (out) {
    const h = computeHistogram(out.data);
    const bins = channel === 'red' ? h.r : channel === 'green' ? h.g : channel === 'blue' ? h.b : h.y;
    const peak = Math.max(1, ...Array.from(bins).sort((a, b) => a - b).slice(-3, -2));
    hist = `M0 ${S}` + Array.from(bins, (v, i) => ` L${(i / 255) * S} ${S - (Math.min(v, peak) / peak) * S * 0.9}`).join('') + ` L${S} ${S} Z`;
  }
  const line = Array.from({ length: 101 }, (_, i) => {
    const x = i / 100;
    return `${i ? 'L' : 'M'}${x * S} ${S - evaluateCurve(curve, x) * S}`;
  }).join(' ');

  return (
    <div>
      <ContextMenu.Root><ContextMenu.Trigger asChild><svg
        ref={ref}
        className="plot"
        viewBox={`0 0 ${S} ${S}`}
        style={{ aspectRatio: '1', cursor: 'crosshair', touchAction: 'none' }}
        data-testid="curve-editor"
        aria-label={`${channel} ${t('sectionCurve')}`}
        onContextMenu={(e) => setContextPoint(near(at(e as unknown as React.PointerEvent)))}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const previous = lastDown.current;
          lastDown.current = { time: e.timeStamp, x: e.clientX, y: e.clientY };
          if (e.timeStamp - previous.time < 500 && Math.hypot(e.clientX - previous.x, e.clientY - previous.y) < 6) return;
          (e.target as Element).setPointerCapture(e.pointerId);
          const p = at(e);
          beginGesture(true);
          let i = near(p);
          if (i < 0) {
            const r = insertPoint(curve, p.x, p.y);
            set(() => r.curve);
            i = r.index;
          }
          drag.current = i;
        }}
        onPointerMove={(e) => {
          const p = at(e);
          setReadout(`${t('curveInput')}: ${Math.round(Math.min(Math.max(p.x, 0), 1) * 255)}  ${t('curveOutput')}: ${Math.round(evaluateCurve(curve, Math.min(Math.max(p.x, 0), 1)) * 255)}`);
          const i = drag.current;
          if (i == null) return;
          set((c) => movePoint(c, i, p.x, p.y));
        }}
        onPointerUp={(e) => {
          const p = at(e);
          const i = drag.current;
          drag.current = null;
          // Dragged well off the plot: the point goes.
          if (i != null && (p.y < -0.1 || p.y > 1.1)) set((c) => removePoint(c, i));
          endGesture();
        }}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
        onDoubleClick={() => set(() => ({ points: [[0, 0], [1, 1]] }), true)}
      >
        {[0.25, 0.5, 0.75].map((g) => (
          <g key={g} stroke="var(--plot-grid)" strokeWidth={0.5}>
            <line x1={g * S} y1={0} x2={g * S} y2={S} />
            <line x1={0} y1={g * S} x2={S} y2={g * S} />
          </g>
        ))}
        {hist && <path d={hist} fill={STROKE[channel]} fillOpacity={0.15} />}
        <line x1={0} y1={S} x2={S} y2={0} stroke="var(--plot-mid-grey)" strokeWidth={0.5} />
        <path d={line} fill="none" stroke={STROKE[channel]} strokeWidth={1.4} />
        {curve.points.map(([x, y], i) => (
          <circle key={i} cx={x * S} cy={S - y * S} r={3.5} fill="var(--card)" stroke={STROKE[channel]} strokeWidth={1.2}
            role="button" tabIndex={0} aria-label={`${tz('Curve point', '曲线控制点')} ${i + 1}: ${Math.round(x * 255)}, ${Math.round(y * 255)}`}
            onKeyDown={(e) => {
              if (['Delete', 'Backspace'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); beginGesture(); set((c) => removePoint(c, i)); }
              if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
                e.preventDefault(); e.stopPropagation(); beginGesture(); const step = e.shiftKey ? .05 : 1 / 255;
                set((c) => movePoint(c, i, x + (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0), y + (e.key === 'ArrowDown' ? -step : e.key === 'ArrowUp' ? step : 0)));
              }
            }} />
        ))}
      </svg></ContextMenu.Trigger><ContextMenu.Portal><ContextMenu.Content className="menu" alignOffset={5}>
        <ContextMenu.Item className="menu-item" disabled={contextPoint <= 0 || contextPoint >= curve.points.length - 1}
          onSelect={() => { beginGesture(); set((c) => removePoint(c, contextPoint)); }}>{tz('Delete control point', '删除控制点')}</ContextMenu.Item>
        <ContextMenu.Item className="menu-item" onSelect={() => { beginGesture(); set(() => ({ points: [[0, 0], [1, 1]] })); }}>{tz('Reset channel', '重置当前通道')}</ContextMenu.Item>
      </ContextMenu.Content></ContextMenu.Portal></ContextMenu.Root>
      <div className="caption num">{readout || ' '}</div>
    </div>
  );
}
