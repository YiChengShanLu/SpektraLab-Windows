// RightRail.tsx — "Parameters" (`Panels/RightPanel.swift`):
//   Pre-Dev:  Latitude · Input / Camera · Film Format · Scene Placement
//   Post-Dev: White Balance · Exposure · Curve · Color Balance (Layer 2)

import { useId, useState } from 'react';
import { Checkbox, NumberField, PillMenu, ScrubSlider, Section, SegmentedSwitch, ToggleRow, signed } from '../controls/controls';
import { isChinese, t, tz } from '../i18n';
import { cameraParams, pairFocus, setCamera, shownAdjustments, shownDecode as selectedDecode, updatePair, canPickNeutral, currentPlacementWindow, hostRedecodes, placeScene, placementReady, resetScenePlacement, setAdjustments, setDecode, setFilmFrame, setFilmSide, setParams, setSideLengthMM, startNeutralPick, useSession } from '../state/session';
import { settingsStore, useSettings } from '../state/settings';
import {
  type AEMethod,
  EFFECTS_DEFAULT,
  EFFECT_RANGES,
  FILM_FRAMES,
  FILM_FRAME_CUSTOM,
  SIDE_UNIT_DECIMALS,
  SIDE_UNIT_PER_MM,
  type SideUnit,
  aeMethodOf,
  applyAEMethod,
} from '@shared/params';
import { type CurveChannel, CURVE_CHANNELS, isNeutral } from '@shared/adjustments';
import {
  type AsShot,
  TEMPERATURE_RANGE,
  TINT_RANGE,
  WB_MODES,
  applyBoxes,
  boxesOf,
  isRawPath,
  modeOf,
  shownDecode,
  withPreset,
  withTemperature,
  withTint,
} from '@shared/whiteBalance';
import { CurveEditor } from './CurveEditor';
import { ColorBalanceSection } from './ColorBalanceEditor';
import { unsupportedReason } from './gate';
import { type LatitudeReply, type PlacementSide, latitudeReadout, placementMessage } from '@shared/latitude';

export function RightRail() {
  const tab = useSettings((s) => s.parametersTab);
  const edited = useSession((s) => shownAdjustments(s).enabled && !isNeutral(shownAdjustments(s)));
  return (
    <aside className="rail right" data-testid="right-rail">
      <div className="rail-header">{t('railParameters')}</div>
      <SegmentedSwitch
        value={tab}
        onChange={(v) => settingsStore.getState().set('parametersTab', v)}
        options={[
          { value: 'preDev', label: t('tabPreDev') },
          { value: 'postDev', label: t('tabPostDev'), marked: edited, markHelp: tz('The grade is not neutral.', '调色不是中性的。') },
        ]}
      />
      <div className="hairline" />
      <div className="rail-scroll">
        {tab === 'preDev' ? (
          <>
            <LatitudeSection />
            <CameraSection />
            <FilmFormatSection />
            <ScenePlacementSection />
          </>
        ) : (
          <>
            <WhiteBalanceSection />
            <ExposureSection />
            <CurveSection />
            <ColorBalanceSection />
          </>
        )}
      </div>
    </aside>
  );
}

// ------------------------------------------------------------------ Latitude

function LatitudeSection() {
  const film = useSession((s) => s.sidecar.params.filmStock);
  const paper = useSession((s) => s.sidecar.params.printStock);
  const catalog = useSession((s) => s.catalog);
  const { reply, failure } = useSession((s) => s.latitude);
  const name = (id: string) => catalog.stock(id)?.name.replace(/^(Kodak|Fujifilm) (Professional )?/, '') ?? id;
  return (
    <Section id="latitude" title={t('sectionLatitude')} trailing={`${name(film)} · ${name(paper)}`} unsupported={failure}>
      <LatitudePlot reply={reply} />
    </Section>
  );
}

