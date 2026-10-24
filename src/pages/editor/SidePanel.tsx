import { useMemo } from "react";
import { Eye, EyeOff, FileAudio, Mic, Music2, Volume2, VolumeX, Wand2, X } from "lucide-react";
import { Slider } from "../../components/controls";
import { useT, type Key } from "../../i18n";
import { AUDIO_EXT, fileSrc, pickFiles } from "../../lib/backend";
import { shortTime } from "../../lib/format";
import { addToTimeline, importPaths } from "../../project/actions";
import { GRADE_IDS, gradeFilter, type Grade } from "../../project/grade";
import { clipDuration, updateClip } from "../../project/ops";
import type { Clip, Track } from "../../project/types";
import { useAssets } from "../../store/assets";
import { useEditorUi, type PanelId } from "../../store/editorUi";
import { usePlayback } from "../../store/playback";
import { useProject } from "../../store/project";
import { useRouter } from "../../store/router";
import { addTrack, toggleTrack } from "./commands";
import { Inspector } from "./Inspector";
import { EffectsPanel } from "./EffectBrowser";
import { TextPanel } from "./TextPanel";
import { LyricsPanel } from "./LyricsPanel";
import { AmvPanel } from "./AmvPanel";
import { SubtitlesPanel } from "./SubtitlesPanel";
import { MediaBin } from "./MediaBin";
import { useSettings } from "../../store/settings";
import { panelResizeDown } from "./layout";

const TITLES: Record<PanelId, Key> = {
  media: "rail.media",
  voice: "voice.title",
  music: "music.panelTitle",
  effects: "effects.title",
  audio: "audio.title",
  color: "grade.title",
  text: "text.title",
  captions: "subs.title",
  lyrics: "lyrics.title",
  amv: "amv.title",
  fx: "fx.title",
  format: "mobile.format",
};

/** Floating rounded panel on the right of the preview; the rail picks its content. */
export function SidePanel() {
  const t = useT();
  const panel = useEditorUi((s) => s.panel);
  if (!panel) return null;
  return (
    <aside className="side-panel" aria-label={t(TITLES[panel])}>
      <div className="sp-resize" onPointerDown={panelResizeDown} onDoubleClick={() => useSettings.getState().update({ panelWidth: 0 })} title={t("layout.resizePanel")} aria-hidden />
      <div className="sp-head">
        <h2>{t(TITLES[panel])}</h2>
        <button className="sp-close" onClick={() => useEditorUi.setState({ panel: null })} title={t("rail.close")} aria-label={t("rail.close")}>
          <X size={13} />
        </button>
      </div>
      <div className="sp-body">
        {panel === "media" && <MediaBin />}
        {panel === "effects" && <Inspector />}
        {panel === "fx" && <EffectsPanel />}
        {panel === "voice" && <VoicePanel />}
        {panel === "music" && <MusicPanel />}
        {panel === "audio" && <AudioPanel />}
        {panel === "color" && <ColorPanel />}
        {panel === "text" && <TextPanel />}
        {panel === "captions" && <SubtitlesPanel />}
        {panel === "lyrics" && <LyricsPanel />}
        {panel === "amv" && <AmvPanel />}
      </div>
    </aside>
  );
}

/** The selected clip and its media, when exactly one clip is selected. */
function useSelectedClip() {
  const project = useProject((s) => s.project);
  const selection = useProject((s) => s.selection);
  return useMemo(() => {
    if (!project || selection.length !== 1) return null;
    const clip = project.clips.find((c) => c.id === selection[0]);
    const media = clip && project.media.find((m) => m.id === clip.mediaId);
    return clip && media ? { clip, media } : null;
  }, [project, selection]);
}

export function VoicePanel() {
  const t = useT();
  const sel = useSelectedClip();
  const usable = sel && sel.media.kind === "video" && sel.media.hasAudio ? sel.media : null;
  return (
    <div className="sp-stack">
      <div className="sp-hero-icon">
        <Mic />
      </div>
      <p className="sp-text">{t("voice.text")}</p>
      {usable ? (
        <button className="btn btn-primary btn-block" onClick={() => useRouter.getState().openMusicSwap(usable.path)}>
          <Wand2 />
          {t("voice.useClip")}
        </button>
      ) : (
        <p className="sp-note">{t("voice.noClip")}</p>
      )}
      <button className="btn btn-block" onClick={() => useRouter.getState().openMusicSwap(null)}>
        {t("voice.pick")}
      </button>
    </div>
  );
}

async function addLocalMusic() {
  const paths = await pickFiles([{ name: "Audio", extensions: AUDIO_EXT }], true);
  if (!paths.length) return;
  const items = await importPaths(paths);
  if (!items.length) return;
  let music = useProject.getState().project?.tracks.find((tr) => tr.kind === "music");
  if (!music) {
    addTrack("music");
    music = useProject.getState().project?.tracks.find((tr) => tr.kind === "music");
  }
  let at = usePlayback.getState().time;
  for (const media of items) {
    const id = addToTimeline(media, at, music?.id);
    const clip = useProject.getState().project?.clips.find((c) => c.id === id);
    if (clip) at = clip.start + clipDuration(clip);
  }
}

