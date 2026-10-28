import { useEffect, useId, useRef, useState } from 'react';
import type { ColorBalance, ColorZone } from '@shared/adjustments';
import { beginGesture, endGesture, setAdjustments, shownAdjustments, useSession } from '../state/session';
import { ScrubSlider, Section, signed } from '../controls/controls';
import { tz, t } from '../i18n';

type Zone = keyof ColorBalance;
const fresh = (): ColorZone => ({ hue: 0, saturation: 0, luminance: 0 });
const label = (zone: Zone) => ({ master: tz('Master', '整体'), shadows: tz('Shadow', '阴影'), midtones: tz('Midtone', '中间调'), highlights: tz('Highlight', '高光') }[zone]);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const point = (angle: number, radius: number) => [radius * Math.cos(angle * Math.PI / 180), -radius * Math.sin(angle * Math.PI / 180)] as const;

export function ColorBalanceSection() {
  const balance = useSession((s) => shownAdjustments(s).colorBalance);
  const [tab, setTab] = useState<Zone | 'threeWay'>('master');
  const change = (zone: Zone, patch: Partial<ColorZone>, coalesce = false) => setAdjustments((a) => ({ ...a, colorBalance: { ...a.colorBalance, [zone]: { ...a.colorBalance[zone], ...patch } } }), { coalesce });
  return <Section id="colorbalance" title={t('sectionColorBalance')} onReset={() => setAdjustments((a) => ({ ...a,
    colorBalance: { master: fresh(), shadows: fresh(), midtones: fresh(), highlights: fresh() } }))} resetHelp={t('helpReset')}>
    <div className="balance-tabs" role="tablist" aria-label={t('sectionColorBalance')}>
      {(['master', 'threeWay', 'shadows', 'midtones', 'highlights'] as const).map((zone) => <button key={zone} role="tab" aria-selected={tab === zone}
        onClick={() => setTab(zone)}>{zone === 'threeWay' ? tz('3-Way', '三向') : label(zone)}</button>)}
    </div>
    {tab === 'threeWay' ? <div className="balance-three" data-testid="colorbalance-three-way">{(['midtones', 'shadows', 'highlights'] as const).map((zone) =>
      <ZoneWheel key={zone} name={label(zone)} zone={balance[zone]} onChange={(patch, coalesce) => change(zone, patch, coalesce)} />)}</div>
      : <><ZoneWheel name={label(tab)} zone={balance[tab]} onChange={(patch, coalesce) => change(tab, patch, coalesce)} />
        <ScrubSlider label={tz('Hue', '色相')} value={balance[tab].hue} range={[0, 360]} snap={15} format={(v) => `${v.toFixed(0)}°`} onChange={(hue) => change(tab, { hue })} />
        <ScrubSlider label={t('exposureSaturation')} value={balance[tab].saturation} range={[0, 1]} snap={.05} onChange={(saturation) => change(tab, { saturation })} />
        <ScrubSlider label={tz('Luminance', '亮度')} value={balance[tab].luminance} range={[-1, 1]} snap={.05} format={signed(2)} onChange={(luminance) => change(tab, { luminance })} /></>}
  </Section>;
}