function LatitudePlot({ reply }: { reply: LatitudeReply | null }) {
  const W = 240, H = 60, id = useId();
  if (!reply) return <svg className="plot" viewBox={`0 0 ${W} 92`} height={92} />;
  const h = reply.scene.histogram;
  const readout = latitudeReadout(reply), f = readout.fractions;
  const peak = Math.max(...f, 1e-9);
  const x = (ev: number) => (ev + 8) / 16 * W;
  const pct = (v: number) => ((v / (readout.total || 1)) * 100).toFixed(1) + ' %';
  const evText = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}`;
  const under = f.reduce((sum, v, i) => sum + (readout.centres[i]! < -8 ? v : 0), 0);
  const over = f.reduce((sum, v, i) => sum + (readout.centres[i]! > 8 ? v : 0), 0);
  return (
    <>
      <svg className="plot" viewBox={`0 0 ${W} 92`} height={92} data-testid="latitude-plot" aria-label={t('sectionLatitude')}>
        <defs><clipPath id={`${id}-clip`}><rect width={W} height={76} /></clipPath>
          <linearGradient id={`${id}-band`}>{readout.separation.map((sample, index) => <stop key={index}
            offset={Math.max(0, Math.min(1, (sample.ev + 8) / 16))} stopColor="var(--text)" stopOpacity={sample.strength * .9} />)}</linearGradient></defs>
        <g clipPath={`url(#${id}-clip)`}>
          <rect x={x(reply.medium.shadow_ev)} width={x(reply.medium.highlight_ev) - x(reply.medium.shadow_ev)} height={H} fill="var(--latitude-beyond)" />
          {Array.from({ length: 9 }, (_, i) => i * 2 - 8).map((ev) => <line key={ev} x1={x(ev)} x2={x(ev)} y2={H} stroke={ev === 0 ? 'var(--plot-mid-grey)' : 'var(--plot-grid)'} strokeWidth={.5} />)}
          {f.map((v, i) => <rect key={i} x={x(h.lo_ev + i * (h.hi_ev - h.lo_ev) / f.length)} y={H - v / peak * (H - 5)}
            width={(h.hi_ev - h.lo_ev) / f.length / 16 * W} height={v / peak * (H - 5)} fill={readout.centres[i]! < reply.medium.shadow_ev || readout.centres[i]! > reply.medium.highlight_ev ? 'var(--accent)' : 'var(--latitude-inside)'} />)}
          <rect y={67} width={W} height={6} rx={3} fill={`url(#${id}-band)`} data-testid="latitude-separation-band" />
          {[reply.medium.shadow_ev, reply.medium.highlight_ev].map((ev, index) => <g key={index}>
            <line x1={x(ev)} x2={x(ev)} y1={1} y2={75} stroke="var(--secondary-text)" strokeWidth={.75} strokeDasharray="2 1.5" />
            <text x={Math.max(2, Math.min(W - 2, x(ev) + (index ? 3 : -3)))} y={10} textAnchor={index ? x(ev) > W - 35 ? 'end' : 'start' : x(ev) < 35 ? 'start' : 'end'}
              fill="var(--text)" fontSize={9} stroke="var(--plot)" strokeWidth={2} paintOrder="stroke">{evText(ev)}</text>
          </g>)}
          {under > .0005 && <path d="M2 3 H8 L2 9 Z" fill="var(--accent)" />}
          {over > .0005 && <path d={`M${W - 2} 3 H${W - 8} L${W - 2} 9 Z`} fill="var(--accent)" />}
        </g>
        {Array.from({ length: 9 }, (_, i) => i * 2 - 8).map((ev) => <text key={ev} x={x(ev)} y={87} textAnchor={ev === -8 ? 'start' : ev === 8 ? 'end' : 'middle'} fill="var(--dim)" fontSize={9}>{ev > 0 ? '+' : ''}{ev}</text>)}
      </svg>
      <div className="caption num">
        {t('latitudeBelow')} {pct(readout.below)} · {t('latitudeWithin')} {pct(readout.within)} · {t('latitudeAbove')} {pct(readout.above)}
      </div>
      <div className="caption num" data-testid="latitude-range">{reply.medium.latitude_stops.toFixed(2)} {t('latitudeHeld')} · {evText(reply.medium.shadow_ev)} – {evText(reply.medium.highlight_ev)}
        {readout.core && <> · {tz('Full separation', '完整层次')} {evText(readout.core[0])} – {evText(readout.core[1])}</>}</div>
    </>
  );
}

