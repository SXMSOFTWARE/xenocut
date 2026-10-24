import { Layers, Scissors, SlidersHorizontal, Sparkles, Trash2, Type } from "lucide-react";
import { Slider } from "../../components/controls";
import { useT } from "../../i18n";
import { shortTime, timecode } from "../../lib/format";
import { clipDuration, clipEnd, isEffectLayer, maxSourceOut, MIN_CLIP_SECONDS, projectDuration, updateClip } from "../../project/ops";
import type { Clip, MediaItem, Project } from "../../project/types";
import { useProject } from "../../store/project";
import { useEditorUi } from "../../store/editorUi";
import { deleteSelection, splitAtPlayhead } from "./commands";
import { EffectLayerInfo, EffectStack } from "./EffectBrowser";


export function Inspector({ noFx = false }: { noFx?: boolean } = {}) {
  const t = useT();
  const project = useProject((s) => s.project);
  const selection = useProject((s) => s.selection);
  const selectedMediaId = useProject((s) => s.selectedMediaId);
  if (!project) return null;
  const clip = selection.length === 1 ? project.clips.find((c) => c.id === selection[0]) : undefined;
  const media = clip
    ? project.media.find((m) => m.id === clip.mediaId)
    : selectedMediaId
      ? project.media.find((m) => m.id === selectedMediaId)
      : undefined;

  return (
    <div className="inspector">
      <div className="inspector-body">
        {clip?.text ? (
          <div className="inspector-note">
            <p>{t("text.inInspector")}</p>
            <button className="btn btn-sm" onClick={() => useEditorUi.setState({ panel: "text" })}>
              <Type />
              {t("text.openPanel")}
            </button>
          </div>
        ) : clip && isEffectLayer(clip) ? (
          <div className="inspector-stack">
            <EffectLayerInfo clip={clip} />
            <EffectsSection clip={clip} />
            <div className="inspector-actions">
              <button className="btn btn-sm btn-danger" onClick={deleteSelection}>
                <Trash2 />
                {t("inspector.delete")}
              </button>
            </div>
          </div>
        ) : clip && media ? (
          <ClipInspector project={project} clip={clip} media={media} noFx={noFx} />
        ) : selection.length > 1 ? (
          <div className="inspector-note">
            <p>{t("inspector.multi", { n: selection.length })}</p>
            <button className="btn btn-danger btn-sm" onClick={deleteSelection}>
              <Trash2 />
              {t("inspector.delete")}
            </button>
          </div>
        ) : media ? (
          <MediaInfo media={media} />
        ) : (
          <ProjectInfo project={project} />
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="kv">
      <span>{label}</span>
      <b className="tnum">{value}</b>
    </div>
  );
}

function ClipInspector({ project, clip, media, noFx }: { project: Project; clip: Clip; media: MediaItem; noFx?: boolean }) {
  const t = useT();
  const { beginGesture, endGesture, transient } = useProject.getState();
  const set = (patch: Partial<Clip>) => transient((p) => updateClip(p, clip.id, patch));
  const fps = project.settings.fps;
  const duration = clipDuration(clip);
  const next = project.clips
    .filter((c) => c.trackId === clip.trackId && c.id !== clip.id && c.start >= clipEnd(clip) - 1e-6)
    .reduce((min, c) => Math.min(min, c.start), Number.POSITIVE_INFINITY);
  const room = next - clip.start; // max timeline duration before hitting the next clip
  const sourceMax = maxSourceOut(media);
  const visual = media.kind !== "audio";
  const audible = media.hasAudio;
  const maxFade = Math.max(0, Math.min(10, duration / 2));
  const minSpeed = Math.max(0.25, Number.isFinite(room) ? (clip.out - clip.in) / room : 0.25);
  const gesture = { onStart: beginGesture, onEnd: endGesture };

  return (
    <div className="inspector-stack">
      <div className="inspector-title">
        <span className={`kind-dot kind-${media.kind}`} />
        <div>
          <b title={media.path}>{media.name}</b>
          <small className="muted">{t(`kind.${media.kind}`)}</small>
        </div>
      </div>

      <div className="kv-group">
        <Row label={t("inspector.start")} value={timecode(clip.start, fps)} />
        <Row label={t("inspector.duration")} value={timecode(duration, fps)} />
        <Row label={t("inspector.source")} value={`${shortTime(clip.in)} – ${shortTime(clip.out)}`} />
      </div>

      <div className="inspector-section">
        <h3 className="section-title">{t("inspector.trim")}</h3>
        <Slider
          label={t("inspector.trimIn")}
          value={clip.in}
          min={0}
          max={Math.max(0, clip.out - MIN_CLIP_SECONDS * clip.speed)}
          step={1 / fps}
          format={shortTime}
          onChange={(v) => set({ in: v })}
          {...gesture}
        />
        <Slider
          label={t("inspector.trimOut")}
          value={clip.out}
          min={clip.in + MIN_CLIP_SECONDS * clip.speed}
          max={Math.min(sourceMax, Number.isFinite(room) ? clip.in + room * clip.speed : sourceMax)}
          step={1 / fps}
          format={shortTime}
          onChange={(v) => set({ out: v })}
          {...gesture}
        />
      </div>

      <div className="inspector-section">
        <h3 className="section-title">{t("inspector.playback")}</h3>
        {media.kind !== "image" && (
          <Slider
            label={t("inspector.speed")}
            value={clip.speed}
            min={Math.min(minSpeed, 4)}
            max={4}
            step={0.05}
            format={(v) => `${v.toFixed(2)}×`}
            onChange={(v) => set({ speed: v })}
            {...gesture}
          />
        )}
        {audible && (
          <Slider
            label={t("inspector.volume")}
            value={clip.volume}
            min={0}
            max={2}
            step={0.01}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => set({ volume: v })}
            {...gesture}
          />
        )}
        {visual && (
          <Slider
            label={t("inspector.opacity")}
            value={clip.opacity}
            min={0}
            max={1}
            step={0.01}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => set({ opacity: v })}
            {...gesture}
          />
        )}
      </div>

      {visual && !noFx && <EffectsSection clip={clip} />}

      <div className="inspector-section">
        <h3 className="section-title">{t("inspector.fades")}</h3>
        <Slider
          label={t("inspector.fadeIn")}
          value={Math.min(clip.fadeIn, maxFade)}
          min={0}
          max={maxFade}
          step={0.05}
          format={(v) => `${v.toFixed(2)} s`}
          onChange={(v) => set({ fadeIn: v })}
          {...gesture}
        />
        <Slider
          label={t("inspector.fadeOut")}
          value={Math.min(clip.fadeOut, maxFade)}
          min={0}
          max={maxFade}
          step={0.05}
          format={(v) => `${v.toFixed(2)} s`}
          onChange={(v) => set({ fadeOut: v })}
          {...gesture}
        />
      </div>

      <div className="inspector-actions">
        <button className="btn btn-sm" onClick={splitAtPlayhead}>
          <Scissors />
          {t("inspector.split")}
          <span className="kbd">S</span>
        </button>
        <button className="btn btn-sm btn-danger" onClick={deleteSelection}>
          <Trash2 />
          {t("inspector.delete")}
        </button>
      </div>
    </div>
  );
}

