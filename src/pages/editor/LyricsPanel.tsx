// The Lyrics panel: song lines as karaoke-styled text clips on their own track. Lines come from
// an LRC / SRT file or are typed in and synced by tapping along with the music.
import { useEffect, useMemo, useRef, useState } from "react";
import { FileDown, FileUp, Hand, ListMusic, Pause, Play, Trash2, Undo2 } from "lucide-react";
import { useT } from "../../i18n";
import { api, isTauri, pickFiles, pickSavePath } from "../../lib/backend";
import { joinPath, messageOf, shortTime } from "../../lib/format";
import { engine } from "../../engine/playback";
import { projectDuration } from "../../project/ops";
import { clearSubtitles, cuesFromProject, guessLang, restyleSubtitles, setSubtitles, shiftLines, subtitleClips, type Cue } from "../../project/subtitles";
import type { Project } from "../../project/types";
import { usePlayback } from "../../store/playback";
import { useProject } from "../../store/project";
import { useSettings } from "../../store/settings";
import { loadAllFonts, PresetGrid } from "./TextPanel";
import { CueRow } from "./SubtitlesPanel";

export const LYRIC_PRESETS = ["lyric", "lyricGlow", "lyricBold", "lyricSerif", "captionPop", "neon"];
const LAST_LINE = 4;
const NUDGES = [-0.5, -0.1, 0.1, 0.5];

/** Where the song plays: the first music / audio clip, else the whole timeline. */
export function songRange(p: Project): { start: number; end: number } {
  const kinds = new Map(p.tracks.map((t) => [t.id, t.kind]));
  const song = p.clips
    .filter((c) => kinds.get(c.trackId) === "music" || kinds.get(c.trackId) === "audio")
    .sort((a, b) => a.start - b.start)[0];
  if (song) return { start: song.start, end: song.start + (song.out - song.in) / (song.speed || 1) };
  return { start: 0, end: Math.max(projectDuration(p), 1) };
}

/** Lines spread evenly over the song, weighted by length, as a starting point before fine-tuning. */
export function spreadLines(lines: string[], range: { start: number; end: number }): Cue[] {
  const weights = lines.map((l) => 2 + l.length);
  const total = weights.reduce((a, b) => a + b, 0);
  const span = range.end - range.start;
  let t = range.start;
  return lines.map((text, i) => {
    const d = (weights[i] / total) * span;
    const cue = { start: t, end: t + d, text };
    t += d;
    return cue;
  });
}

/** A last line left open-ended (LRC has no end stamps) stops with the song instead of running past it. */
export function fitToSong(cues: Cue[], range: { start: number; end: number }): Cue[] {
  return cues.map((c) => (c.end > range.end && c.start < range.end - 0.5 ? { ...c, end: range.end } : c));
}

export function splitLyrics(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l && !/^\[[^\]]*\]$/.test(l));
}