// -------------------------------------------------------------------- Camera

function CameraSection() {
  const tool = useSession((s) => s.tool);
  const pickerReady = useSession(() => canPickNeutral());
  const state = useSession((s) => s);
  const p = cameraParams(state), focus = pairFocus(state), hole = focus ? state.pair?.[focus] : null;
  const vignette = useSession((s) => shownAdjustments(s).vignette.amount);
  const ae = aeMethodOf(p);
  const lens = (focus ? state.pairInfo?.[focus]?.metadata : state.metadata)?.lens_correction;
  const lensReady = lens?.available === true && !!state.hello?.methods?.includes(state.pair ? 'update_pair' : 'redecode') && !state.batchExporting;
  const lensReason = lens?.reason || tz('No matching lens profile is available for this photograph.', '此照片没有匹配的镜头配置文件。');
  const lensParts = lens ? [lens.distortion && tz('distortion', '畸变'), lens.tca && tz('colour fringing', '横向色差'), lens.vignetting && tz('vignetting', '暗角')].filter(Boolean).join(' · ') : '';
  const wb = useWhiteBalance();
  const options: { value: AEMethod; label: string }[] = [
    { value: 'custom', label: t('meteringCustom') },
    { value: 'balanced', label: t('meteringBalanced') },
    { value: 'center', label: t('meteringCenter') },
    { value: 'protect_highlights', label: t('meteringProtectHighlights') },
    { value: 'protect_shadows', label: t('meteringProtectShadows') },
  ];
  if (ae === 'legacy') options.push({ value: 'legacy', label: t('meteringCenterWeightedLegacy') });
  const asShot = !p.autoExposure && p.exposureCompensationEV === 0;
  return (
    <Section
      id="camera"
      title={t('sectionCamera')}
      onReset={() => setCamera((q) => ({ ...q, exposureCompensationEV: 0 }))}
      resetHelp={t('helpResetFilmExposure')}
      menu={[
        { label: t('helpResetFilmExposure'), onSelect: () => setCamera((q) => ({ ...q, exposureCompensationEV: 0 })) },
        // The presets keep their English names, as on the Mac.
        ...WB_MODES.filter((m) => m !== 'Custom').map((m) => ({
          label: `${t('helpWhiteBalancePreset')}: ${m}`,
          checked: wb.mode === m,
          disabled: !!wb.reason,
          onSelect: () => setDecode((d) => withPreset(d, wb.asShot, m)),
        })),
      ]}
    >
      <PillMenu label={t('cameraMetering')} value={ae} options={options} fill onChange={(v) => setCamera((q) => applyAEMethod(q, v))} testId="metering" />
      <PillMenu label={tz('RAW decode', 'RAW 解码')} value={selectedDecode(state).rawMode ?? 'compatible16'}
        options={[
          { value: 'auto', label: tz('Auto · expanded linear', '自动 · 线性高光') },
          { value: 'compatible16', label: tz('Compatible 16-bit', '兼容 16 位') },
          { value: 'headroom', label: tz('Expanded linear (Bayer)', '线性高光（Bayer）') },
        ]} disabled={!!wb.reason} reason={wb.reason ?? undefined}
        onChange={(rawMode) => setDecode((d) => ({ ...d, rawMode }))} testId="raw-decode-mode" />
      {hole && focus && <PillMenu label={tz('Exposure scope', '曝光范围')} value={hole.exposureScope}
        options={[{ value: 'frame', label: tz('Frame', '这一格') }, { value: 'film', label: tz('+ Film', '+ 胶片') }]}
        onChange={(v) => updatePair((p) => ({ ...p, [focus]: { ...p[focus]!, exposureScope: v } }))} />}
      <ScrubSlider
        label={t('cameraFilmExposure')}
        sublabel={
          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            {t('cameraFilmExposureAsShot')}
            <Checkbox on={asShot} label={t('cameraFilmExposureAsShot')} onChange={() => setCamera((q) => ({ ...applyAEMethod(q, 'custom'), exposureCompensationEV: 0 }))} />
          </span>
        }
        value={p.exposureCompensationEV}
        range={hole ? [-5, 5] : [-3, 3]}
        snap={1 / 3}
        format={signed(1)}
        onChange={(v) => setCamera((q) => ({ ...q, exposureCompensationEV: v }))}
        testId="film-exposure"
      />
      <ScrubSlider
        label={t('cameraTemperature')}
        sublabel={<AsShotLine on={wb.boxes.temp} enabled={!!wb.asShot && !wb.reason} onChange={(v) => setDecode((d) => applyBoxes(d, wb.asShot, { temp: v }))} />}
        value={wb.shown.temperature}
        range={TEMPERATURE_RANGE}
        zero={wb.asShot?.temperature ?? 5500}
        snap={100}
        format={(v) => v.toFixed(0)}
        onChange={(v) => setDecode((d) => withTemperature(d, wb.asShot, v))}
        disabled={!!wb.reason}
        reason={wb.reason ?? undefined}
        gradient="linear-gradient(90deg,#005982,#8FA83C,#FFF100)"
        testId="wb-temperature"
      />
      <ScrubSlider
        label={t('cameraTint')}
        sublabel={<AsShotLine on={wb.boxes.tint} enabled={!!wb.asShot && !wb.reason} onChange={(v) => setDecode((d) => applyBoxes(d, wb.asShot, { tint: v }))} />}
        value={wb.shown.tint}
        range={TINT_RANGE}
        zero={wb.asShot?.tint ?? 0}
        snap={5}
        format={signed(1)}
        onChange={(v) => setDecode((d) => withTint(d, wb.asShot, v))}
        disabled={!!wb.reason}
        reason={wb.reason ?? undefined}
        gradient="linear-gradient(90deg,#00A93A,#8AA45E,#E4007F)"
        testId="wb-tint"
      />
      <button className="pill" disabled={!pickerReady} onClick={startNeutralPick} aria-pressed={tool === 'neutral'} data-testid="pick-neutral">
        {tool === 'neutral' ? tz('Cancel neutral picker', '取消中性灰取样') : tz('Pick neutral white balance', '吸取中性灰白平衡')}
      </button>
      <ScrubSlider label={t('cameraVignetting')} value={vignette} range={[-100, 100]} snap={5} format={signed(0)} onChange={(v) => setAdjustments((a) => ({ ...a, vignette: { ...a.vignette, amount: v } }))} />
      <ToggleRow label={t('cameraLensCorrection')} on={selectedDecode(state).lensCorrection} onChange={(v) => setDecode((d) => ({ ...d, lensCorrection: v }))} disabled={!lensReady} reason={!lensReady ? lensReason : undefined} testId="lens-correction" />
      <p className="caption" data-testid="lens-profile">{lensReady ? `${lens?.profile ?? ''}${lensParts ? ` · ${lensParts}` : ''}` : lensReason}</p>
    </Section>
  );
}

