import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Clapperboard, FileAudio, FolderOpen, Music2, Pause, Play, Sparkles, Upload, Wand2 } from "lucide-react";
import { Slider, Switch } from "../../components/controls";
import { useT } from "../../i18n";
import { api, AUDIO_EXT, fileSrc, listen, pickFiles, revealInFolder, VIDEO_EXT, type AudioProgress } from "../../lib/backend";
import { baseName, joinPath, messageOf, shortTime } from "../../lib/format";
import { openMediaAsProject } from "../../project/actions";
import type { ProbeInfo } from "../../project/types";
import { useRouter } from "../../store/router";
import { useSettings } from "../../store/settings";
import { toast } from "../../store/toast";
import "../../styles/music.css";

type Step = 1 | 2 | 3 | 4;
interface Job {
  running: boolean;
  progress: number;
  message: string;
}
const IDLE: Job = { running: false, progress: 0, message: "" };

type Monitor = "mix" | "original" | "vocals" | "music";

export default function MusicSwapPage() {
  const t = useT();
  const back = useRouter((r) => r.back);
  const outputDir = useSettings((s) => s.outputDir);
  const [step, setStep] = useState<Step>(1);
  const [video, setVideo] = useState<ProbeInfo | null>(null);
  const [stems, setStems] = useState<{ vocalsPath: string; instrumentalPath: string } | null>(null);
  const [music, setMusic] = useState<{ path: string; name: string; duration: number } | null>(null);
  const [mix, setMix] = useState({ vocalGain: 1, musicGain: 0.8, musicOffset: 0, loopMusic: true, fadeIn: 1, fadeOut: 2 });
  const [job, setJob] = useState<Job>(IDLE);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    let off: (() => void) | undefined;
    void listen<AudioProgress>("audio-progress", (p) =>
      setJob((j) => (j.running ? { running: true, progress: p.progress, message: p.message } : j)),
    ).then((u) => (off = u));
    return () => off?.();
  }, []);

  const run = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setJob({ running: true, progress: 0, message: "" });
    try {
      return await fn();
    } catch (error) {
      const msg = messageOf(error);
      toast(/cancel/i.test(msg) ? t("export.cancelled") : msg, "error");
      return null;
    } finally {
      setJob(IDLE);
    }
  };

  const chooseVideo = async () => {
    const [path] = await pickFiles([{ name: "Video", extensions: VIDEO_EXT }], false);
    if (path) await loadVideo(path);
  };

  // Opened from the editor with a clip's source video: skip straight to separation.
  useEffect(() => {
    const preset = useRouter.getState().musicSource;
    if (!preset) return;
    useRouter.setState({ musicSource: null });
    void loadVideo(preset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadVideo(path: string) {
    try {
      const { items, errors } = await api.mediaProbe([path]);
      const info = items[0];
      if (!info) throw new Error(errors[0] ?? path);
      if (!info.hasVideo || !info.hasAudio) throw new Error(t("music.needsAudio"));
      setVideo(info);
      setStems(null);
      setResult(null);
      setStep(2);
    } catch (error) {
      toast(messageOf(error), "error");
    }
  }

  const separate = async () => {
    if (!video) return;
    const out = await run(() => api.separateStems(video.path));
    if (out) {
      setStems(out);
      setStep(3);
    }
  };

  const chooseMusic = async () => {
    const [path] = await pickFiles([{ name: "Audio", extensions: AUDIO_EXT }], false);
    if (!path) return;
    const out = await run(async () => {
      const imported = await api.importMusic(path);
      const probe = await api.mediaProbe([imported.musicPath]);
      return { path: imported.musicPath, name: baseName(path), duration: probe.items[0]?.duration ?? 0 };
    });
    if (out) {
      setMusic(out);
      setResult(null);
      setStep(4);
    }
  };

  const render = async () => {
    if (!video || !stems || !music) return;
    const stem = video.name.replace(/\.[^.]+$/, "");
    const outputPath = joinPath(outputDir, `${stem}-xenocut-${Date.now().toString(36)}.mp4`);
    const out = await run(() =>
      api.mixRender({ videoPath: video.path, vocalsPath: stems.vocalsPath, musicPath: music.path, videoDuration: video.duration, outputPath, ...mix }),
    );
    if (out) {
      setResult(out.outputPath);
      toast(t("music.renderDone"), "success");
    }
  };

  const steps: { n: Step; title: string; text: string; done: boolean }[] = [
    { n: 1, title: t("music.step1"), text: video ? video.name : t("music.step1Text"), done: !!video },
    { n: 2, title: t("music.step2"), text: stems ? t("music.stemsReady") : t("music.step2Text"), done: !!stems },
    { n: 3, title: t("music.step3"), text: music ? music.name : t("music.step3Text"), done: !!music },
    { n: 4, title: t("music.step4"), text: result ? t("music.renderDone") : t("music.step4Text"), done: !!result },
  ];
  const reachable = (n: Step) => n === 1 || (n === 2 && !!video) || (n === 3 && !!stems) || (n === 4 && !!music);

  return (
    <div className="page music-page">
      <header className="page-top">
        <button className="icon-btn" onClick={back} disabled={job.running} aria-label={t("editor.back")} title={t("editor.back")}>
          <ArrowLeft />
        </button>
        <div className="tool-badge">
          <Music2 />
        </div>
        <div className="page-title">
          <h1>{t("tools.musicSwap")}</h1>
          <span className="muted">{t("music.subtitle")}</span>
        </div>
      </header>
      <div className="page-body music-body">
        <ol className="steps">
          {steps.map((s) => (
            <li key={s.n}>
              <button className={`step${step === s.n ? " active" : ""}${s.done ? " done" : ""}`} disabled={job.running || !reachable(s.n)} onClick={() => setStep(s.n)}>
                <span className="step-num">{s.done ? <Check /> : s.n}</span>
                <span className="step-text">
                  <b>{s.title}</b>
                  <small>{s.text}</small>
                </span>
              </button>
            </li>
          ))}
          <li className="steps-note muted">{t("music.localNote")}</li>
        </ol>

        <section className="panel music-main">
          {step === 1 && (
            <Pane icon={<Clapperboard />} title={t("music.step1")} text={t("music.step1Long")}>
              {video ? (
                <div className="music-video">
                  <video src={fileSrc(video.path)} controls preload="metadata" />
                  <div className="kv-group">
                    <div className="kv">
                      <span>{t("inspector.source")}</span>
                      <b>{video.name}</b>
                    </div>
                    <div className="kv">
                      <span>{t("inspector.duration")}</span>
                      <b>{shortTime(video.duration)}</b>
                    </div>
                    <div className="kv">
                      <span>{t("inspector.resolution")}</span>
                      <b>
                        {video.width}×{video.height}
                      </b>
                    </div>
                  </div>
                </div>
              ) : (
                <button className="dropzone" onClick={() => void chooseVideo()}>
                  <Upload />
                  <b>{t("music.pickVideo")}</b>
                  <span className="muted">MP4 · MOV · MKV · WEBM</span>
                </button>
              )}
              <div className="pane-foot">
                {video && (
                  <button className="btn" onClick={() => void chooseVideo()}>
                    {t("music.otherVideo")}
                  </button>
                )}
                <span className="spacer" />
                {video && (
                  <button className="btn btn-primary" onClick={() => setStep(2)}>
                    {t("music.next")}
                  </button>
                )}
              </div>
            </Pane>
          )}

          {step === 2 && video && (
            <Pane icon={<Wand2 />} title={t("music.step2")} text={t("music.step2Long")}>
              {job.running ? (
                <JobView job={job} onCancel={() => void api.audioCancel()} />
              ) : stems ? (
                <div className="stem-list">
                  <StemRow label={t("music.original")} path={video.path} />
                  <StemRow label={t("music.vocals")} path={stems.vocalsPath} />
                  <StemRow label={t("music.instrumental")} path={stems.instrumentalPath} />
                </div>
              ) : (
                <div className="pane-hero">
                  <Sparkles />
                  <p className="muted">{t("music.separateHint")}</p>
                </div>
              )}
              <div className="pane-foot">
                <span className="spacer" />
                {!job.running && (
                  <button className={`btn${stems ? "" : " btn-primary"}`} onClick={() => void separate()}>
                    <Wand2 /> {stems ? t("music.separateAgain") : t("music.separate")}
                  </button>
                )}
                {stems && !job.running && (
                  <button className="btn btn-primary" onClick={() => setStep(3)}>
                    {t("music.next")}
                  </button>
                )}
              </div>
            </Pane>
          )}

          {step === 3 && (
            <Pane icon={<FileAudio />} title={t("music.step3")} text={t("music.step3Long")}>
              {job.running ? (
                <JobView job={job} onCancel={() => void api.audioCancel()} />
              ) : music ? (
                <div className="stem-list">
                  <StemRow label={music.name} path={music.path} />
                </div>
              ) : (
                <button className="dropzone" onClick={() => void chooseMusic()}>
                  <Music2 />
                  <b>{t("music.pickMusic")}</b>
                  <span className="muted">MP3 · WAV · M4A · FLAC</span>
                </button>
              )}
              <div className="pane-foot">
                {music && !job.running && (
                  <button className="btn" onClick={() => void chooseMusic()}>
                    {t("music.otherMusic")}
                  </button>
                )}
                <span className="spacer" />
                {music && !job.running && (
                  <button className="btn btn-primary" onClick={() => setStep(4)}>
                    {t("music.next")}
                  </button>
                )}
              </div>
            </Pane>
          )}

          {step === 4 && video && stems && music && (
            <Pane icon={<Sparkles />} title={t("music.step4")} text={t("music.step4Long")}>
              <div className="mix-grid">
                <MixPreview video={video.path} vocals={stems.vocalsPath} music={music.path} mix={mix} />
                <div className="mix-controls">
                  <Slider label={t("music.vocalGain")} value={mix.vocalGain} min={0} max={2} format={pct} onChange={(v) => setMix({ ...mix, vocalGain: v })} />
                  <Slider label={t("music.musicGain")} value={mix.musicGain} min={0} max={2} format={pct} onChange={(v) => setMix({ ...mix, musicGain: v })} />
                  <Slider
                    label={t("music.offset")}
                    value={mix.musicOffset}
                    min={0}
                    max={Math.max(1, Math.min(30, video.duration - 1))}
                    step={0.1}
                    format={secs}
                    onChange={(v) => setMix({ ...mix, musicOffset: v })}
                  />
                  <Slider label={t("inspector.fadeIn")} value={mix.fadeIn} min={0} max={5} step={0.1} format={secs} onChange={(v) => setMix({ ...mix, fadeIn: v })} />
                  <Slider label={t("inspector.fadeOut")} value={mix.fadeOut} min={0} max={5} step={0.1} format={secs} onChange={(v) => setMix({ ...mix, fadeOut: v })} />
                  <label className="switch-row">
                    <span>{t("music.loop")}</span>
                    <Switch on={mix.loopMusic} onChange={(v) => setMix({ ...mix, loopMusic: v })} label={t("music.loop")} />
                  </label>
                </div>
              </div>
              {job.running && <JobView job={job} onCancel={() => void api.audioCancel()} />}
              {result && !job.running && (
                <div className="export-result ok">
                  <Check />
                  <div>
                    <b>{t("music.renderDone")}</b>
                    <p className="path-note">{result}</p>
                    <video className="result-video" src={fileSrc(result)} controls preload="metadata" />
                  </div>
                </div>
              )}
              <div className="pane-foot">
                {result && !job.running && (
                  <>
                    <button className="btn" onClick={() => void revealInFolder(result)}>
                      <FolderOpen /> {t("export.openFolder")}
                    </button>
                    <button className="btn" onClick={() => void openMediaAsProject(result, `${video.name.replace(/\.[^.]+$/, "")} · ${t("tools.musicSwap")}`)}>
                      <Clapperboard /> {t("music.openInEditor")}
                    </button>
                  </>
                )}
                <span className="spacer" />
                {!job.running && (
                  <button className="btn btn-primary" onClick={() => void render()}>
                    <Sparkles /> {result ? t("music.renderAgain") : t("music.render")}
                  </button>
                )}
              </div>
            </Pane>
          )}
        </section>
      </div>
    </div>
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const secs = (v: number) => `${v.toFixed(1)} s`;

function Pane({ icon, title, text, children }: { icon: React.ReactNode; title: string; text: string; children: React.ReactNode }) {
  return (
    <div className="pane">
      <div className="pane-head">
        <span className="pane-icon">{icon}</span>
        <div>
          <h2>{title}</h2>
          <p className="muted">{text}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function JobView({ job, onCancel }: { job: Job; onCancel: () => void }) {
  const t = useT();
  return (
    <div className="export-run">
      <div className="export-pct tnum">{Math.round(job.progress * 100)}%</div>
      <div className="progress">
        <i style={{ width: `${Math.max(2, job.progress * 100)}%` }} />
      </div>
      <div className="job-foot">
        <span className="muted">{job.message || t("music.working")}</span>
        <button className="btn btn-sm btn-danger" onClick={onCancel}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}

function StemRow({ label, path }: { label: string; path: string }) {
  return (
    <div className="stem-row">
      <b>{label}</b>
      <audio src={fileSrc(path)} controls preload="none" />
    </div>
  );
}

/**
 * Live A/B monitor: the muted video drives the clock; vocals and music follow it with the
 * current gains and offset, so changes are heard before rendering. After a render the
 * result itself can be played.
 */
function MixPreview({
  video,
  vocals,
  music,
  mix,
}: {
  video: string;
  vocals: string;
  music: string;
  mix: { vocalGain: number; musicGain: number; musicOffset: number; loopMusic: boolean };
}) {
  const t = useT();
  const [monitor, setMonitor] = useState<Monitor>("mix");
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const vocalsRef = useRef<HTMLAudioElement>(null);
  const musicRef = useRef<HTMLAudioElement>(null);
  const mixRef = useRef(mix);
  mixRef.current = mix;

  useEffect(() => {
    const v = videoRef.current;
    const vo = vocalsRef.current;
    const mu = musicRef.current;
    if (!v || !vo || !mu) return;
    let raf = 0;
    const tick = () => {
      const m = mixRef.current;
      const now = v.currentTime;
      const original = monitor === "original";
      v.muted = !original;
      vo.volume = Math.min(1, monitor === "music" ? 0 : m.vocalGain);
      mu.volume = Math.min(1, monitor === "vocals" ? 0 : m.musicGain);
      mu.loop = m.loopMusic;
      const musicT = now - m.musicOffset;
      if (!v.paused && !original) {
        if (Math.abs(vo.currentTime - now) > 0.15) vo.currentTime = now;
        if (vo.paused) void vo.play().catch(() => {});
        if (musicT >= 0 && (m.loopMusic || musicT < (mu.duration || Infinity))) {
          const target = m.loopMusic && mu.duration ? musicT % mu.duration : musicT;
          if (Math.abs(mu.currentTime - target) > 0.2) mu.currentTime = target;
          if (mu.paused) void mu.play().catch(() => {});
        } else if (!mu.paused) mu.pause();
      } else {
        if (!vo.paused) vo.pause();
        if (!mu.paused) mu.pause();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [monitor]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, []);

  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  };

  return (
    <div className="mix-preview">
      <div className="mix-stage">
        <video ref={videoRef} src={fileSrc(video)} preload="auto" playsInline onClick={toggle} />
        <audio ref={vocalsRef} src={fileSrc(vocals)} preload="auto" />
        <audio ref={musicRef} src={fileSrc(music)} preload="auto" />
      </div>
      <div className="mix-bar">
        <button className="icon-btn primary" onClick={toggle} aria-label={t("preview.play")}>
          {playing ? <Pause /> : <Play />}
        </button>
        <div className="chip-group">
          {(["mix", "original", "vocals", "music"] as Monitor[]).map((m) => (
            <button key={m} className={`chip${monitor === m ? " active" : ""}`} onClick={() => setMonitor(m)}>
              {t(`music.monitor.${m}`)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
