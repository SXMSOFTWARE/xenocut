// CapCut-style transition browser: category tabs and a search over animated demo cards (the
// built-in set plus installed packs), applied to the picked cut; below it the cut's transition
// with duration, shader settings, "apply to all" and remove.
import { Ban, Puzzle, RotateCcw, Search, Trash2, X } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Slider, Switch } from "../../components/controls";
import { useT, type Key } from "../../i18n";
import { engine } from "../../engine/playback";
import { clipDuration, updateClip } from "../../project/ops";
import type { ClipTransition } from "../../project/types";
import { useEditorUi } from "../../store/editorUi";
import { usePlayback } from "../../store/playback";
import { useProject } from "../../store/project";
import { useRouter } from "../../store/router";
import { BUILTIN, CATEGORIES, MIN_DURATION, cuts, parseUniforms, transitionGlsl, type TransitionCategory, type UniformSpec } from "../../transitions";
import {
  applyToAllCuts,
  applyTransitionDef,
  defGlsl,
  maxDuration,
  removeCutTransition,
  resolveCut,
  useTransitionDefs,
  type BrowserDef,
  type Cut,
} from "../../transitions/catalog";
import { DEMO_H, DEMO_W, demoProgress, demoStills, drawDemo } from "../../transitions/demo";
import { TransitionsIcon } from "./icons";

type Tab = TransitionCategory | "all";

/** The cut the panel edits (see `resolveCut`). */
export function useCutTarget(): Cut | null {
  const project = useProject((s) => s.project);
  const selection = useProject((s) => s.selection);
  const picked = useEditorUi((s) => s.cut);
  return useMemo(() => resolveCut(project, selection, picked), [project, selection, picked]);
}

/** Display name of a transition (built-ins are translated). */
export function transitionName(t: ReturnType<typeof useT>, id: string, name?: string): string {
  return BUILTIN.has(id) ? t(`trans.n.${id}` as Key) : name ?? id.split("/").pop() ?? id;
}

/** The cut nearest the playhead (used when a card is clicked with nothing picked). */
function nearestCut(): Cut | null {
  const p = useProject.getState().project;
  if (!p) return null;
  const now = usePlayback.getState().time;
  let best: Cut | null = null;
  for (const c of cuts(p.clips, p.tracks)) if (!best || Math.abs(c.cut - now) < Math.abs(best.cut - now)) best = c;
  return best;
}

/** Picks a cut for the browser and the timeline handles (clears the clip selection). */
export function pickCut(fromId: string) {
  useProject.getState().select([]);
  useEditorUi.setState({ cut: fromId });
}

async function apply(def: BrowserDef, target: Cut | null, onError: () => void) {
  const cut = target ?? nearestCut();
  if (!cut) return;
  if (!(await applyTransitionDef(def, cut))) return onError();
  if (!target) pickCut(cut.from.id);
  // Show it: play the transition window once.
  const d = Math.min(useProject.getState().project?.clips.find((c) => c.id === cut.from.id)?.transition?.duration ?? 0.6, maxDuration(cut));
  engine.seek(Math.max(0, cut.cut - d / 2 - 0.4));
  engine.play();
  window.setTimeout(() => usePlayback.getState().playing && usePlayback.getState().time > cut.cut + d / 2 + 0.3 && engine.pause(), (d + 1.2) * 1000);
}

const DemoCard = memo(function DemoCard({ def, active, onPick }: { def: BrowserDef; active: boolean; onPick: (d: BrowserDef) => void }) {
  const t = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const state = useRef<{ glsl: string | null; imgs: [HTMLImageElement, HTMLImageElement] | null; raf: number; shown: boolean }>({ glsl: null, imgs: null, raf: 0, shown: false });

  const ready = async () => {
    const s = state.current;
    if (s.glsl === null) s.glsl = await defGlsl(def);
    if (!s.imgs) s.imgs = await demoStills();
    return !!(s.glsl && s.imgs);
  };
  const frame = (p: number) => {
    const s = state.current;
    if (!canvas.current || !s.glsl || !s.imgs) return;
    if (!drawDemo(canvas.current, s.imgs, s.glsl, def.builtin, p)) setFailed(true);
  };

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting) || state.current.shown) return;
      state.current.shown = true;
      io.disconnect();
      void ready().then((ok) => (ok ? frame(STILL) : setFailed(true)));
    });
    io.observe(el);
    const s = state.current;
    return () => {
      io.disconnect();
      cancelAnimationFrame(s.raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.id]);

  const start = () => {
    void ready().then((ok) => {
      if (!ok) return;
      const t0 = performance.now();
      const loop = (now: number) => {
        frame(demoProgress((now - t0) / 1000));
        state.current.raf = requestAnimationFrame(loop);
      };
      cancelAnimationFrame(state.current.raf);
      state.current.raf = requestAnimationFrame(loop);
    });
  };
  const stop = () => {
    cancelAnimationFrame(state.current.raf);
    state.current.raf = 0;
    frame(STILL);
  };
  const name = transitionName(t, def.id, def.name);
  return (
    <button
      role="listitem"
      className={`fx-card tr-card${active ? " active" : ""}`}
      data-trans={def.id}
      aria-pressed={active}
      onClick={() => onPick(def)}
      onPointerEnter={start}
      onPointerLeave={stop}
      onFocus={start}
      onBlur={stop}
      title={def.packName ? `${name} · ${def.packName}${def.author ? ` · ${def.author}` : ""}` : name}
    >
      <span className="fx-thumb">
        <canvas ref={canvas} width={DEMO_W} height={DEMO_H} className={failed ? "failed" : undefined} />
        {failed && <TransitionsIcon size={20} />}
        {active && <i className="fx-on" />}
        {!def.builtin && <em className="fx-badge">GL</em>}
      </span>
      <span className="fx-name">{name}</span>
    </button>
  );
});