/** "As Shot ☐" — the second line under Temperature and Tint (`AsShotLine`). */
function AsShotLine({ on, enabled, onChange }: { on: boolean; enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      {t('cameraFilmExposureAsShot')}
      <Checkbox on={on} label={t('cameraFilmExposureAsShot')} disabled={!enabled} onChange={onChange} />
    </span>
  );
}

/**
 * The decode white balance as the rows read it (`WhiteBalanceRows.swift`):
 * RAW only, and only on a host that can re-decode (R2's `redecode`).
 */
function useWhiteBalance() {
  const decode = useSession(selectedDecode);
  const shot = useSession((s) => { const side = pairFocus(s); return side ? s.pairInfo?.[side]?.metadata?.as_shot : s.metadata?.as_shot; });
  const selection = useSession((s) => s.selection);
  const kind = useSession((s) => { const side = pairFocus(s); return side ? s.pairInfo?.[side]?.kind : s.frameKind; });
  const methods = useSession((s) => s.hello?.methods);
  const asShot: AsShot | null = shot ? { temperature: shot.temperature_k, tint: shot.tint } : null;
  const isRaw = kind ? kind === 'raw' : !!selection && isRawPath(selection);
  let reason: string | null = null;
  if (selection && !isRaw) reason = t('reasonDecodeWBDisabled');
  else if (!hostRedecodes(methods))
    reason = tz('This engine host cannot change white balance at decode (it has no `redecode`).', '此引擎进程不能在解码时更改白平衡（没有 `redecode`）。');
  return { mode: modeOf(decode), shown: shownDecode(decode, asShot), boxes: boxesOf(decode, asShot), asShot, reason };
}

