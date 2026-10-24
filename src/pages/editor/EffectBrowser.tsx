// CapCut-style effect browser: category tabs over a grid of looping demo previews, a target switch
// (the selected clip or a new effect layer), and the applied stack with amount + time range.
import { Crosshair, Layers, Plus, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Slider } from "../../components/controls";
import { useT, type Key } from "../../i18n";
import { engine } from "../../engine/playback";
import { CATEGORIES, EFFECT_DEF, EFFECTS, type ClipEffect, type EffectCategory, type EffectKind } from "../../project/effects";
import { addEffectLayer, clipDuration, clipEnd, isEffectLayer, updateClip } from "../../project/ops";
import type { Clip, Project } from "../../project/types";
import { useEditorUi } from "../../store/editorUi";
import { usePlayback } from "../../store/playback";
import { useProject } from "../../store/project";
import { setEffectRange } from "./timeline/ClipView";

const DEMOS = import.meta.glob("../../assets/fx-demos/*.webp", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
export const demoUrl = (kind: EffectKind): string | undefined => DEMOS[`../../assets/fx-demos/${kind}.webp`];

/** Seconds a "hit" effect (flash, punch, beat glitch…) covers when added at the playhead. */
export const HIT_SECONDS = 0.5;
/** Fade in / out effects added to a clip cover this much of its start / end. */
export const DIP_SECONDS = 0.6;
const HIT_LAYER_SECONDS = 1;

type Target = { kind: "clip"; clip: Clip } | { kind: "layer"; clip: Clip } | null;

/** The selected visual clip or effect layer the browser edits. */
export function useFxTarget(): Target {
  const project = useProject((s) => s.project);
  const selection = useProject((s) => s.selection);
  return useMemo(() => {
    if (!project || selection.length !== 1) return null;
    const clip = project.clips.find((c) => c.id === selection[0]);
    if (!clip || clip.text) return null;
    if (isEffectLayer(clip)) return { kind: "layer", clip };
    const media = project.media.find((m) => m.id === clip.mediaId);
    return media && media.kind !== "audio" ? { kind: "clip", clip } : null;
  }, [project, selection]);
}

/** Default range of a new effect on a clip of `length` seconds with the playhead `tau` seconds in. */
export function defaultRange(kind: EffectKind, tau: number, length: number): { from?: number; to?: number } {
  const def = EFFECT_DEF[kind];
  if (!def?.hit || length <= 0) return {};
  const r = (v: number) => Math.round(v * 100) / 100;
  if (kind === "fadeIn") return { from: 0, to: r(Math.min(length, DIP_SECONDS)) };
  if (kind === "fadeOut") return { from: r(Math.max(0, length - DIP_SECONDS)), to: r(length) };
  const a = tau >= 0 && tau < length - 0.05 ? tau : 0;
  const b = Math.min(length, a + HIT_SECONDS);
  return b - a >= length - 0.005 ? {} : { from: r(a), to: r(b) };
}

/** Add `kind` to the clip, or put it on a new effect layer at the playhead. Returns the edited clip id. */
export function applyEffect(kind: EffectKind, target: Target, asLayer: boolean): string | null {
  const store = useProject.getState();
  const project = store.project;
  if (!project) return null;
  const now = usePlayback.getState().time;
  const def = EFFECT_DEF[kind];
  if (asLayer || !target) {
    const duration = def.hit ? HIT_LAYER_SECONDS : undefined;
    let id = "";
    store.commit((p) => {
      const out = addEffectLayer(p, [{ kind, amount: def.initial }], now, duration);
      id = out.clipId;
      return out.project;
    });
    store.select([id]);
    useEditorUi.setState({ fxFocus: { clipId: id, index: 0 } });
    return id;
  }
  const clip = project.clips.find((c) => c.id === target.clip.id);
  if (!clip) return null;
  const effects = clip.effects ?? [];
  const existing = effects.findIndex((e) => e.kind === kind);
  if (existing >= 0 && !def.hit) {
    useEditorUi.setState({ fxFocus: { clipId: clip.id, index: existing } });
    return clip.id;
  }
  const length = clipDuration(clip);
  const effect: ClipEffect = { kind, amount: def.initial, ...defaultRange(kind, now - clip.start, length) };
  store.commit((p) => updateClip(p, clip.id, { effects: [...effects, effect] }));
  useEditorUi.setState({ fxFocus: { clipId: clip.id, index: effects.length } });
  return clip.id;
}

/** Category tabs + demo grid. */
export function EffectBrowser({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const target = useFxTarget();
  const [cat, setCat] = useState<EffectCategory>("basic");
  const [layerMode, setLayerMode] = useState(false);
  const asLayer = layerMode || !target;
  const applied = new Set((target?.clip.effects ?? []).map((e) => e.kind));
  const list = EFFECTS.filter((d) => d.cats.includes(cat));
  return (
    <div className={`fx-browser${compact ? " compact" : ""}`}>
      <div className="fx-target" role="radiogroup" aria-label={t("fx.target")}>
        <button
          role="radio"
          aria-checked={!asLayer}
          className={`fx-target-btn${!asLayer ? " active" : ""}`}
          disabled={!target}
          onClick={() => setLayerMode(false)}
          title={target ? undefined : t("fx.pickClipFirst")}
        >
          <Sparkles size={13} />
          {target?.kind === "layer" ? t("fx.toThisLayer") : t("fx.toClip")}
        </button>
        <button role="radio" aria-checked={asLayer} className={`fx-target-btn${asLayer ? " active" : ""}`} onClick={() => setLayerMode(true)}>
          <Layers size={13} />
          {t("fx.toNewLayer")}
        </button>
      </div>
      <div className="fx-tabs" role="tablist">
        {CATEGORIES.map((c) => (
          <button key={c} role="tab" aria-selected={c === cat} className={`fx-tab${c === cat ? " active" : ""}`} onClick={() => setCat(c)}>
            {t(`fx.cat.${c}` as Key)}
          </button>
        ))}
      </div>
      <div className="fx-grid" role="list">
        {list.map((d) => {
          const on = !asLayer && applied.has(d.kind);
          const url = demoUrl(d.kind);
          return (
            <button
              key={d.kind}
              role="listitem"
              className={`fx-card${on ? " active" : ""}`}
              data-fx={d.kind}
              aria-pressed={on}
              onClick={() => applyEffect(d.kind, target, asLayer)}
              title={t(`fx.${d.kind}` as Key)}
            >
              <span className="fx-thumb">
                {url ? <img src={url} alt="" loading="lazy" draggable={false} /> : <Sparkles />}
                {on ? <i className="fx-on" /> : <Plus className="fx-add" size={14} />}
                {d.hit && <em className="fx-badge">{t("fx.hitBadge")}</em>}
              </span>
              <span className="fx-name">{t(`fx.${d.kind}` as Key)}</span>
            </button>
          );
        })}
      </div>
      {asLayer && <p className="fx-hint">{t("fx.layerHint")}</p>}
    </div>
  );
}

const fmt = (v: number) => v.toFixed(2);

/** Applied effects of a clip or layer: amount, time range (numeric + timeline handles), remove. */
export function EffectStack({ clip }: { clip: Clip }) {
  const t = useT();
  const focus = useEditorUi((s) => s.fxFocus);
  const { beginGesture, endGesture, transient, commit } = useProject.getState();
  const effects = clip.effects ?? [];
  const length = clipDuration(clip);
  const layer = isEffectLayer(clip);
  if (!effects.length) return <p className="fx-empty muted">{t("fx.none")}</p>;
  const setEffects = (next: ClipEffect[], live = false) => {
    const update = (p: Project) => updateClip(p, clip.id, { effects: next.length ? next : undefined });
    if (live) transient(update);
    else commit(update);
    if (!next.length) useEditorUi.setState({ fxFocus: null });
  };
  const remove = (i: number) => {
    setEffects(effects.filter((_, j) => j !== i));
    if (focus?.clipId === clip.id) useEditorUi.setState({ fxFocus: null });
  };
  const range = (i: number, from: number, to: number) => commit((p) => setEffectRange(p, clip.id, i, from, to, length));
  return (
    <div className="fx-stack">
      {effects.map((e, i) => {
        const def = EFFECT_DEF[e.kind];
        if (!def) return null;
        const a = Math.max(0, Math.min(length, e.from ?? 0));
        const b = Math.max(a, Math.min(length, e.to ?? length));
        const whole = e.from === undefined && e.to === undefined;
        const focused = focus?.clipId === clip.id && focus.index === i;
        const url = demoUrl(e.kind);
        return (
          <div className={`fx-item${focused ? " focused" : ""}`} key={`${e.kind}-${i}`} data-fx-item={e.kind} onPointerDown={() => !focused && useEditorUi.setState({ fxFocus: { clipId: clip.id, index: i } })}>
            <div className="fx-item-head">
              {url && <img className="fx-item-thumb" src={url} alt="" />}
              <b>{t(`fx.${e.kind}` as Key)}</b>
              <button
                className="icon-btn"
                title={t("fx.showRange")}
                aria-label={t("fx.showRange")}
                onClick={() => {
                  useEditorUi.setState({ fxFocus: { clipId: clip.id, index: i } });
                  engine.seek(clip.start + a);
                }}
              >
                <Crosshair />
              </button>
              <button className="icon-btn fx-remove" title={t("fx.remove")} aria-label={t("fx.remove")} onClick={() => remove(i)}>
                <X />
              </button>
            </div>
            {!def.toggle && (
              <Slider
                label={t("fx.amount")}
                value={Math.round(e.amount * 100)}
                min={def.signed ? -100 : 0}
                max={100}
                step={1}
                format={(v) => (def.signed && v > 0 ? `+${v}` : String(v))}
                onChange={(v) => setEffects(effects.map((x, j) => (j === i ? { ...x, amount: v / 100 } : x)), true)}
                onStart={beginGesture}
                onEnd={endGesture}
              />
            )}
            <div className="fx-range-row">
              <span className="fx-range-cap">{t("fx.range")}</span>
              <NumberBox label={t("fx.from")} value={a} max={b - 0.05} onCommit={(v) => range(i, v, b)} />
              <span className="muted">–</span>
              <NumberBox label={t("fx.to")} value={b} min={a + 0.05} max={length} onCommit={(v) => range(i, a, v)} />
              <span className="muted">s</span>
              <button className={`chip chip-xs${whole ? " active" : ""}`} aria-pressed={whole} onClick={() => range(i, 0, length)}>
                {layer ? t("fx.wholeLayer") : t("fx.wholeClip")}
              </button>
              <button className="chip chip-xs" onClick={() => range(i, Math.max(0, Math.min(length - 0.1, usePlayback.getState().time - clip.start)), b)} title={t("fx.fromPlayhead")}>
                {t("fx.fromPlayheadShort")}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function NumberBox({ label, value, min = 0, max, onCommit }: { label: string; value: number; min?: number; max: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const done = () => {
    if (draft === null) return;
    const v = Number(draft.replace(",", "."));
    setDraft(null);
    if (Number.isFinite(v)) onCommit(Math.round(Math.max(min, Math.min(max, v)) * 100) / 100);
  };
  return (
    <input
      className="fx-num"
      type="text"
      inputMode="decimal"
      aria-label={label}
      title={label}
      value={draft ?? fmt(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={done}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(null);
        e.stopPropagation();
      }}
    />
  );
}

/** Layer header for the inspector: where the layer sits on the timeline. */
export function EffectLayerInfo({ clip }: { clip: Clip }) {
  const t = useT();
  const commit = useProject((s) => s.commit);
  const length = clipDuration(clip);
  return (
    <div className="fx-layer-info">
      <div className="inspector-title">
        <span className="kind-dot kind-fx" />
        <div>
          <b>{t("fx.layer")}</b>
          <small className="muted">{t("fx.layerSub")}</small>
        </div>
      </div>
      <div className="fx-range-row">
        <span className="fx-range-cap">{t("fx.layerStart")}</span>
        <NumberBox label={t("fx.layerStart")} value={clip.start} max={36000} onCommit={(v) => commit((p) => updateClip(p, clip.id, { start: v }))} />
        <span className="fx-range-cap">{t("fx.layerLength")}</span>
        <NumberBox label={t("fx.layerLength")} value={length} min={0.1} max={36000} onCommit={(v) => commit((p) => updateClip(p, clip.id, { out: clip.in + v }))} />
        <span className="muted">s · {fmt(clipEnd(clip))}</span>
      </div>
    </div>
  );
}

/** The "Effects" panel: the browser, then what the current target already has. */
export function EffectsPanel({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const target = useFxTarget();
  return (
    <div className="inspector fx-panel">
      <div className="inspector-body">
        <EffectBrowser compact={compact} />
        {target && (target.kind === "layer" || !!target.clip.effects?.length) && (
          <div className="inspector-section fx-section">
            <h3 className="section-title">{target.kind === "layer" ? t("fx.layer") : t("fx.applied")}</h3>
            {target.kind === "layer" && <EffectLayerInfo clip={target.clip} />}
            <EffectStack clip={target.clip} />
          </div>
        )}
      </div>
    </div>
  );
}