export function MusicPanel() {
  const t = useT();
  const sel = useSelectedClip();
  const mediaList = useProject((s) => s.project?.media);
  const audio = useMemo(() => mediaList?.filter((m) => m.kind === "audio"), [mediaList]);
  return (
    <div className="sp-stack">
      <button className="sp-action" onClick={() => void addLocalMusic()}>
        <span className="sp-action-icon">
          <FileAudio />
        </span>
        <span>
          <b>{t("music.addLocal")}</b>
          <small>{t("music.addLocalText")}</small>
        </span>
      </button>
      <button
        className="sp-action"
        onClick={() => useRouter.getState().openMusicSwap(sel?.media.kind === "video" && sel.media.hasAudio ? sel.media.path : null)}
      >
        <span className="sp-action-icon">
          <Music2 />
        </span>
        <span>
          <b>{t("music.swapTitle")}</b>
          <small>{t("music.swapText")}</small>
        </span>
      </button>
      {!!audio?.length && (
        <>
          <h3 className="section-title">{t("music.inProject")}</h3>
          <div className="sp-list">
            {audio.map((m) => (
              <button key={m.id} className="sp-row" onDoubleClick={() => addToTimeline(m, usePlayback.getState().time)} onClick={() => useProject.getState().selectMedia(m.id)} title={m.path}>
                <Music2 />
                <span className="sp-row-name">{m.name}</span>
                <span className="muted tnum">{shortTime(m.duration)}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function AudioPanel() {
  const t = useT();
  const tracks = useProject((s) => s.project?.tracks) ?? NO_TRACKS;
  const sel = useSelectedClip();
  return (
    <div className="sp-stack">
      <h3 className="section-title">{t("audio.tracks")}</h3>
      <div className="sp-list">
        {tracks.map((track) => (
          <div key={track.id} className={`sp-row track-row kind-${track.kind}${track.muted ? " off" : ""}`}>
            <i className={`tone-dot kind-${track.kind}`} />
            <span className="sp-row-name">{track.name}</span>
            {(track.kind === "video" || track.kind === "text") && (
              <button className="mini-btn" onClick={() => toggleTrack(track.id, "hidden")} aria-label={t(track.hidden ? "track.show" : "track.hide")} title={t(track.hidden ? "track.show" : "track.hide")}>
                {track.hidden ? <EyeOff /> : <Eye />}
              </button>
            )}
            {track.kind !== "text" && (
              <button className="mini-btn" onClick={() => toggleTrack(track.id, "muted")} aria-label={t(track.muted ? "track.unmute" : "track.mute")} title={t(track.muted ? "track.unmute" : "track.mute")}>
                {track.muted ? <VolumeX /> : <Volume2 />}
              </button>
            )}
          </div>
        ))}
      </div>
      <h3 className="section-title">{t("audio.clip")}</h3>
      {sel && sel.media.hasAudio ? <ClipAudio clip={sel.clip} /> : <p className="sp-note">{t("audio.noClip")}</p>}
    </div>
  );
}

function ClipAudio({ clip }: { clip: Clip }) {
  const t = useT();
  const { beginGesture, endGesture, transient } = useProject.getState();
  const set = (patch: Partial<Clip>) => transient((p) => updateClip(p, clip.id, patch));
  const maxFade = Math.max(0, Math.min(10, clipDuration(clip) / 2));
  const g = { onStart: beginGesture, onEnd: endGesture };
  return (
    <div className="sp-stack tight">
      <Slider label={t("inspector.volume")} value={clip.volume} min={0} max={2} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ volume: v })} {...g} />
      <Slider label={t("inspector.fadeIn")} value={Math.min(clip.fadeIn, maxFade)} min={0} max={maxFade} step={0.05} format={(v) => `${v.toFixed(2)} s`} onChange={(v) => set({ fadeIn: v })} {...g} />
      <Slider label={t("inspector.fadeOut")} value={Math.min(clip.fadeOut, maxFade)} min={0} max={maxFade} step={0.05} format={(v) => `${v.toFixed(2)} s`} onChange={(v) => set({ fadeOut: v })} {...g} />
    </div>
  );
}

export function setGrade(grade: Grade) {
  useProject.getState().commit((p) => ({ ...p, settings: { ...p.settings, grade: grade === "none" ? undefined : grade } }));
}

export function ColorPanel() {
  const t = useT();
  const grade = useProject((s) => s.project?.settings.grade ?? "none");
  const thumb = usePosterThumb();
  return (
    <div className="sp-stack">
      <div className="grade-grid">
        {GRADE_IDS.map((id) => (
          <button key={id} className={`grade-card${grade === id ? " active" : ""}`} onClick={() => setGrade(id)} aria-pressed={grade === id}>
            <span className="grade-swatch" style={{ filter: gradeFilter(id), backgroundImage: thumb ? `url("${thumb}")` : undefined }} />
            <span>{t(`grade.${id}`)}</span>
          </button>
        ))}
      </div>
      <p className="sp-note">{t("grade.hint")}</p>
    </div>
  );
}

/** Thumbnail of the first visual clip (or any visual media) for swatches and the ambient backdrop. */
export function usePosterThumb(): string | null {
  const path = useProject((s) => {
    const p = s.project;
    if (!p) return null;
    const visual = new Set(p.media.filter((m) => m.kind !== "audio").map((m) => m.id));
    const sel = p.clips.find((c) => s.selection.includes(c.id) && visual.has(c.mediaId));
    const first = sel ?? [...p.clips].sort((a, b) => a.start - b.start).find((c) => visual.has(c.mediaId));
    const mediaId = first?.mediaId ?? p.media.find((m) => visual.has(m.id))?.id;
    return p.media.find((m) => m.id === mediaId)?.path ?? null;
  });
  const thumb = useAssets((s) => (path ? s.assets[path]?.thumb : undefined));
  return thumb ? fileSrc(thumb) : null;
}

const NO_TRACKS: Track[] = [];