function ZoneWheel({ name, zone, onChange }: { name: string; zone: ColorZone; onChange(patch: Partial<ColorZone>, coalesce?: boolean): void }) {
  const ref = useRef<SVGSVGElement>(null), drag = useRef<'disc' | 'saturation' | 'luminance' | null>(null);
  const lastDown = useRef({ time: -Infinity, x: 0, y: 0 });
  const id = useId();
  useEffect(() => () => { if (drag.current) endGesture(); }, []);
  const finish = () => { if (drag.current) { drag.current = null; endGesture(); } };
  const controlAt = (e: { clientX: number; clientY: number }) => {
    const rect = ref.current!.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * 128 - 64, y = 64 - (e.clientY - rect.top) / rect.height * 128;
    const radius = Math.hypot(x, y);
    return radius <= 40 ? 'disc' : radius <= 60 ? x < 0 ? 'saturation' : 'luminance' : null;
  };
  const move = (e: React.PointerEvent) => {
    const mode = drag.current; if (!mode || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * 128 - 64, y = 64 - (e.clientY - rect.top) / rect.height * 128;
    let angle = Math.atan2(y, x) * 180 / Math.PI;
    if (mode === 'disc') onChange({ hue: (angle + 360) % 360, saturation: clamp(Math.hypot(x, y) / 35, 0, 1) });
    else if (mode === 'saturation') {
      if (angle < 0) angle += 360;
      onChange({ saturation: clamp((245 - angle) / 130, 0, 1) });
    } else onChange({ luminance: clamp((angle + 65) / 130, 0, 1) * 2 - 1 });
  };
  const start = (e: React.PointerEvent, mode: NonNullable<typeof drag.current>) => {
    if (e.button !== 0) return;
    const previous = lastDown.current;
    lastDown.current = { time: e.timeStamp, x: e.clientX, y: e.clientY };
    if (e.timeStamp - previous.time < 500 && Math.hypot(e.clientX - previous.x, e.clientY - previous.y) < 6) return;
    e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); beginGesture(true); drag.current = mode; move(e);
  };
  const reset = (patch: Partial<ColorZone>, coalesce = false) => { if (!coalesce) beginGesture(); onChange(patch, coalesce); };
  const arc = (key: 'saturation' | 'luminance') => {
    const sat = key === 'saturation', lo = sat ? 0 : -1, value = zone[key], fraction = (value - lo) / (1 - lo);
    const bottom = sat ? 245 : -65, top = sat ? 115 : 65;
    const [x0, y0] = point(bottom, 51), [x1, y1] = point(top, 51), [tx, ty] = point(bottom + (top - bottom) * fraction, 51);
    const title = `${name} ${sat ? t('exposureSaturation') : tz('Luminance', '亮度')}`;
    return <g key={key} role="slider" tabIndex={0} aria-label={title} aria-valuemin={lo} aria-valuemax={1} aria-valuenow={value}
      onKeyDown={(e) => {
        const direction = ['ArrowUp', 'ArrowRight'].includes(e.key) ? 1 : ['ArrowDown', 'ArrowLeft'].includes(e.key) ? -1 : 0;
        if (!direction && e.key !== 'Home' && e.key !== 'End') return;
        e.preventDefault(); reset({ [key]: e.key === 'Home' ? lo : e.key === 'End' ? 1 : clamp(value + direction * (e.shiftKey ? .1 : .01), lo, 1) });
      }}>
      <title>{title}</title>
      <path d={`M${x0},${y0} A51,51 0 0 ${sat ? 1 : 0} ${x1},${y1}`} fill="none" stroke="var(--dim)" strokeWidth={2} />
      <path d={`M${x0},${y0} A51,51 0 0 ${sat ? 1 : 0} ${x1},${y1}`} fill="none" stroke="transparent" strokeWidth={14} />
      <circle cx={tx} cy={ty} r={3} fill={sat ? `hsl(${zone.hue} 70% 65%)` : 'var(--knob)'} stroke="var(--card)" strokeWidth={1} />
    </g>;
  };
  const [hx, hy] = point(zone.hue, zone.saturation * 35);
  return <div className="zone-wheel">
    <svg ref={ref} viewBox="-64 -64 128 128" role="group" aria-label={`${name} ${t('sectionColorBalance')}`}
      onPointerDown={(e) => { const control = controlAt(e); if (control) start(e, control); }}
      onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
      onDoubleClick={(e) => { const control = controlAt(e); if (control) reset(control === 'disc' ? fresh() : { [control]: 0 }, true); }}>
      <defs><radialGradient id={id}><stop stopColor="var(--card)" /><stop offset="1" stopColor="var(--card)" stopOpacity={0} /></radialGradient></defs>
      {arc('saturation')}{arc('luminance')}
      <g role="slider" tabIndex={0} aria-label={`${name} ${tz('Hue and saturation', '色相与饱和度')}`} aria-valuemin={0} aria-valuemax={360} aria-valuenow={zone.hue}
        aria-valuetext={`${zone.hue.toFixed(0)}°, ${(zone.saturation * 100).toFixed(0)}%`}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 15 : 1;
          if (['ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); reset({ hue: (zone.hue + (e.key === 'ArrowLeft' ? -step : step) + 360) % 360 }); }
          if (['ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); reset({ saturation: clamp(zone.saturation + (e.key === 'ArrowDown' ? -1 : 1) * (e.shiftKey ? .05 : .01), 0, 1) }); }
          if (e.key === 'Home') { e.preventDefault(); reset(fresh()); }
        }}>
        {Array.from({ length: 36 }, (_, index) => {
          const [x0, y0] = point(index * 10, 40), [x1, y1] = point((index + 1) * 10, 40);
          return <path key={index} d={`M0,0 L${x0},${y0} A40,40 0 0 0 ${x1},${y1} Z`} fill={`hsl(${index * 10 + 5} 55% 50%)`} />;
        })}
        <circle r={40} fill={`url(#${id})`} stroke="var(--dim)" strokeWidth={.5} />
        <circle cx={hx} cy={hy} r={3.5} fill="var(--knob)" stroke="var(--card)" strokeWidth={1} />
      </g>
    </svg>
    <span className="caption">{name}</span>
  </div>;
}
