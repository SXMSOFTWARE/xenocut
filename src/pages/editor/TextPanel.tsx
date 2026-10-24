// The Text panel: add titles from presets and style the selected text clip.
import { useEffect, useMemo, useRef, useState } from "react";
import { AlignCenter, AlignLeft, AlignRight, Bold, CaseUpper, Italic, Plus, Trash2, Type } from "lucide-react";
import { Segmented, Slider } from "../../components/controls";
import { useT, type Key } from "../../i18n";
import { addTextClip, updateText } from "../../project/ops";
import {
  applyPreset,
  TEXT_PRESETS,
  textFromPreset,
  type AnimIn,
  type AnimOut,
  type Emphasis,
  type TextBackground,
  type TextContent,
  type TextStyle,
} from "../../project/text";
import { usePlayback } from "../../store/playback";
import { useProject } from "../../store/project";
import { ensureFonts, FONTS, fontSpec, type FontId } from "../../text/fonts";
import { drawText } from "../../text/render";
import { deleteSelection } from "./commands";

const ANIM_IN: AnimIn[] = ["none", "fade", "rise", "drop", "slideLeft", "slideRight", "pop", "zoom", "typewriter", "words"];
const ANIM_OUT: AnimOut[] = ["none", "fade", "rise", "sink", "slideLeft", "slideRight", "pop", "zoom"];
const EMPHASIS: Emphasis[] = ["none", "pulse", "shake", "wave", "karaoke", "flicker"];
const BACKGROUNDS: TextBackground[] = ["none", "box", "pill", "band"];
/** 3×3 placement grid: centre points as fractions of the canvas. */
const PLACES = [0.14, 0.5, 0.86];

let fontsReady: Promise<void> | null = null;
export function loadAllFonts() {
  fontsReady ??= ensureFonts(FONTS.flatMap((f) => f.weights.map((w) => ({ font: f.id, weight: w, italic: false, sample: "AaĞğŞşİı" }))));
  return fontsReady;
}

function useSelectedText() {
  return useProject((s) => {
    if (!s.project || s.selection.length !== 1) return null;
    const clip = s.project.clips.find((c) => c.id === s.selection[0]);
    return clip?.text ? clip : null;
  });
}

export function TextPanel() {
  const t = useT();
  const clip = useSelectedText();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    void loadAllFonts().then(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, []);

  const add = (presetId: string) => {
    const { project, commit, select } = useProject.getState();
    if (!project) return;
    let clipId = "";
    const text = textFromPreset(presetId, t(presetId === "lowerThird" ? "text.sampleLower" : "text.sample"));
    commit((p) => {
      const result = addTextClip(p, text, usePlayback.getState().time);
      clipId = result.clipId;
      return result.project;
    });
    if (clipId) select([clipId]);
  };

  return (
    <div className="sp-stack text-panel">
      {clip?.text ? (
        <TextEditor key={clip.id} clipId={clip.id} text={clip.text} ready={ready} />
      ) : (
        <>
          <button className="sp-action" onClick={() => add("clean")}>
            <span className="sp-action-icon">
              <Plus />
            </span>
            <span>
              <b>{t("text.add")}</b>
              <small>{t("text.addText")}</small>
            </span>
          </button>
          <h3 className="section-title">{t("text.presets")}</h3>
          <PresetGrid ready={ready} active={null} onPick={add} />
          <p className="sp-note">{t("text.hint")}</p>
        </>
      )}
    </div>
  );
}

export function PresetGrid({ ready, active, onPick, ids }: { ready: boolean; active: string | null; onPick: (id: string) => void; ids?: string[] }) {
  const t = useT();
  return (
    <div className="text-presets">
      {(ids ? ids.map((id) => TEXT_PRESETS.find((p) => p.id === id)!).filter(Boolean) : TEXT_PRESETS).map((p) => (
        <button key={p.id} className={`text-preset${active === p.id ? " active" : ""}`} onClick={() => onPick(p.id)} aria-pressed={active === p.id} title={t(`text.preset.${p.id}` as Key)}>
          <PresetSwatch id={p.id} label={t(`text.preset.${p.id}` as Key)} ready={ready} />
        </button>
      ))}
    </div>
  );
}

