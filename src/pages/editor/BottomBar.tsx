import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { Check, ChevronDown, Share, RectangleVertical, RectangleHorizontal, Square, Star, Timer, SlidersHorizontal, PanelBottomClose, PanelBottomOpen, Pause, Play, Redo2, Settings2, SkipBack, SkipForward, Undo2 } from "lucide-react";
import { engine } from "../../engine/playback";
import { useT } from "../../i18n";
import { shortTime, timecode } from "../../lib/format";
import { GRADE_IDS } from "../../project/grade";
import { clipDuration, isFree, maxSourceOut, projectDuration, settingsFor, updateClip } from "../../project/ops";
import type { Aspect, Resolution } from "../../project/types";
import { useEditorUi } from "../../store/editorUi";
import { usePlayback } from "../../store/playback";
import { useProject } from "../../store/project";
import { useRouter } from "../../store/router";
import { toast } from "../../store/toast";
import { fitTimeline } from "./commands";
import { setGrade } from "./SidePanel";

const ASPECTS: Aspect[] = ["16:9", "9:16", "1:1", "4:5"];
const RESOLUTIONS: Resolution[] = ["720p", "1080p", "1440p", "4K"];
const LENGTHS = [3, 5, 10, 15, 30];

/** Transport · settings chips · layout/settings/export — the reference's bottom bar. */
export function BottomBar() {
  const t = useT();
  const playing = usePlayback((s) => s.playing);
  const settings = useProject((s) => s.project!.settings);
  const duration = useProject((s) => (s.project ? projectDuration(s.project) : 0));
  const canUndo = useProject((s) => s.past.length > 0);
  const canRedo = useProject((s) => s.future.length > 0);
  const hasClips = useProject((s) => (s.project?.clips.length ?? 0) > 0);
  const collapsed = useEditorUi((s) => s.timelineCollapsed);
  const grade = settings.grade ?? "none";

  const setFormat = (aspect: Aspect, resolution: Resolution) =>
    useProject.getState().commit((p) => ({ ...p, settings: { ...settingsFor(aspect, resolution, p.settings.fps), grade: p.settings.grade } }));

  return (
    <footer className="bottom-bar">
      <div className="bb-left">
        <button className="round-btn" onClick={() => engine.seek(0)} title={t("preview.start")} aria-label={t("preview.start")}>
          <SkipBack size={14} strokeWidth={1.9} />
        </button>
        <button className="round-btn play" onClick={() => engine.toggle()} title={`${t("preview.play")} (Space)`} aria-label={t("preview.play")}>
          {playing ? <Pause size={14} strokeWidth={2.2} /> : <Play size={14} strokeWidth={2.2} />}
        </button>
        <button className="round-btn" onClick={() => engine.seek(engine.duration())} title={t("preview.end")} aria-label={t("preview.end")}>
          <SkipForward size={14} strokeWidth={1.9} />
        </button>
        <TimeReadout fps={settings.fps} duration={duration} />
      </div>

      <div className="bb-center">
        <div className="settings-pill">
          <ChipMenu icon={settings.aspect === "16:9" ? RectangleHorizontal : settings.aspect === "1:1" ? Square : RectangleVertical} label={settings.aspect} title={t("bar.aspect")}>
            {(close) =>
              ASPECTS.map((a) => (
                <MenuItem key={a} active={a === settings.aspect} onClick={() => (setFormat(a, settings.resolution), close())}>
                  {a}
                </MenuItem>
              ))
            }
          </ChipMenu>
          <ChipMenu icon={Star} label={settings.resolution} title={`${t("bar.resolution")} · ${settings.width}×${settings.height}`}>
            {(close) =>
              RESOLUTIONS.map((r) => (
                <MenuItem key={r} active={r === settings.resolution} onClick={() => (setFormat(settings.aspect, r), close())}>
                  {r}
                </MenuItem>
              ))
            }
          </ChipMenu>
          <ChipMenu icon={Timer} label={shortTime(duration)} title={t("bar.duration")} className="hide-narrow">
            {(close) => <DurationMenu close={close} />}
          </ChipMenu>
          <ChipMenu icon={SlidersHorizontal} label={t(`grade.${grade}`)} title={t("bar.grade")}>
            {(close) =>
              GRADE_IDS.map((g) => (
                <MenuItem key={g} active={g === grade} onClick={() => (setGrade(g), close())}>
                  {t(`grade.${g}`)}
                </MenuItem>
              ))
            }
          </ChipMenu>
        </div>
      </div>

      <div className="bb-right">
        <button className="round-btn hide-narrow" disabled={!canUndo} onClick={() => useProject.getState().undo()} title={`${t("editor.undo")} (Ctrl+Z)`} aria-label={t("editor.undo")}>
          <Undo2 size={14} strokeWidth={1.9} />
        </button>
        <button className="round-btn hide-narrow" disabled={!canRedo} onClick={() => useProject.getState().redo()} title={`${t("editor.redo")} (Ctrl+Shift+Z)`} aria-label={t("editor.redo")}>
          <Redo2 size={14} strokeWidth={1.9} />
        </button>
        <button className="round-btn" onClick={() => useEditorUi.setState({ timelineCollapsed: !collapsed })} title={t("editor.layout")} aria-label={t("editor.layout")} aria-pressed={collapsed}>
          {collapsed ? <PanelBottomOpen size={14} strokeWidth={1.9} /> : <PanelBottomClose size={14} strokeWidth={1.9} />}
        </button>
        <button className="round-btn" onClick={() => useRouter.getState().go("settings")} title={t("editor.settings")} aria-label={t("editor.settings")}>
          <Settings2 size={14} strokeWidth={1.9} />
        </button>
        <button className="export-btn" disabled={!hasClips} onClick={() => useEditorUi.setState({ exportOpen: true })} title={`${t("export.button")} (Ctrl+E)`}>
          <Share size={14} strokeWidth={2} />
          <span>{t("export.button")}</span>
        </button>
      </div>
    </footer>
  );
}