// --------------------------------------------------------------- Film Format

function FilmFormatSection() {
  const p = useSession((s) => s.sidecar.params);
  const monochrome = useSession((s) => s.catalog.isMonochrome(s.sidecar.params.filmStock));
  const unit = useSettings((s) => s.sideUnit);
  const decouple = useSettings((s) => s.decoupleEffects);
  const isCustom = p.filmFrame === FILM_FRAME_CUSTOM.id;
  const e = p.effects;
  const setE = (patch: Partial<typeof e>) => setParams((q) => ({ ...q, effects: { ...q.effects, ...patch } }));
  const strength = (label: string, key: 'grain' | 'halation' | 'scatter' | 'couplers' | 'glare', enabled: boolean) => (
    <ScrubSlider label={label} value={e[key]} range={[...EFFECT_RANGES[key]] as [number, number]} zero={1} snap={0.25} format={(v) => v.toFixed(2)} disabled={!enabled} reason={t('reasonEffectOff')} onChange={(v) => setE({ [key]: v })} />
  );
  return (
    <Section
      id="filmFormat"
      title={t('filmFormat')}
      onReset={() => {
        setFilmFrame('135');
        setFilmSide('short');
        setParams((q) => ({ ...q, grainActive: true, halationActive: true, glareActive: true, effects: EFFECTS_DEFAULT }));
      }}
      resetHelp={t('helpResetFilmFormat')}
      menu={[
        { label: t('helpAllEffectsOn'), onSelect: () => setParams((q) => ({ ...q, grainActive: true, halationActive: true, glareActive: true })) },
        { label: t('helpAllEffectsOff'), onSelect: () => setParams((q) => ({ ...q, grainActive: false, halationActive: false, glareActive: false })) },
        { label: t('helpResetEffectStrengths'), onSelect: () => setParams((q) => ({ ...q, effects: EFFECTS_DEFAULT })) },
        { label: monochrome ? tz('Single-layer grain (black-and-white film)', '单层颗粒（黑白胶片）') : t('helpSubLayerGrain'),
          checked: monochrome || e.grainLayered, disabled: !p.grainActive || monochrome, onSelect: () => setE({ grainLayered: !e.grainLayered }) },
      ]}
    >
      <PillMenu
        label={t('filmFormatSize')}
        value={p.filmFrame}
        options={FILM_FRAMES.map((f) => ({ value: f.id, label: f.id, badge: f.isCine ? 'CINE' : undefined }))}
        onChange={(v) => setFilmFrame(v)}
        testId="film-format-size"
      />
      <PillMenu
        label={t('filmFormatSide')}
        value={p.filmSide}
        options={[
          { value: 'short', label: t('filmFormatShort') },
          { value: 'long', label: t('filmFormatLong') },
        ]}
        onChange={(v) => setFilmSide(v)}
      />
      <div className="row" title={isCustom ? undefined : t('reasonNonCustomSideLength')}>
        <span className="row-label">{t('filmFormatSideLength')}</span>
        <NumberField
          value={p.sideLengthMM / SIDE_UNIT_PER_MM[unit]}
          decimals={SIDE_UNIT_DECIMALS[unit]}
          label={t('filmFormatSideLength')}
          onCommit={(v) => setSideLengthMM(v * SIDE_UNIT_PER_MM[unit])}
        />
        <PillMenu<SideUnit>
          value={unit}
          options={[
            { value: 'mm', label: 'mm' },
            { value: 'cm', label: 'cm' },
            { value: 'inch', label: 'inch' },
          ]}
          onChange={(v) => settingsStore.getState().set('sideUnit', v)}
        />
      </div>
      <ToggleRow label={t('filmGrain')} on={p.grainActive} onChange={(v) => setParams((q) => ({ ...q, grainActive: v }))} testId="grain-toggle" />
      {decouple && strength(t('filmGrainStrength'), 'grain', p.grainActive)}
      <ToggleRow label={t('filmHalation')} on={p.halationActive} onChange={(v) => setParams((q) => ({ ...q, halationActive: v }))} />
      <ToggleRow label={t('filmAntihalationLayer')} on={!e.antihalationRemoved} disabled={!p.halationActive} reason={t('reasonEffectOff')} onChange={(v) => setE({ antihalationRemoved: !v })} />
      {decouple && (
        <>
          {strength(t('filmHalationStrength'), 'halation', p.halationActive)}
          {strength(t('filmScatterStrength'), 'scatter', p.halationActive)}
          <ScrubSlider label={t('filmHighlightBoost')} value={e.highlightBoost} range={[0, 8]} snap={0.5} format={(v) => v.toFixed(1)} disabled={!p.halationActive} onChange={(v) => setE({ highlightBoost: v })} />
          <ToggleRow label={t('filmCouplers')} on={e.couplersActive} onChange={(v) => setE({ couplersActive: v })} />
          {strength(t('filmCouplersStrength'), 'couplers', e.couplersActive)}
        </>
      )}
      <ToggleRow label={t('filmGlare')} on={p.glareActive} disabled={!p.printEffects} reason={t('reasonPrintEffectsOff')} onChange={(v) => setParams((q) => ({ ...q, glareActive: v }))} />
      {decouple && strength(t('filmGlareStrength'), 'glare', p.glareActive && p.printEffects)}
    </Section>
  );
}