export function LyricsPanel() {
  const t = useT();
  const project = useProject((s) => s.project);
  const clips = project ? subtitleClips(project, "lyrics") : [];
  const [draft, setDraft] = useState("");
  const [ready, setReady] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [style, setStyle] = useState(() => (project && subtitleClips(project, "lyrics")[0]?.text?.preset) || "lyric");
  const [tapping, setTapping] = useState<{ lines: string[]; taps: number[] } | null>(null);
  const trackName = t("lyrics.track");

  useEffect(() => void loadAllFonts().then(() => setReady(true)), []);

  const apply = (cues: Cue[]) =>
    useProject.getState().commit((p) => setSubtitles(p, fitToSong(cues, songRange(p)), style, trackName, guessLang(cues), "lyrics"));

  const importFile = async () => {
    const [path] = await pickFiles([{ name: t("lyrics.files"), extensions: ["lrc", "srt", "vtt", "txt"] }], false);
    if (!path) return;
    try {
      const cues = await api.subtitleRead(path);
      apply(cues);
      setNote(t("subs.imported", { n: cues.length }));
    } catch (error) {
      setNote(messageOf(error));
    }
  };

  const exportFile = async () => {
    const p = useProject.getState().project;
    if (!p) return;
    const target = await pickSavePath(joinPath(useSettings.getState().outputDir, `${p.name}.lrc`), [{ name: "LRC", extensions: ["lrc"] }]);
    if (!target) return;
    try {
      const written = await api.subtitleWrite(target, cuesFromProject(p, "lyrics"));
      setNote(t("subs.saved", { path: written }));
    } catch (error) {
      setNote(messageOf(error));
    }
  };

  const lines = useMemo(() => splitLyrics(draft), [draft]);
  const editLines = () => setDraft(clips.map((c) => c.text!.content).join("\n"));

  const spread = () => {
    const p = useProject.getState().project;
    if (!p || !lines.length) return;
    apply(spreadLines(lines, songRange(p)));
    setNote(t("lyrics.spreadDone", { n: lines.length }));
  };

  const startTapping = () => {
    if (!lines.length) return;
    setNote(null);
    setTapping({ lines, taps: [] });
    engine.play();
  };

  const finish = (taps: number[], lineList: string[]) => {
    engine.pause();
    setTapping(null);
    if (!taps.length) return;
    const cues: Cue[] = [];
    for (let i = 0; i < Math.min(taps.length, lineList.length); i++) {
      const end = taps[i + 1] ?? taps[i] + LAST_LINE;
      cues.push({ start: taps[i], end, text: lineList[i] });
    }
    apply(cues);
    setNote(t("lyrics.synced", { n: cues.length }));
  };

  const restyle = (id: string) => {
    setStyle(id);
    if (clips.length) useProject.getState().commit((p) => restyleSubtitles(p, id, "lyrics"));
  };

  if (tapping) return <TapSync state={tapping} onChange={setTapping} onFinish={finish} />;

  return (
    <div className="sp-stack subs-panel lyrics-panel">
      {isTauri && (
        <button className="sp-action" onClick={() => void importFile()}>
          <span className="sp-action-icon">
            <FileUp />
          </span>
          <span>
            <b>{t("lyrics.import")}</b>
            <small>{t("lyrics.importText")}</small>
          </span>
        </button>
      )}

      <h3 className="section-title">{t("lyrics.write")}</h3>
      <textarea
        className="input text-content lyrics-draft"
        rows={5}
        value={draft}
        placeholder={t("lyrics.placeholder")}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        aria-label={t("lyrics.write")}
      />
      <div className="lyrics-actions">
        <button className="btn btn-sm btn-primary" onClick={startTapping} disabled={!lines.length}>
          <Hand />
          {t("lyrics.tap")}
        </button>
        <button className="btn btn-sm" onClick={spread} disabled={!lines.length}>
          <ListMusic />
          {t("lyrics.spread")}
        </button>
      </div>
      {(!!lines.length || !!clips.length) && (
        <div className="text-actions lyrics-meta">
          {!!lines.length && <span className="muted tnum lyrics-count">{t("lyrics.count", { n: lines.length })}</span>}
          <span className="spacer" />
          {!!clips.length && (
            <button className="link-btn" onClick={editLines}>
              {t("lyrics.editLines")}
            </button>
          )}
        </div>
      )}
      <p className="sp-note">{t("lyrics.tapHint")}</p>
      {note && <p className="sp-note">{note}</p>}

      <h3 className="section-title">{t("subs.style")}</h3>
      <PresetGrid ready={ready} active={style} onPick={restyle} ids={LYRIC_PRESETS} />

      {!!clips.length && (
        <>
          <h3 className="section-title">{t("lyrics.timing")}</h3>
          <div className="chip-group lyrics-nudge">
            {NUDGES.map((d) => (
              <button key={d} className="chip tnum" onClick={() => useProject.getState().commit((p) => shiftLines(p, d, "lyrics"))}>
                {d > 0 ? "+" : "−"}
                {Math.abs(d).toFixed(1)} s
              </button>
            ))}
          </div>
          <div className="text-actions">
            {isTauri && (
              <button className="btn btn-sm" onClick={() => void exportFile()}>
                <FileDown />
                {t("lyrics.export")}
              </button>
            )}
            <span className="spacer" />
            <button
              className="btn btn-sm btn-danger"
              onClick={() => useProject.getState().commit((p) => clearSubtitles(p, "lyrics"))}
              title={t("lyrics.clear")}
              aria-label={t("lyrics.clear")}
            >
              <Trash2 />
            </button>
          </div>
          <h3 className="section-title">{t("subs.lines", { n: clips.length })}</h3>
          <div className="sp-list subs-list">
            {clips.map((c) => (
              <CueRow key={c.id} clipId={c.id} start={c.start} content={c.text!.content} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Tap along: every tap (button, Space or Enter) starts the next line at the playhead. */
function TapSync({
  state,
  onChange,
  onFinish,
}: {
  state: { lines: string[]; taps: number[] };
  onChange: (s: { lines: string[]; taps: number[] }) => void;
  onFinish: (taps: number[], lines: string[]) => void;
}) {
  const t = useT();
  const time = usePlayback((s) => s.time);
  const playing = usePlayback((s) => s.playing);
  const ref = useRef(state);
  ref.current = state;
  const { lines, taps } = state;
  const index = taps.length;
  const done = index >= lines.length;

  const tap = () => {
    const s = ref.current;
    const now = engine.now();
    if (s.taps.length >= s.lines.length) {
      // One more tap after the last line marks where it ends.
      onFinish([...s.taps, now], s.lines);
      return;
    }
    onChange({ ...s, taps: [...s.taps, now] });
  };
  const undo = () => {
    const s = ref.current;
    if (!s.taps.length) return;
    const back = s.taps[s.taps.length - 1];
    onChange({ ...s, taps: s.taps.slice(0, -1) });
    engine.seek(Math.max(0, back - 2));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key;
      if (key === " " || key === "Enter") tap();
      else if (key === "Backspace") undo();
      else if (key === "Escape") onFinish(ref.current.taps, ref.current.lines);
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finalize = () => {
    // Taps beyond the last line already ended it; otherwise the last tapped line runs LAST_LINE s.
    onFinish(taps, lines);
  };

  return (
    <div className="sp-stack lyrics-tap">
      <div className="lyrics-tap-head">
        <span className="tnum">{shortTime(time)}</span>
        <span className="muted tnum">
          {Math.min(index, lines.length)} / {lines.length}
        </span>
      </div>
      <div className="lyrics-tap-lines">
        {index > 0 && <p className="prev">{lines[index - 1]}</p>}
        <p className="next">{done ? t("lyrics.tapEnd") : lines[index]}</p>
        {lines[index + 1] && <p className="after">{lines[index + 1]}</p>}
      </div>
      <button className="lyrics-tap-btn" onClick={tap}>
        <Hand />
        {done ? t("lyrics.tapLastEnd") : t("lyrics.tapNow")}
      </button>
      <div className="lyrics-actions three">
        <button className="btn btn-sm" onClick={() => (playing ? engine.pause() : engine.play())}>
          {playing ? <Pause /> : <Play />}
          {playing ? t("lyrics.pause") : t("lyrics.resume")}
        </button>
        <button className="btn btn-sm" onClick={undo} disabled={!taps.length}>
          <Undo2 />
          {t("lyrics.undoTap")}
        </button>
        <button className="btn btn-sm btn-primary" onClick={finalize}>
          {t("lyrics.finish")}
        </button>
      </div>
      <p className="sp-note">{t("lyrics.keys")}</p>
    </div>
  );
}
