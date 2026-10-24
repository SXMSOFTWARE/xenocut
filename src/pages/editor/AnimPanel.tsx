// CapCut-style clip animations: In / Out / Combo tabs over a grid of live previews, a duration
// slider, and a stage preview of the animated part whenever one is picked.
import { Ban, Wand2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Slider } from "../../components/controls";
import { useT, type Key } from "../../i18n";
import { engine } from "../../engine/playback";
import {
  animAt,
  animCss,
  animEffects,
  COMBO_KINDS,
  comboDefault,
  DEFAULT_EDGE,
  EDGE_KINDS,
  windows,
  type ClipAnim,
  type ComboKind,
  type EdgeKind,
} from "../../project/anims";
import { clipDuration, updateClip } from "../../project/ops";
import type { Clip } from "../../project/types";
import { useProject } from "../../store/project";
import { usePlayback } from "../../store/playback";
import thumb from "../../assets/anim-thumb.webp";
import { useFxTarget } from "./EffectBrowser";

export type AnimTab = "in" | "out" | "combo";
const TABS: AnimTab[] = ["in", "out", "combo"];
const HOLD = 0.7;

/** The tile animation: what a slot looks like on a small card at `now` seconds. */
function tileStyle(tab: AnimTab, kind: string, now: number): { transform: string; opacity: string; filter: string } {
  const d = tab === "combo" ? comboDefault(kind as ComboKind) : DEFAULT_EDGE;
  const length = tab === "combo" ? Math.max(2.4, d * 2) : d + HOLD;
  const anim: ClipAnim = tab === "in" ? { in: { kind: kind as EdgeKind, duration: d } } : tab === "out" ? { out: { kind: kind as EdgeKind, duration: d } } : { combo: { kind: kind as ComboKind, duration: d } };
  // A short pause between loops (Out tiles end hidden, In tiles end settled).
  const local = Math.min(length - 1e-3, now % (length + 0.3));
  const st = animAt(anim, local, length);
  const filters: string[] = [];
  let shake = "";
  for (const e of animEffects(anim, length)) {
    if (local < (e.from ?? 0) || local >= (e.to ?? length)) continue;
    if (e.kind === "blur") filters.push(`blur(${(e.amount * 3).toFixed(2)}px)`);
    if (e.kind === "rgbSplit") filters.push("drop-shadow(2px 0 rgba(255,0,60,.8)) drop-shadow(-2px 0 rgba(0,220,255,.8))");
    if (e.kind === "flash") filters.push(`brightness(${(1 + e.amount * (1 - (local - (e.from ?? 0)) / Math.max(0.01, (e.to ?? length) - (e.from ?? 0)))).toFixed(2)})`);
    if (e.kind === "shake" || e.kind === "hitShake") shake = `translate(${(Math.sin(local * 71) * 4 * e.amount).toFixed(1)}px, ${(Math.cos(local * 53) * 3 * e.amount).toFixed(1)}px) `;
  }
  return { transform: shake + animCss(st), opacity: st.alpha.toFixed(3), filter: filters.join(" ") };
}

