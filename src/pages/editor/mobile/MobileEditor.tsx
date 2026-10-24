import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import {
  ArrowLeft,
  AudioLines,
  Captions,
  ChevronDown,
  Clapperboard,
  Maximize2,
  Music2,
  Pause,
  Play,
  Redo2,
  Scissors,
  Settings2,
  Share,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Type,
  Undo2,
  Palette,
  Wand2,
  X,
} from "lucide-react";
import "../../../styles/mobile.css";
import "../../../styles/themes.css";
import { useCurrentTheme } from "../../../themes/useTheme";
import { engine } from "../../../engine/playback";
import { useT, type Key } from "../../../i18n";
import { clipEnd, projectDuration } from "../../../project/ops";
import { useEditorUi, type PanelId } from "../../../store/editorUi";
import { usePlayback } from "../../../store/playback";
import { useProject } from "../../../store/project";
import { useRouter } from "../../../store/router";
import { Ambient } from "../Ambient";
import { ASPECTS, RESOLUTIONS, setFormat, TimeReadout } from "../BottomBar";
import { deleteSelection, fitTimeline, leaveEditor, splitAtPlayhead } from "../commands";
import { Inspector } from "../Inspector";
import { EffectsPanel } from "../EffectBrowser";
import { AnimPanel } from "../AnimPanel";
import { MediaBin } from "../MediaBin";
import { Preview } from "../Preview";
import { AudioPanel, ColorPanel, MusicPanel, VoicePanel } from "../SidePanel";
import { TextPanel } from "../TextPanel";
import { SubtitlesPanel } from "../SubtitlesPanel";
import { LyricsPanel } from "../LyricsPanel";
import { AmvPanel } from "../AmvPanel";
import { Timeline } from "../timeline/Timeline";

type Icon = ComponentType<{ size?: number; strokeWidth?: number }>;
type Tab = { id: string; icon: Icon; label: Key; segs: PanelId[] };

/** The bottom tool bar: each tab opens a sheet; tabs with several tools get a segmented switch. */
const TABS: Tab[] = [
  { id: "edit", icon: Clapperboard, label: "mobile.tab.edit", segs: ["media", "effects", "format"] },
  { id: "audio", icon: Music2, label: "mobile.tab.audio", segs: ["music", "voice", "audio"] },
  { id: "text", icon: Type, label: "mobile.tab.text", segs: ["text"] },
  { id: "fx", icon: Sparkles, label: "mobile.tab.fx", segs: ["fx", "anim", "color"] },
  { id: "captions", icon: Captions, label: "mobile.tab.captions", segs: ["captions", "lyrics"] },
  { id: "beat", icon: AudioLines, label: "mobile.tab.beat", segs: ["amv"] },
];

const SEG_LABEL: Record<PanelId, Key> = {
  media: "rail.media",
  effects: "rail.effects",
  format: "mobile.format",
  music: "rail.music",
  voice: "rail.voice",
  audio: "rail.audio",
  text: "rail.text",
  fx: "fx.title",
  anim: "anim.title",
  color: "rail.color",
  captions: "rail.captions",
  lyrics: "rail.lyrics",
  amv: "rail.amv",
};

const tabOf = (panel: PanelId) => TABS.find((tab) => tab.segs.includes(panel)) ?? TABS[0];

/**
 * The phone editor (Android / touch-first): a minimal top bar, a large preview, a transport row,
 * a compact touch timeline and a bottom tool bar whose tabs open glass bottom sheets. It reuses
 * every desktop panel, so all features stay reachable; only the arrangement changes.
 */
export function MobileEditor() {
  const panel = useEditorUi((s) => s.panel);
  const solid = !!useCurrentTheme().tokens["--bg"];

  // The desktop opens with the media panel; the phone starts on a clean preview + timeline.
  useEffect(() => {
    useEditorUi.setState({ panel: null });
  }, []);

  return (
    <div className={`m-editor${panel ? " sheet-open" : ""}`}>
      <div className="hero m-hero">
        {!solid && <Ambient />}
        <TopBar />
        <div className="m-stage">
          <Preview />
        </div>
        <div className="m-dock">
          <Transport />
          <PinchZoom>
            <Timeline />
          </PinchZoom>
          <ToolBar />
          {panel && <Sheet panel={panel} />}
        </div>
      </div>
    </div>
  );
}

function TopBar() {
  const t = useT();
  const name = useProject((s) => s.project?.name ?? "");
  const saveState = useProject((s) => s.saveState);
  const hasClips = useProject((s) => (s.project?.clips.length ?? 0) > 0);
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);
  const rename = () => {
    const value = draft.trim();
    if (!value) return setDraft(name);
    if (value !== name) useProject.getState().commit((p) => ({ ...p, name: value }));
  };
  return (
    <header className="m-top">
      <button className="m-round" onClick={() => void leaveEditor()} aria-label={t("editor.back")}>
        <ArrowLeft size={20} strokeWidth={1.9} />
      </button>
      <label className="m-title">
        <i className={`save-dot ${saveState}`} />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={rename}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          aria-label={t("newProject.name")}
          spellCheck={false}
          maxLength={80}
        />
      </label>
      <button className="m-export" disabled={!hasClips} onClick={() => useEditorUi.setState({ exportOpen: true })}>
        <Share size={16} strokeWidth={2} />
        <span>{t("export.button")}</span>
      </button>
    </header>
  );
}