// ----------------------------------------------------------- Scene Placement

function ScenePlacementSection() {
  const s = useSession((s) => s);
  const sl = s.sidecar.params.sceneLatitude, l = s.latitude;
  const unsupported = unsupportedReason('scene_latitude_mapping', s.gate.sceneLatitude);
  const ready = placementReady();
  const reason = unsupported ?? (s.sidecar.params.digitalIntermediate && !s.sidecar.params.scanFilm
    ? tz('Scene placement is unavailable in Digital Intermediate mode.', '数字中间片模式不使用场景置位。')
    : ready ? null : l.failure ?? tz('Waiting for the scene latitude measurement…', '正在等待场景宽容度测量…'));
  const row = (side: PlacementSide) => {
    const window = currentPlacementWindow(side);
    const why = placementMessage(l.refusal ?? (window?.span === null ? window.below : null), side, l.reply, isChinese());
    return <div key={side}>
      <ScrubSlider label={side === 'highlight' ? t('placementHighlight') : t('placementShadow')}
        value={side === 'highlight' ? sl.highlightPullBack : sl.shadowPullBack} range={[0, 8]} snap={0.25}
        format={(v) => v.toFixed(2)} onChange={(v) => placeScene(side, v)} disabled={!ready}
        reason={reason ?? undefined} usable={window?.span ? [window.span] : []} testId={`placement-${side}`} />
      {why && <div className="caption" data-testid={`placement-${side}-reason`}>{why}</div>}
    </div>;
  };
  return (
    <Section id="scenePlacement" title={t('sectionScenePlacement')} unsupported={unsupported} onReset={resetScenePlacement} resetHelp={t('helpResetPlacement')} resetEnabled={s.gate.sceneLatitude && (sl.active || sl.highlightPullBack > 0 || sl.shadowPullBack > 0)}>
      {reason && !unsupported && <p className="caption">{reason}</p>}
      {row('highlight')}{row('shadow')}
    </Section>
  );
}

// ---------------------------------------------------------------- Post-Dev