/** Applied effects of a clip / layer, plus the way into the effect browser. */
export function EffectsSection({ clip, browse = true }: { clip: Clip; browse?: boolean }) {
  const t = useT();
  const commit = useProject((s) => s.commit);
  const effects = clip.effects ?? [];
  const layer = isEffectLayer(clip);
  const visualCount = useProject((s) => {
    const p = s.project;
    if (!p) return 0;
    const visual = new Set(p.media.filter((m) => m.kind !== "audio").map((m) => m.id));
    return p.clips.filter((c) => visual.has(c.mediaId)).length;
  });
  const applyToAll = () =>
    commit((p) => {
      const visual = new Set(p.media.filter((m) => m.kind !== "audio").map((m) => m.id));
      return { ...p, clips: p.clips.map((c) => (visual.has(c.mediaId) ? { ...c, effects: effects.length ? effects.map((e) => ({ ...e })) : undefined } : c)) };
    });
  return (
    <div className="inspector-section fx-section">
      <h3 className="section-title">
        {t("fx.title")}
        {effects.length > 0 && !layer && (
          <button className="link-btn" onClick={() => commit((p) => updateClip(p, clip.id, { effects: undefined }))}>
            {t("fx.reset")}
          </button>
        )}
      </h3>
      <EffectStack clip={clip} />
      {browse && (
        <button className="btn btn-sm btn-block" onClick={() => useEditorUi.setState({ panel: "fx" })}>
          <Sparkles />
          {t("fx.browse")}
        </button>
      )}
      {!layer && visualCount > 1 && effects.length > 0 && (
        <button className="btn btn-sm btn-block fx-apply-all" onClick={applyToAll}>
          <Layers />
          {t("preset.applyAll")}
        </button>
      )}
    </div>
  );
}

function MediaInfo({ media }: { media: MediaItem }) {
  const t = useT();
  return (
    <div className="inspector-stack">
      <div className="inspector-title">
        <span className={`kind-dot kind-${media.kind}`} />
        <div>
          <b title={media.path}>{media.name}</b>
          <small className="muted">{t(`kind.${media.kind}`)}</small>
        </div>
      </div>
      <div className="kv-group">
        {media.duration > 0 && <Row label={t("inspector.duration")} value={shortTime(media.duration)} />}
        {media.width > 0 && <Row label={t("inspector.resolution")} value={`${media.width}×${media.height}`} />}
        {media.fps > 0 && <Row label="FPS" value={media.fps.toFixed(media.fps % 1 ? 2 : 0)} />}
        <Row label={t("inspector.audio")} value={media.hasAudio ? t("common.yes") : t("common.no")} />
      </div>
      <p className="path-note" title={media.path}>
        {media.path}
      </p>
      <p className="muted small">{t("inspector.mediaHint")}</p>
    </div>
  );
}

function ProjectInfo({ project }: { project: Project }) {
  const t = useT();
  const s = project.settings;
  return (
    <div className="inspector-stack">
      <div className="inspector-empty empty">
        <SlidersHorizontal />
        <span>{t("inspector.nothing")}</span>
      </div>
      <h3 className="section-title">{t("inspector.project")}</h3>
      <div className="kv-group">
        <Row label={t("newProject.aspect")} value={s.aspect} />
        <Row label={t("inspector.resolution")} value={`${s.width}×${s.height}`} />
        <Row label="FPS" value={String(s.fps)} />
        <Row label={t("inspector.duration")} value={timecode(projectDuration(project), s.fps)} />
        <Row label={t("inspector.clips")} value={String(project.clips.length)} />
      </div>
      <div className="shortcut-list">
        <h3 className="section-title">{t("inspector.shortcuts")}</h3>
        {(
          [
            ["Space", "shortcut.play"],
            ["J / K / L", "shortcut.jkl"],
            ["← →", "shortcut.frame"],
            ["S", "shortcut.split"],
            ["Del", "shortcut.delete"],
            ["Ctrl+Z", "shortcut.undo"],
            ["Ctrl+S", "shortcut.save"],
            ["Ctrl+Wheel", "shortcut.zoom"],
          ] as const
        ).map(([k, label]) => (
          <div className="kv" key={k}>
            <span>{t(label)}</span>
            <span className="kbd">{k}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