function TransitionBrowser({ target, compact }: { target: Cut | null; compact: boolean }) {
  const t = useT();
  const go = useRouter((r) => r.go);
  const defs = useTransitionDefs();
  const [tab, setTab] = useState<Tab>("basic");
  const [query, setQuery] = useState("");
  const [error, setError] = useState(false);
  const hasPacks = defs.some((d) => !d.builtin);
  const tabs = useMemo(() => CATEGORIES.filter((c) => defs.some((d) => d.category === c)), [defs]);
  const q = query.trim().toLocaleLowerCase();
  const list = useMemo(() => {
    if (q) return defs.filter((d) => transitionName(t, d.id, d.name).toLocaleLowerCase().includes(q) || d.name.toLowerCase().includes(q) || d.id.toLowerCase().includes(q));
    return tab === "all" ? defs : defs.filter((d) => d.category === tab);
  }, [defs, tab, q, t]);
  const current = target?.from.transition?.id;
  const pick = (d: BrowserDef) => {
    setError(false);
    void apply(d, target, () => setError(true));
  };
  return (
    <div className={`fx-browser tr-browser${compact ? " compact" : ""}`}>
      <label className="tr-search">
        <Search size={13} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("trans.search")} aria-label={t("trans.search")} onKeyDown={(e) => e.stopPropagation()} />
        {query && (
          <button className="icon-btn" onClick={() => setQuery("")} aria-label={t("rail.close")}>
            <X size={12} />
          </button>
        )}
      </label>
      {!q && (
        <div className="fx-tabs" role="tablist">
          {(["all", ...tabs] as Tab[]).map((c) => (
            <button key={c} role="tab" aria-selected={c === tab} className={`fx-tab${c === tab ? " active" : ""}`} onClick={() => setTab(c)}>
              {t(`trans.cat.${c}` as Key)}
            </button>
          ))}
        </div>
      )}
      {error && <p className="fx-hint danger">{t("trans.loadFailed")}</p>}
      <div className="fx-grid" role="list">
        {!q && (
          <button role="listitem" className={`fx-card tr-none${target && !current ? " active" : ""}`} disabled={!target?.from.transition} onClick={() => target && removeCutTransition(target.from.id)}>
            <span className="fx-thumb">
              <Ban size={20} />
            </span>
            <span className="fx-name">{t("trans.none")}</span>
          </button>
        )}
        {list.map((d) => (
          <DemoCard key={d.id} def={d} active={current === d.id} onPick={pick} />
        ))}
        <button role="listitem" className="fx-card get-more" onClick={() => go("plugins")}>
          <span className="fx-thumb">
            <Puzzle size={20} />
          </span>
          <span className="fx-name">{t("plugins.getMore")}</span>
        </button>
      </div>
      {!hasPacks && <p className="fx-hint">{t("trans.packsHint")}</p>}
    </div>
  );
}

const PARAM_NUMERIC = new Set<UniformSpec["type"]>(["float", "int"]);

/** Slider range for a gl-transitions uniform from its default (they rarely say). */
function range(s: UniformSpec): [number, number, number] {
  const v = s.value[0] ?? 0;
  if (s.type === "int") return [0, Math.max(10, Math.ceil(Math.abs(v) * 3)), 1];
  if (v >= 0 && v <= 1) return [0, 1, 0.01];
  const m = Math.max(1, Math.abs(v) * 3);
  return [v < 0 ? -m : 0, m, m / 100];
}

