// The Subtitles panel: on-device speech recognition into styled, editable text clips; SRT in/out.
import { useEffect, useState } from "react";
import { Captions, Check, FileDown, FileUp, Trash2, X } from "lucide-react";
import { Segmented, Switch } from "../../components/controls";
import { useT, type Key } from "../../i18n";
import { api, isTauri, pickFiles, pickSavePath, type SubtitleCue } from "../../lib/backend";
import { bytes, joinPath, messageOf, shortTime } from "../../lib/format";
import { engine } from "../../engine/playback";
import { updateText } from "../../project/ops";
import { clearSubtitles, cuesFromProject, guessLang, maxCharsFor, restyleSubtitles, setSubtitles, subtitleClips, SUBTITLE_PRESETS } from "../../project/subtitles";
import { useProject } from "../../store/project";
import { useSettings, type SubtitleModel } from "../../store/settings";
import { useSubtitleJob } from "../../store/subtitleJob";
import { loadAllFonts, PresetGrid } from "./TextPanel";

const LANGUAGES = ["auto", "tr", "en", "de", "fr", "es", "it", "pt", "ru", "ar", "ja", "ko", "zh", "nl", "pl", "uk", "az", "fa", "hi"];
const MODELS: SubtitleModel[] = ["tiny", "base", "small"];

type ModelInfo = { size: SubtitleModel; installed: boolean; downloadBytes: number };