/** The preset drawn with the real renderer on a small canvas. */
function PresetSwatch({ id, label, ready }: { id: string; label: string; ready: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const W = 320;
    const H = 180;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const base = textFromPreset(id, label);
    const lower = base.style.y > 0.7;
    const text: TextContent = {
      ...base,
      style: { ...base.style, size: Math.min(300, base.style.size * 3.1), x: 0.5, y: lower ? 0.62 : 0.5, width: 0.9 },
      anim: { ...base.anim, in: "none", out: "none" },
    };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // Karaoke shows half sung, other emphases sit at rest.
    drawText(ctx, text, W, H, base.anim.emphasis === "karaoke" ? 1 : 0, 2);
  }, [id, label, ready]);
  return <canvas ref={ref} className="text-preset-canvas" aria-label={label} />;
}

function TextEditor({ clipId, text, ready }: { clipId: string; text: TextContent; ready: boolean }) {
  const t = useT();
  const [tab, setTab] = useState<"style" | "effects" | "motion">("style");
  const { beginGesture, endGesture, transient, commit } = useProject.getState();
  const g = { onStart: beginGesture, onEnd: endGesture };
  const edit = (update: (x: TextContent) => TextContent) => transient((p) => updateText(p, clipId, update));
  const style = (patch: Partial<TextStyle>) => edit((x) => ({ ...x, style: { ...x.style, ...patch } }));
  const styleNow = (patch: Partial<TextStyle>) => commit((p) => updateText(p, clipId, (x) => ({ ...x, style: { ...x.style, ...patch } })));
  const animNow = (patch: Partial<TextContent["anim"]>) => commit((p) => updateText(p, clipId, (x) => ({ ...x, anim: { ...x.anim, ...patch } })));
  const s = text.style;
  const spec = fontSpec(s.font);

  // Typing is one undo step per pause rather than per key.
  const typingTimer = useRef(0);
  const onType = (content: string) => {
    beginGesture();
    edit((x) => ({ ...x, content }));
    window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(endGesture, 600);
  };
  useEffect(() => () => {
    window.clearTimeout(typingTimer.current);
    useProject.getState().endGesture();
  }, []);

  const fontOptions = useMemo(() => FONTS.map((f) => ({ id: f.id, family: f.family })), []);

  return (
    <>
      <textarea
        className="input text-content"
        value={text.content}
        rows={3}
        placeholder={t("text.placeholder")}
        onChange={(e) => onType(e.target.value)}
        aria-label={t("text.content")}
      />
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "style", label: t("text.tab.style") },
          { value: "effects", label: t("text.tab.effects") },
          { value: "motion", label: t("text.tab.motion") },
        ]}
      />

      {tab === "style" && (
        <>
          <h3 className="section-title">{t("text.presets")}</h3>
          <PresetGrid ready={ready} active={text.preset} onPick={(id) => commit((p) => updateText(p, clipId, (x) => applyPreset(x, id)))} />
          <h3 className="section-title">{t("text.font")}</h3>
          <div className="font-grid">
            {fontOptions.map((f) => (
              <button key={f.id} className={`font-chip${s.font === f.id ? " active" : ""}`} style={{ fontFamily: `"${f.family}"` }} onClick={() => styleNow({ font: f.id as FontId })}>
                {f.family}
              </button>
            ))}
          </div>
          <div className="text-toggles">
            <ToggleBtn on={s.weight >= 700} disabled={spec.weights.length < 2} label={t("text.bold")} onClick={() => styleNow({ weight: s.weight >= 700 ? 400 : 800 })}>
              <Bold />
            </ToggleBtn>
            <ToggleBtn on={s.italic} disabled={!spec.italic} label={t("text.italic")} onClick={() => styleNow({ italic: !s.italic })}>
              <Italic />
            </ToggleBtn>
            <ToggleBtn on={s.uppercase} label={t("text.uppercase")} onClick={() => styleNow({ uppercase: !s.uppercase })}>
              <CaseUpper />
            </ToggleBtn>
            <span className="spacer" />
            {(["left", "center", "right"] as const).map((a) => (
              <ToggleBtn key={a} on={s.align === a} label={t(`text.align.${a}`)} onClick={() => styleNow({ align: a })}>
                {a === "left" ? <AlignLeft /> : a === "center" ? <AlignCenter /> : <AlignRight />}
              </ToggleBtn>
            ))}
          </div>
          <Slider label={t("text.size")} value={s.size} min={16} max={260} step={1} format={(v) => `${Math.round(v)}`} onChange={(v) => style({ size: v })} {...g} />
          <div className="color-row">
            <ColorField label={t("text.color")} value={s.color} onChange={(v) => style({ color: v })} {...g} />
            <ColorField label={t("text.color2")} value={s.color2} onChange={(v) => style({ color2: v })} onClear={() => styleNow({ color2: null })} {...g} />
            <ColorField label={t("text.highlight")} value={s.highlight} onChange={(v) => style({ highlight: v })} {...g} />
          </div>
          <h3 className="section-title">{t("text.position")}</h3>
          <div className="place-grid" role="group" aria-label={t("text.position")}>
            {PLACES.map((y) =>
              PLACES.map((x) => (
                <button
                  key={`${x}-${y}`}
                  className={Math.abs(s.x - x) < 0.01 && Math.abs(s.y - y) < 0.01 ? "active" : ""}
                  onClick={() => styleNow({ x, y })}
                  aria-label={`${Math.round(x * 100)}%, ${Math.round(y * 100)}%`}
                >
                  <i />
                </button>
              )),
            )}
          </div>
          <Slider label={t("text.x")} value={s.x} min={0} max={1} step={0.005} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => style({ x: v })} {...g} />
          <Slider label={t("text.y")} value={s.y} min={0} max={1} step={0.005} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => style({ y: v })} {...g} />
          <Slider label={t("text.width")} value={s.width} min={0.2} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => style({ width: v })} {...g} />
          <Slider label={t("text.spacing")} value={s.spacing} min={-0.05} max={0.4} step={0.005} format={(v) => v.toFixed(2)} onChange={(v) => style({ spacing: v })} {...g} />
          <Slider label={t("text.lineHeight")} value={s.lineHeight} min={0.8} max={2} step={0.01} format={(v) => v.toFixed(2)} onChange={(v) => style({ lineHeight: v })} {...g} />
        </>
      )}

      {tab === "effects" && (
        <>
          <h3 className="section-title">{t("text.stroke")}</h3>
          <div className="color-row">
            <ColorField label={t("text.strokeColor")} value={s.strokeColor} onChange={(v) => style({ strokeColor: v })} {...g} />
          </div>
          <Slider label={t("text.strokeWidth")} value={s.stroke} min={0} max={24} step={0.5} format={(v) => v.toFixed(1)} onChange={(v) => style({ stroke: v })} {...g} />
          <Slider label={t("text.shadow")} value={s.shadow} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => style({ shadow: v })} {...g} />
          <Slider label={t("text.glow")} value={s.glow} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => style({ glow: v })} {...g} />
          <h3 className="section-title">{t("text.background")}</h3>
          <div className="chip-group">
            {BACKGROUNDS.map((b) => (
              <button key={b} className={`chip${s.background === b ? " active" : ""}`} onClick={() => styleNow({ background: b })}>
                {t(`text.bg.${b}`)}
              </button>
            ))}
          </div>
          {s.background !== "none" && (
            <>
              <div className="color-row">
                <ColorField label={t("text.bgColor")} value={s.bgColor} onChange={(v) => style({ bgColor: v })} {...g} />
              </div>
              <Slider label={t("text.bgOpacity")} value={s.bgOpacity} min={0.05} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => style({ bgOpacity: v })} {...g} />
            </>
          )}
        </>
      )}

      {tab === "motion" && (
        <>
          <h3 className="section-title">{t("text.animIn")}</h3>
          <div className="chip-group">
            {ANIM_IN.map((a) => (
              <button key={a} className={`chip${text.anim.in === a ? " active" : ""}`} onClick={() => animNow({ in: a })}>
                {t(`text.in.${a}`)}
              </button>
            ))}
          </div>
          {text.anim.in !== "none" && (
            <Slider label={t("text.duration")} value={text.anim.inDur} min={0.1} max={3} step={0.05} format={(v) => `${v.toFixed(2)} s`} onChange={(v) => edit((x) => ({ ...x, anim: { ...x.anim, inDur: v } }))} {...g} />
          )}
          <h3 className="section-title">{t("text.animOut")}</h3>
          <div className="chip-group">
            {ANIM_OUT.map((a) => (
              <button key={a} className={`chip${text.anim.out === a ? " active" : ""}`} onClick={() => animNow({ out: a })}>
                {t(`text.out.${a}`)}
              </button>
            ))}
          </div>
          {text.anim.out !== "none" && (
            <Slider label={t("text.duration")} value={text.anim.outDur} min={0.1} max={3} step={0.05} format={(v) => `${v.toFixed(2)} s`} onChange={(v) => edit((x) => ({ ...x, anim: { ...x.anim, outDur: v } }))} {...g} />
          )}
          <h3 className="section-title">{t("text.emphasis")}</h3>
          <div className="chip-group">
            {EMPHASIS.map((a) => (
              <button key={a} className={`chip${text.anim.emphasis === a ? " active" : ""}`} onClick={() => animNow({ emphasis: a })}>
                {t(`text.emph.${a}`)}
              </button>
            ))}
          </div>
          {text.anim.emphasis === "karaoke" && <p className="sp-note">{t("text.karaokeHint")}</p>}
        </>
      )}

      <div className="text-actions">
        <button className="btn btn-sm" onClick={() => useProject.getState().select([])}>
          <Type />
          {t("text.newText")}
        </button>
        <span className="spacer" />
        <button className="btn btn-sm btn-danger" onClick={deleteSelection}>
          <Trash2 />
          {t("inspector.delete")}
        </button>
      </div>
    </>
  );
}

function ToggleBtn({ on, label, disabled, onClick, children }: { on: boolean; label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={`mini-btn text-toggle${on ? " on" : ""}`} onClick={onClick} disabled={disabled} aria-pressed={on} aria-label={label} title={label}>
      {children}
    </button>
  );
}

function ColorField({
  label,
  value,
  onChange,
  onClear,
  onStart,
  onEnd,
}: {
  label: string;
  value: string | null;
  onChange: (v: string) => void;
  onClear?: () => void;
  onStart?: () => void;
  onEnd?: () => void;
}) {
  return (
    <label className={`color-field${value ? "" : " empty"}`} title={label}>
      <span className="color-swatch" style={{ background: value ?? undefined }}>
        <input
          type="color"
          value={value ?? "#ffffff"}
          onFocus={onStart}
          onBlur={onEnd}
          onChange={(e) => {
            onStart?.();
            onChange(e.target.value);
          }}
          aria-label={label}
        />
      </span>
      <span className="color-label">{label}</span>
      {onClear && value && (
        <button
          className="color-clear"
          onClick={(e) => {
            e.preventDefault();
            onClear();
          }}
          aria-label="×"
        >
          ×
        </button>
      )}
    </label>
  );
}