/** The picked cut's transition: duration, shader settings, apply to all, remove. */
function TransitionInspector({ cut }: { cut: Cut }) {
  const t = useT();
  const tr = cut.from.transition!;
  const { beginGesture, endGesture, transient, commit } = useProject.getState();
  const specs = useMemo(() => {
    const src = transitionGlsl(tr);
    return src && !src.builtin ? parseUniforms(src.glsl).filter((s) => PARAM_NUMERIC.has(s.type) || s.type === "bool") : [];
  }, [tr]);
  const set = (patch: Partial<ClipTransition>, live = false) => {
    const fn = (p: Parameters<typeof updateClip>[0]) => updateClip(p, cut.from.id, { transition: { ...tr, ...patch } });
    if (live) transient(fn);
    else commit(fn);
  };
  const max = maxDuration(cut);
  const param = (s: UniformSpec) => {
    const raw = tr.params?.[s.name];
    return raw === undefined ? s.value[0] : typeof raw === "boolean" ? (raw ? 1 : 0) : Array.isArray(raw) ? raw[0] : raw;
  };
  const setParam = (name: string, v: number | boolean, live = false) => set({ params: { ...tr.params, [name]: v } }, live);
  return (
    <div className="inspector-section tr-inspector" data-trans-inspector={tr.id}>
      <h3 className="section-title">
        <TransitionsIcon size={13} /> {transitionName(t, tr.id, tr.name)}
      </h3>
      <Slider
        label={t("trans.duration")}
        value={Math.min(tr.duration, max)}
        min={MIN_DURATION}
        max={max}
        step={0.05}
        format={(v) => `${v.toFixed(2)} s`}
        onChange={(v) => set({ duration: Math.round(v * 100) / 100 }, true)}
        onStart={beginGesture}
        onEnd={endGesture}
      />
      {specs.length > 0 && (
        <div className="tr-params">
          <h4 className="fx-range-cap">{t("trans.params")}</h4>
          {specs.map((s) => {
            if (s.type === "bool") return <Switch key={s.name} label={s.label ?? s.name} on={!!param(s)} onChange={(v) => setParam(s.name, v)} />;
            const [lo, hi, step] = range(s);
            return (
              <Slider
                key={s.name}
                label={s.label ?? s.name}
                value={param(s)}
                min={lo}
                max={hi}
                step={step}
                format={(v) => (s.type === "int" ? String(Math.round(v)) : v.toFixed(2))}
                onChange={(v) => setParam(s.name, s.type === "int" ? Math.round(v) : v, true)}
                onStart={beginGesture}
                onEnd={endGesture}
              />
            );
          })}
          {tr.params && (
            <button className="chip chip-xs" onClick={() => set({ params: undefined })}>
              <RotateCcw size={11} /> {t("trans.reset")}
            </button>
          )}
        </div>
      )}
      <div className="tr-actions">
        <button className="btn btn-sm" onClick={() => applyToAllCuts(tr)} data-trans-all="">
          {t("trans.applyAll")}
        </button>
        <button className="btn btn-sm danger" onClick={() => removeCutTransition(cut.from.id)}>
          <Trash2 size={13} /> {t("trans.remove")}
        </button>
      </div>
    </div>
  );
}

/** Static card frame: before the midpoint so through-black transitions (iris, fade-through) still show both shots. */
const STILL = 0.35;

export function TransitionsPanel({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const target = useCutTarget();
  const project = useProject((s) => s.project);
  const all = useMemo(() => (project ? cuts(project.clips, project.tracks) : []), [project]);
  const media = (id: string) => project?.media.find((m) => m.id === id);
  const label = (c: Cut["from"]) => c.name ?? media(c.mediaId)?.name ?? "";
  const index = target ? all.findIndex((c) => c.from.id === target.from.id) + 1 : 0;
  return (
    <div className="inspector tr-panel">
      <div className="inspector-body">
        {all.length === 0 ? (
          <p className="fx-hint">{t("trans.noCuts")}</p>
        ) : target ? (
          <button className="tr-target" onClick={() => engine.seek(Math.max(0, target.cut - 0.5))} title={`${clipDuration(target.from).toFixed(1)} s → ${clipDuration(target.to).toFixed(1)} s`}>
            <TransitionsIcon size={13} />
            <span>{t("trans.target", { n: index, a: label(target.from), b: label(target.to) })}</span>
          </button>
        ) : (
          <p className="fx-hint">{t("trans.pickCut")}</p>
        )}
        {target?.from.transition && <TransitionInspector cut={target} />}
        <TransitionBrowser target={target} compact={compact} />
      </div>
    </div>
  );
}
