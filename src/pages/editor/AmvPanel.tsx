// The AMV panel: detect the song's beats, then cut, re-cut into a montage, or add hits on them.
import { useEffect, useMemo, useState } from "react";
import { AudioLines, Clapperboard, Eraser, Loader2, RefreshCw, Scissors, Zap } from "lucide-react";
import { Segmented, Slider, Switch } from "../../components/controls";
import { useT } from "../../i18n";
import { messageOf } from "../../lib/format";
import { addHits, beatCuts, beatMontage, clearHits, cutOnBeats, mainVideoTrack, timelineBeats, type Hits } from "../../project/beats";
import { HIT_KINDS } from "../../project/effects";
import { clipEnd } from "../../project/ops";
import { songBeats, useBeats } from "../../store/beats";
import { useProject } from "../../store/project";

const EVERY = [1, 2, 4, 8] as const;

export function AmvPanel() {
  const t = useT();
  const project = useProject((s) => s.project);
  const grids = useBeats((s) => s.grids);
  const busy = useBeats((s) => s.busy);
  const show = useBeats((s) => s.show);
  const [every, setEvery] = useState<number>(2);
  const [mute, setMute] = useState(true);
  const [hits, setHits] = useState<Hits>({ flash: 0.6, punch: 0.5, hitShake: 0 });
  const [note, setNote] = useState<string | null>(null);
  const song = songBeats(project, grids);
  const songName = song && project?.media.find((m) => m.id === song.clip.mediaId)?.name;
  const grid = song?.grid ?? null;
  const track = project ? mainVideoTrack(project) : undefined;
  const hasVideo = !!project && !!track && project.clips.some((c) => c.trackId === track.id && !c.text);
  // The montage rebuilds the main track, so it can't run when the song is that track's own audio.
  const songOnMain = !!song && song.clip.trackId === track?.id;
  const hitCount = project?.clips.filter((c) => c.effects?.some((e) => HIT_KINDS.includes(e.kind))).length ?? 0;

  const detect = async (path: string, force = false) => {
    setNote(null);
    try {
      if (force) useBeats.setState((s) => ({ grids: Object.fromEntries(Object.entries(s.grids).filter(([k]) => k !== path)) }));
      await useBeats.getState().detect(path);
    } catch (error) {
      setNote(messageOf(error));
    }
  };

  // Analysis takes a fraction of a second per minute of music, so it runs as soon as the panel opens.
  const path = song?.path;
  useEffect(() => {
    if (path && !useBeats.getState().grids[path] && !useBeats.getState().busy) void detect(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const beats = useMemo(() => (song?.grid ? timelineBeats(song.clip, song.grid) : []), [song?.clip, song?.grid]);
  const cuts = useMemo(() => (project && grid ? beatCuts(project, grid, every) : []), [project, grid, every]);

  const run = (op: "cut" | "montage" | "hits" | "clear") => {
    const p = useProject.getState().project;
    if (!p || !grid) return;
    const c = beatCuts(p, grid, every);
    let n = 0;
    useProject.getState().commit((cur) => {
      if (op === "clear") return clearHits(cur);
      const song = songBeats(cur, useBeats.getState().grids)!;
      const res =
        op === "cut" ? cutOnBeats(cur, c) : op === "montage" ? beatMontage(cur, c, { start: song.clip.start, end: clipEnd(song.clip) }, mute) : addHits(cur, c, hits);
      n = res.count;
      return res.project;
    });
    setNote(op === "clear" ? t("amv.cleared") : t(op === "cut" ? "amv.done.cut" : op === "montage" ? "amv.done.montage" : "amv.done.hits", { n }));
  };

  if (!project) return null;
  if (!song) {
    return (
      <div className="sp-stack">
        <div className="sp-hero-icon">
          <AudioLines />
        </div>
        <p className="sp-text">{t("amv.noSong")}</p>
      </div>
    );
  }

  const setHit = (k: keyof Hits) => (v: number) => setHits((h) => ({ ...h, [k]: v }));
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <div className="sp-stack subs-panel amv-panel">
      <div className="amv-song">
        <span className="sp-action-icon">{busy ? <Loader2 className="spin" /> : <AudioLines />}</span>
        <span className="amv-song-text">
          <b title={songName ?? ""}>{songName}</b>
          <small className="tnum">
            {busy ? t("amv.detecting") : grid ? t("amv.stats", { bpm: Math.round(grid.bpm), n: beats.length }) : t("amv.notDetected")}
          </small>
        </span>
        <button className="mini-btn" onClick={() => void detect(song.path, true)} disabled={!!busy} title={t("amv.redetect")} aria-label={t("amv.redetect")}>
          <RefreshCw />
        </button>
      </div>
      <label className="switch-row">
        <span>{t("amv.markers")}</span>
        <Switch on={show} onChange={(v) => useBeats.setState({ show: v })} label={t("amv.markers")} />
      </label>

      <h3 className="section-title">{t("amv.every")}</h3>
      <Segmented options={EVERY.map((n) => ({ value: n, label: n === 4 ? t("amv.bar") : String(n) }))} value={every} onChange={setEvery} />
      <p className="sp-note tnum">{t("amv.cuts", { n: cuts.length })}</p>

      <h3 className="section-title">{t("amv.edit")}</h3>
      <button className="sp-action" data-op="cut" onClick={() => run("cut")} disabled={!grid || !hasVideo}>
        <span className="sp-action-icon">
          <Scissors />
        </span>
        <span>
          <b>{t("amv.cut")}</b>
          <small>{t("amv.cutText")}</small>
        </span>
      </button>
      <button className="sp-action" data-op="montage" onClick={() => run("montage")} disabled={!grid || !hasVideo || songOnMain}>
        <span className="sp-action-icon">
          <Clapperboard />
        </span>
        <span>
          <b>{t("amv.montage")}</b>
          <small>{songOnMain ? t("amv.montageNeedsMusic") : t("amv.montageText")}</small>
        </span>
      </button>
      {!songOnMain && (
        <label className="switch-row">
          <span>{t("amv.mute")}</span>
          <Switch on={mute} onChange={setMute} label={t("amv.mute")} />
        </label>
      )}

      <h3 className="section-title">{t("fx.group.hit")}</h3>
      <div className="amv-hits">
        <Slider label={t("fx.flash")} value={hits.flash} min={0} max={1} format={pct} onChange={setHit("flash")} />
        <Slider label={t("fx.punch")} value={hits.punch} min={0} max={1} format={pct} onChange={setHit("punch")} />
        <Slider label={t("fx.hitShake")} value={hits.hitShake} min={0} max={1} format={pct} onChange={setHit("hitShake")} />
      </div>
      <div className="lyrics-actions">
        <button className="btn btn-sm btn-primary" data-op="hits" onClick={() => run("hits")} disabled={!grid || !hasVideo || !(hits.flash || hits.punch || hits.hitShake)}>
          <Zap />
          {t("amv.addHits")}
        </button>
        <button className="btn btn-sm" data-op="clear" onClick={() => run("clear")} disabled={!hitCount}>
          <Eraser />
          {t("amv.clearHits")}
        </button>
      </div>
      <p className="sp-note">{t("amv.hitsHint")}</p>
      {note && <p className="sp-note">{note}</p>}
    </div>
  );
}