function Transport() {
  const t = useT();
  const playing = usePlayback((s) => s.playing);
  const fps = useProject((s) => s.project?.settings.fps ?? 30);
  const duration = useProject((s) => (s.project ? projectDuration(s.project) : 0));
  const canUndo = useProject((s) => s.past.length > 0);
  const canRedo = useProject((s) => s.future.length > 0);
  return (
    <div className="m-transport">
      <div className="m-tc">
        <TimeReadout fps={fps} duration={duration} />
      </div>
      <button className="m-play" onClick={() => engine.toggle()} aria-label={t("preview.play")}>
        {playing ? <Pause size={22} strokeWidth={2.2} /> : <Play size={22} strokeWidth={2.2} />}
      </button>
      <div className="m-history">
        <button className="m-round ghost" disabled={!canUndo} onClick={() => useProject.getState().undo()} aria-label={t("editor.undo")}>
          <Undo2 size={19} strokeWidth={1.9} />
        </button>
        <button className="m-round ghost" disabled={!canRedo} onClick={() => useProject.getState().redo()} aria-label={t("editor.redo")}>
          <Redo2 size={19} strokeWidth={1.9} />
        </button>
      </div>
    </div>
  );
}

/** Two-finger pinch on the timeline zooms it (the desktop's Ctrl + wheel). */
function PinchZoom({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let start: { d: number; pps: number } | null = null;
    const dist = (e: TouchEvent) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) start = { d: dist(e), pps: useEditorUi.getState().pxPerSec };
    };
    const onMove = (e: TouchEvent) => {
      if (!start || e.touches.length !== 2) return;
      e.preventDefault();
      useEditorUi.getState().setZoom(start.pps * (dist(e) / Math.max(1, start.d)));
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) start = null;
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, []);
  return (
    <div className="m-timeline" ref={ref}>
      {children}
    </div>
  );
}

/** The selected clip (one), with whether it is visual / text. */
function useSelected() {
  const project = useProject((s) => s.project);
  const selection = useProject((s) => s.selection);
  return useMemo(() => {
    if (!project || selection.length === 0) return null;
    const clip = selection.length === 1 ? project.clips.find((c) => c.id === selection[0]) : undefined;
    const media = clip && project.media.find((m) => m.id === clip.mediaId);
    return { count: selection.length, clip, text: !!clip?.text, visual: !!media && media.kind !== "audio" };
  }, [project, selection]);
}

function ToolBar() {
  const t = useT();
  const sel = useSelected();
  if (sel) {
    // CapCut-style: with a clip selected the bar turns into that clip's tools.
    const tools: { key: string; icon: Icon; label: Key; run: () => void; danger?: boolean }[] = [
      { key: "split", icon: Scissors, label: "inspector.split", run: splitAtPlayhead },
    ];
    if (sel.clip && !sel.text) tools.push({ key: "adjust", icon: SlidersHorizontal, label: "mobile.adjust", run: () => useEditorUi.setState({ panel: "effects" }) });
    if (sel.visual) tools.push({ key: "fx", icon: Sparkles, label: "fx.title", run: () => useEditorUi.setState({ panel: "fx" }) });
    if (sel.visual) tools.push({ key: "anim", icon: Wand2, label: "anim.title", run: () => useEditorUi.setState({ panel: "anim" }) });
    if (sel.visual && !sel.text) tools.push({ key: "color", icon: Palette, label: "rail.color", run: () => useEditorUi.setState({ panel: "color" }) });
    if (sel.text) tools.push({ key: "text", icon: Type, label: "mobile.editText", run: () => useEditorUi.setState({ panel: "text" }) });
    tools.push({ key: "delete", icon: Trash2, label: "inspector.delete", run: deleteSelection, danger: true });
    return (
      <nav className="m-toolbar context" aria-label={t("mobile.clipTools")}>
        <button className="m-tool close" onClick={() => useProject.getState().select([])} aria-label={t("rail.close")}>
          <span className="m-tool-icon">
            <X size={20} strokeWidth={2} />
          </span>
        </button>
        {tools.map(({ key, icon: I, label, run, danger }) => (
          <button key={key} className={`m-tool${danger ? " danger" : ""}`} onClick={run}>
            <span className="m-tool-icon">
              <I size={20} strokeWidth={1.8} />
            </span>
            <span className="m-tool-label">{t(label)}</span>
          </button>
        ))}
      </nav>
    );
  }
  return (
    <nav className="m-toolbar" aria-label="Tools">
      {TABS.map(({ id, icon: I, label, segs }) => (
        <button key={id} className="m-tool" onClick={() => useEditorUi.setState({ panel: segs[0] })}>
          <span className="m-tool-icon">
            <I size={20} strokeWidth={1.8} />
          </span>
          <span className="m-tool-label">{t(label)}</span>
        </button>
      ))}
    </nav>
  );
}