/** One rAF loop animating every tile in the grid. */
function useTileLoop(grid: React.RefObject<HTMLDivElement | null>, tab: AnimTab) {
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const step = () => {
      const now = (performance.now() - t0) / 1000;
      grid.current?.querySelectorAll<HTMLElement>("[data-anim]").forEach((el) => {
        const s = tileStyle(tab, el.dataset.anim!, now);
        el.style.transform = s.transform;
        el.style.opacity = s.opacity;
        el.style.filter = s.filter;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [grid, tab]);
}

let previewTimer = 0;
/** Play the animated part of the clip on the stage once, then stop there. */
export function previewAnim(clip: Clip, tab: AnimTab) {
  const length = clipDuration(clip);
  const { din, dout } = windows(clip.anim, length);
  let a = 0;
  let b = length;
  if (tab === "in") b = Math.min(length, din + 0.4);
  else if (tab === "out") a = Math.max(0, length - dout - 0.4);
  else b = Math.min(length, Math.max(2, (clip.anim?.combo?.duration ?? 1) * 2));
  window.clearTimeout(previewTimer);
  engine.pause();
  engine.seek(clip.start + a);
  engine.play();
  previewTimer = window.setTimeout(() => {
    if (usePlayback.getState().playing) engine.pause();
  }, Math.max(200, (b - a) * 1000));
}

function setSlot(clip: Clip, tab: AnimTab, kind: string | null, duration?: number) {
  const store = useProject.getState();
  const anim: ClipAnim = { ...(clip.anim ?? {}) };
  if (!kind) delete anim[tab];
  else if (tab === "combo") anim.combo = { kind: kind as ComboKind, duration: duration ?? anim.combo?.duration ?? comboDefault(kind as ComboKind) };
  else anim[tab] = { kind: kind as EdgeKind, duration: duration ?? anim[tab]?.duration ?? Math.min(DEFAULT_EDGE, clipDuration(clip) / 2) };
  // A combo animation replaces In / Out and the other way round, like CapCut.
  if (kind && tab === "combo") {
    delete anim.in;
    delete anim.out;
  } else if (kind) delete anim.combo;
  const next = anim.in || anim.out || anim.combo ? anim : undefined;
  store.commit((p) => updateClip(p, clip.id, { anim: next }));
}

export function AnimPanel({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const target = useFxTarget();
  const clip = target?.kind === "clip" ? target.clip : null;
  const [tab, setTab] = useState<AnimTab>("in");
  const grid = useRef<HTMLDivElement>(null);
  useTileLoop(grid, tab);
  const kinds: string[] = tab === "combo" ? COMBO_KINDS : EDGE_KINDS;
  const current = clip?.anim?.[tab];
  const length = clip ? clipDuration(clip) : 0;
  const { din, dout } = windows(clip?.anim, length);
  const maxEdge = Math.max(0.1, Math.min(5, tab === "in" ? length - dout : length - din));
  const { beginGesture, endGesture, transient } = useProject.getState();

  return (
    <div className="inspector fx-panel anim-panel">
      <div className="inspector-body">
        <div className={`fx-browser${compact ? " compact" : ""}`}>
          <div className="fx-tabs" role="tablist">
            {TABS.map((id) => (
              <button key={id} role="tab" aria-selected={id === tab} className={`fx-tab${id === tab ? " active" : ""}`} onClick={() => setTab(id)}>
                {t(`anim.tab.${id}` as Key)}
                {clip?.anim?.[id] && <i className="anim-dot" />}
              </button>
            ))}
          </div>
          {!clip && <p className="fx-hint">{t("anim.pickClip")}</p>}
          <div className="fx-grid" role="list" ref={grid}>
            <button role="listitem" className={`fx-card${clip && !current ? " active" : ""}`} disabled={!clip} onClick={() => clip && setSlot(clip, tab, null)}>
              <span className="fx-thumb anim-thumb none">
                <Ban size={20} />
              </span>
              <span className="fx-name">{t("anim.none")}</span>
            </button>
            {kinds.map((kind) => {
              const on = current?.kind === kind;
              return (
                <button
                  key={kind}
                  role="listitem"
                  className={`fx-card${on ? " active" : ""}`}
                  data-anim-kind={kind}
                  aria-pressed={on}
                  disabled={!clip}
                  title={t(`anim.${tab === "combo" ? "combo" : "edge"}.${kind}` as Key)}
                  onClick={() => {
                    if (!clip) return;
                    setSlot(clip, tab, kind);
                    const fresh = useProject.getState().project?.clips.find((c) => c.id === clip.id);
                    if (fresh) previewAnim(fresh, tab);
                  }}
                >
                  <span className="fx-thumb anim-thumb">
                    <img src={thumb} alt="" draggable={false} data-anim={kind} />
                    {on && <i className="fx-on" />}
                  </span>
                  <span className="fx-name">{t(`anim.${tab === "combo" ? "combo" : "edge"}.${kind}` as Key)}</span>
                </button>
              );
            })}
          </div>
        </div>
        {clip && current && (
          <div className="inspector-section">
            <h3 className="section-title">
              <Wand2 size={13} /> {t(`anim.tab.${tab}` as Key)} · {t(`anim.${tab === "combo" ? "combo" : "edge"}.${current.kind}` as Key)}
            </h3>
            <Slider
              label={tab === "combo" ? t("anim.period") : t("anim.duration")}
              value={tab === "combo" ? current.duration : Math.min(current.duration, maxEdge)}
              min={tab === "combo" ? 0.2 : 0.1}
              max={tab === "combo" ? 5 : maxEdge}
              step={0.05}
              format={(v) => `${v.toFixed(2)} s`}
              onStart={beginGesture}
              onEnd={() => {
                endGesture();
                const fresh = useProject.getState().project?.clips.find((c) => c.id === clip.id);
                if (fresh) previewAnim(fresh, tab);
              }}
              onChange={(v) => transient((p) => updateClip(p, clip.id, { anim: { ...clip.anim, [tab]: { ...current, duration: Math.round(v * 100) / 100 } } }))}
            />
          </div>
        )}
      </div>
    </div>
  );
}