export function SubtitlesPanel() {
  const t = useT();
  const settings = useSettings();
  const job = useSubtitleJob();
  const project = useProject((s) => s.project);
  const clips = project ? subtitleClips(project) : [];
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [music, setMusic] = useState(false);
  const [ready, setReady] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [allLanguages, setAllLanguages] = useState(false);

  const refresh = () => void api.subtitleModels().then(setModels).catch(() => setModels(null));
  useEffect(() => {
    if (isTauri) refresh();
    void loadAllFonts().then(() => setReady(true));
  }, []);
  useEffect(() => {
    if (!job.running && isTauri) refresh();
  }, [job.running]);

  const hasSound = !!project?.clips.some((c) => !c.text && project.media.find((m) => m.id === c.mediaId)?.hasAudio);
  const model = models?.find((m) => m.size === settings.subtitleModel);
  const trackName = t("subs.track");
  const apply = (cues: SubtitleCue[], lang?: string) =>
    useProject.getState().commit((p) => setSubtitles(p, cues, useSettings.getState().subtitleStyle, trackName, lang));

  const generate = () => {
    if (!project) return;
    setNote(null);
    void job.run(
      project,
      { model: settings.subtitleModel, language: settings.subtitleLanguage, includeMusic: music, maxChars: maxCharsFor(settings.subtitleStyle) },
      apply,
    );
  };

  const importFile = async () => {
    const [path] = await pickFiles([{ name: t("subs.files"), extensions: ["srt", "vtt"] }], false);
    if (!path) return;
    try {
      const cues = await api.subtitleRead(path);
      apply(cues, guessLang(cues));
      setNote(t("subs.imported", { n: cues.length }));
    } catch (error) {
      setNote(messageOf(error));
    }
  };

  const exportFile = async () => {
    const p = useProject.getState().project;
    if (!p) return;
    const target = await pickSavePath(joinPath(settings.outputDir, `${p.name}.srt`), [{ name: "SubRip", extensions: ["srt"] }]);
    if (!target) return;
    try {
      const written = await api.subtitleWrite(target, cuesFromProject(p));
      setNote(t("subs.saved", { path: written }));
    } catch (error) {
      setNote(messageOf(error));
    }
  };

  const restyle = (id: string) => {
    settings.update({ subtitleStyle: id });
    if (clips.length) useProject.getState().commit((p) => restyleSubtitles(p, id));
  };

  const langName = (code: string) => {
    if (code === "auto") return t("subs.auto");
    try {
      return new Intl.DisplayNames([settings.language], { type: "language" }).of(code) ?? code;
    } catch {
      return code;
    }
  };

  if (!isTauri) return <p className="sp-note">{t("subs.desktopOnly")}</p>;

  return (
    <div className="sp-stack subs-panel">
      <button className="sp-action" onClick={generate} disabled={job.running || !hasSound}>
        <span className="sp-action-icon">
          <Captions />
        </span>
        <span>
          <b>{t(clips.length ? "subs.regenerate" : "subs.generate")}</b>
          <small>{t("subs.generateText")}</small>
        </span>
      </button>

      {!hasSound && !job.running && <p className="sp-note">{t("subs.needMedia")}</p>}
      {job.running && (
        <div className="subs-job">
          <div className="subs-job-head">
            <span>{t(`subs.stage.${job.stage}` as Key)}</span>
            <span className="tnum">{Math.round(job.progress * 100)}%</span>
            <button className="mini-btn" onClick={job.cancel} title={t("common.cancel")} aria-label={t("common.cancel")}>
              <X />
            </button>
          </div>
          <div className="progress">
            <i style={{ width: `${Math.max(2, job.progress * 100)}%` }} />
          </div>
        </div>
      )}
      {!job.running && job.error && <p className="warn-text">{job.error}</p>}
      {!job.running && !job.error && job.last && !note && (
        <p className="sp-note">{t("subs.done", { n: job.last.cues, lang: langName(job.last.language) })}</p>
      )}
      {note && <p className="sp-note">{note}</p>}

      <h3 className="section-title">{t("subs.model")}</h3>
      <Segmented
        value={settings.subtitleModel}
        onChange={(v) => settings.update({ subtitleModel: v })}
        options={MODELS.map((m) => ({ value: m, label: t(`subs.model.${m}` as Key) }))}
      />
      {model && (
        <div className="subs-model">
          {model.installed ? (
            <>
              <Check />
              <span>{t("subs.installed", { size: bytes(model.downloadBytes) })}</span>
              <span className="spacer" />
              <button
                className="link-btn"
                disabled={job.running}
                onClick={() => void api.subtitleModelDelete(model.size).then(refresh)}
              >
                {t("subs.remove")}
              </button>
            </>
          ) : (
            <span>{t("subs.willDownload", { size: bytes(model.downloadBytes) })}</span>
          )}
        </div>
      )}

      <h3 className="section-title">{t("subs.language")}</h3>
      <div className="chip-group">
        {LANGUAGES.filter((code, i) => allLanguages || i < 5 || code === settings.subtitleLanguage).map((code) => (
          <button key={code} className={`chip${settings.subtitleLanguage === code ? " active" : ""}`} onClick={() => settings.update({ subtitleLanguage: code })}>
            {langName(code)}
          </button>
        ))}
        <button className="chip" onClick={() => setAllLanguages(!allLanguages)}>
          {allLanguages ? t("subs.fewer") : t("subs.more")}
        </button>
      </div>
      <label className="switch-row">
        <span>{t("subs.music")}</span>
        <Switch on={music} onChange={setMusic} label={t("subs.music")} />
      </label>

      <h3 className="section-title">{t("subs.style")}</h3>
      <PresetGrid ready={ready} active={settings.subtitleStyle} onPick={restyle} ids={SUBTITLE_PRESETS} />

      <div className="text-actions">
        <button className="btn btn-sm" onClick={() => void importFile()} disabled={job.running}>
          <FileUp />
          {t("subs.import")}
        </button>
        <button className="btn btn-sm" onClick={() => void exportFile()} disabled={!clips.length}>
          <FileDown />
          {t("subs.export")}
        </button>
        <span className="spacer" />
        {!!clips.length && (
          <button className="btn btn-sm btn-danger" onClick={() => useProject.getState().commit(clearSubtitles)} title={t("subs.clear")} aria-label={t("subs.clear")}>
            <Trash2 />
          </button>
        )}
      </div>

      {!!clips.length && (
        <>
          <h3 className="section-title">{t("subs.lines", { n: clips.length })}</h3>
          <div className="sp-list subs-list">
            {clips.map((c) => (
              <CueRow key={c.id} clipId={c.id} start={c.start} content={c.text!.content} />
            ))}
          </div>
        </>
      )}
      <p className="sp-note">{t("subs.hint")}</p>
    </div>
  );
}

export function CueRow({ clipId, start, content }: { clipId: string; start: number; content: string }) {
  const [value, setValue] = useState(content);
  useEffect(() => setValue(content), [content]);
  const save = () => {
    const next = value.replace(/\s+/g, " ").trim();
    if (next && next !== content) useProject.getState().commit((p) => updateText(p, clipId, (x) => ({ ...x, content: next })));
    else setValue(content);
  };
  const seek = () => {
    useProject.getState().select([clipId]);
    engine.seek(start + 0.05);
  };
  return (
    <div className="sp-row subs-row">
      <button className="subs-time tnum" onClick={seek}>
        {shortTime(start)}
      </button>
      <input
        className="subs-input"
        value={value}
        onFocus={seek}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setValue(content);
            (e.target as HTMLInputElement).blur();
          }
          e.stopPropagation();
        }}
      />
    </div>
  );
}