function Sheet({ panel }: { panel: PanelId }) {
  const t = useT();
  const tab = tabOf(panel);
  const close = () => useEditorUi.setState({ panel: null });
  const drag = useRef<{ y: number; id: number } | null>(null);
  return (
    <section className="side-panel m-sheet" aria-label={t(tab.label)}>
      <div
        className="m-sheet-head"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          drag.current = { y: e.clientY, id: e.pointerId };
        }}
        onPointerUp={(e) => {
          if (drag.current && e.clientY - drag.current.y > 48) close();
          drag.current = null;
        }}
      >
        <div className="m-sheet-row">
          {tab.segs.length > 1 ? (
            <div className="m-segs" role="tablist">
              {tab.segs.map((seg) => (
                <button key={seg} role="tab" aria-selected={seg === panel} className={`m-seg${seg === panel ? " active" : ""}`} onClick={() => useEditorUi.setState({ panel: seg })}>
                  {t(SEG_LABEL[seg])}
                </button>
              ))}
            </div>
          ) : (
            <h2>{t(tab.label)}</h2>
          )}
          <button className="m-round ghost" onClick={close} aria-label={t("rail.close")}>
            <ChevronDown size={22} strokeWidth={2} />
          </button>
        </div>
      </div>
      <div className="sp-body m-sheet-body">
        {panel === "media" && <MediaBin />}
        {panel === "effects" && <Inspector noFx />}
        {panel === "format" && <FormatPane />}
        {panel === "music" && <MusicPanel />}
        {panel === "voice" && <VoicePanel />}
        {panel === "audio" && <AudioPanel />}
        {panel === "text" && <TextPanel />}
        {panel === "fx" && <FxPane />}
        {panel === "anim" && <AnimPanel compact />}
        {panel === "color" && <ColorPanel />}
        {panel === "captions" && <SubtitlesPanel />}
        {panel === "lyrics" && <LyricsPanel />}
        {panel === "amv" && <AmvPanel />}
      </div>
    </section>
  );
}

/** Effect browser; picks the clip under the playhead if nothing is selected (layers need no clip). */
function FxPane() {
  const project = useProject((s) => s.project);
  const selection = useProject((s) => s.selection);
  const target = useMemo(() => {
    if (!project || selection.length !== 1) return null;
    const clip = project.clips.find((c) => c.id === selection[0]);
    const media = clip && project.media.find((m) => m.id === clip.mediaId);
    return clip && media && media.kind !== "audio" ? { clip, media } : null;
  }, [project, selection]);

  useEffect(() => {
    if (target) return;
    const p = useProject.getState().project;
    if (!p) return;
    const now = usePlayback.getState().time;
    const visual = new Set(p.media.filter((m) => m.kind !== "audio").map((m) => m.id));
    const order = new Map(p.tracks.map((tr, i) => [tr.id, i]));
    const hit = p.clips
      .filter((c) => visual.has(c.mediaId) && c.start <= now + 1e-6 && clipEnd(c) > now)
      .sort((a, b) => (order.get(a.trackId) ?? 0) - (order.get(b.trackId) ?? 0))[0];
    if (hit) useProject.getState().select([hit.id]);
    // Only on open: a later deselect must not snap back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <EffectsPanel compact />;
}

/** Project format: aspect and resolution as big tiles, plus timeline fit and settings. */
function FormatPane() {
  const t = useT();
  const settings = useProject((s) => s.project?.settings);
  if (!settings) return null;
  return (
    <div className="m-format">
      <h3 className="section-title">{t("bar.aspect")}</h3>
      <div className="m-tiles">
        {ASPECTS.map((a) => {
          const [w, h] = a.split(":").map(Number);
          return (
            <button key={a} className={`m-tile${a === settings.aspect ? " active" : ""}`} onClick={() => setFormat(a, settings.resolution)}>
              <span className="m-aspect" style={{ aspectRatio: `${w} / ${h}` }} />
              <span>{a}</span>
            </button>
          );
        })}
      </div>
      <h3 className="section-title">{t("bar.resolution")}</h3>
      <div className="m-tiles">
        {RESOLUTIONS.map((r) => (
          <button key={r} className={`m-tile${r === settings.resolution ? " active" : ""}`} onClick={() => setFormat(settings.aspect, r)}>
            <span>{r}</span>
          </button>
        ))}
      </div>
      <p className="m-note tnum">
        {settings.width}×{settings.height} · {settings.fps} fps
      </p>
      <div className="m-actions">
        <button className="btn" onClick={fitTimeline}>
          <Maximize2 size={16} />
          {t("bar.fitTimeline")}
        </button>
        <button className="btn" onClick={() => useRouter.getState().go("settings")}>
          <Settings2 size={16} />
          {t("editor.settings")}
        </button>
      </div>
    </div>
  );
}