function DurationMenu({ close }: { close: () => void }) {
  const t = useT();
  const sel = useProject((s) => {
    if (!s.project || s.selection.length !== 1) return null;
    return s.project.clips.find((c) => c.id === s.selection[0]) ?? null;
  });
  const setLength = (seconds: number) => {
    const { project, commit } = useProject.getState();
    if (!project || !sel) return;
    const media = project.media.find((m) => m.id === sel.mediaId);
    if (!media) return;
    const out = Math.min(maxSourceOut(media), sel.in + seconds * sel.speed);
    const next = { ...sel, out };
    if (!isFree(project, sel.trackId, sel.start, clipDuration(next), new Set([sel.id]))) {
      toast(t("bar.clipLength"), "error");
      return;
    }
    commit((p) => updateClip(p, sel.id, { out }));
    close();
  };
  return (
    <>
      <div className="menu-label">{sel ? `${t("bar.clipLength")} · ${shortTime(clipDuration(sel))}` : t("bar.selectClip")}</div>
      {LENGTHS.map((s) => (
        <MenuItem key={s} disabled={!sel} onClick={() => setLength(s)}>
          {s} s
        </MenuItem>
      ))}
      <div className="menu-sep" />
      <MenuItem onClick={() => (fitTimeline(), close())}>{t("bar.fitTimeline")}</MenuItem>
    </>
  );
}

function ChipMenu({ icon: Icon, label, title, className, children }: { icon: ComponentType<{ size?: number; strokeWidth?: number }>; label: string; title: string; className?: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className={`chip-menu${className ? ` ${className}` : ""}`} ref={ref}>
      <button className={`bar-chip${open ? " open" : ""}`} onClick={() => setOpen(!open)} title={title} aria-haspopup="menu" aria-expanded={open}>
        <Icon size={13} strokeWidth={1.9} />
        <span className="tnum">{label}</span>
        <ChevronDown className="chev" size={10} strokeWidth={2} />
      </button>
      {open && (
        <div className="menu" role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function MenuItem({ active, disabled, onClick, children }: { active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button role="menuitemradio" aria-checked={!!active} className={`menu-item${active ? " active" : ""}`} disabled={disabled} onClick={onClick}>
      <span>{children}</span>
      {active && <Check size={12} strokeWidth={2.2} />}
    </button>
  );
}

/** Updates through a ref: the playhead never re-renders React components while playing. */
function TimeReadout({ fps, duration }: { fps: number; duration: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const paint = (time: number) => {
      if (ref.current) ref.current.textContent = timecode(time, fps);
    };
    paint(usePlayback.getState().time);
    return usePlayback.subscribe((s, prev) => s.time !== prev.time && paint(s.time));
  }, [fps]);
  return (
    <span className="timecode tnum" title={`${timecode(duration, fps)}`}>
      <span ref={ref} />
    </span>
  );
}