function WhiteBalanceSection() {
  const a = useSession(shownAdjustments);
  return (
    <Section id="wb2" title={t('sectionWhiteBalance')} trailing={t('statusRightRailWBScope')} onReset={() => setAdjustments((q) => ({ ...q, temperature: 0, tint: 0 }))} resetHelp={t('helpReset')}>
      <ScrubSlider label={t('cameraTemperature')} value={a.temperature} range={[-100, 100]} snap={5} format={signed(0)} gradient="linear-gradient(90deg,#5d7de8,#bbb,#e8c04e)" onChange={(v) => setAdjustments((q) => ({ ...q, temperature: v }))} />
      <ScrubSlider label={t('cameraTint')} value={a.tint} range={[-100, 100]} snap={5} format={signed(0)} gradient="linear-gradient(90deg,#62c462,#bbb,#d05bd0)" onChange={(v) => setAdjustments((q) => ({ ...q, tint: v }))} />
    </Section>
  );
}

function ExposureSection() {
  const a = useSession(shownAdjustments);
  const row = (label: string, key: 'exposure' | 'contrast' | 'brightness' | 'saturation' | 'highlights' | 'shadows' | 'blackPoint' | 'whitePoint', range: [number, number], digits: number, snap: number) => (
    <ScrubSlider key={key} label={label} value={a[key]} range={range} snap={snap} format={signed(digits)} onChange={(v) => setAdjustments((q) => ({ ...q, [key]: v }))} testId={'adj-' + key} />
  );
  return (
    <Section
      id="exposure2"
      title={t('sectionExposure')}
      onReset={() => setAdjustments((q) => ({ ...q, exposure: 0, contrast: 0, brightness: 0, saturation: 0, highlights: 0, shadows: 0, blackPoint: 0, whitePoint: 0 }))}
      resetHelp={t('helpReset')}
    >
      {row(t('clipExposure'), 'exposure', [-3, 3], 2, 1 / 3)}
      {row(t('exposureContrast'), 'contrast', [-50, 50], 0, 5)}
      {row(t('exposureBrightness'), 'brightness', [-50, 50], 0, 5)}
      {row(t('exposureSaturation'), 'saturation', [-100, 100], 0, 5)}
      {row(t('exposureHighlights'), 'highlights', [-100, 100], 0, 5)}
      {row(t('exposureShadows'), 'shadows', [-100, 100], 0, 5)}
      {row(t('exposureBlackPoint'), 'blackPoint', [0, 50], 0, 1)}
      {row(t('exposureWhitePoint'), 'whitePoint', [0, 50], 0, 1)}
    </Section>
  );
}

const CHANNEL_LABEL: Record<CurveChannel, () => string> = {
  rgb: () => 'RGB',
  luma: () => t('curveLuma'),
  red: () => t('curveRed'),
  green: () => t('curveGreen'),
  blue: () => t('curveBlue'),
};

function CurveSection() {
  const [ch, setCh] = useState<CurveChannel>('rgb');
  return (
    <Section
      id="curve"
      title={t('sectionCurve')}
      onReset={() => setAdjustments((q) => ({ ...q, curves: { ...q.curves, [ch]: { points: [[0, 0], [1, 1]] } } }))}
      resetHelp={t('helpReset')}
      menu={[{ label: t('helpResetChannels'), onSelect: () => setAdjustments((q) => ({ ...q, curves: { rgb: { points: [[0, 0], [1, 1]] }, luma: { points: [[0, 0], [1, 1]] }, red: { points: [[0, 0], [1, 1]] }, green: { points: [[0, 0], [1, 1]] }, blue: { points: [[0, 0], [1, 1]] } } })) }]}
    >
      <div className="row" style={{ gap: 4 }}>
        {CURVE_CHANNELS.map((c) => (
          <button key={c} className={'btn' + (c === ch ? ' primary' : '')} style={{ height: 18, padding: '0 8px', fontSize: 'var(--fs-small)' }} onClick={() => setCh(c)}>
            {CHANNEL_LABEL[c]()}
          </button>
        ))}
      </div>
      <CurveEditor channel={ch} />
    </Section>
  );
}
