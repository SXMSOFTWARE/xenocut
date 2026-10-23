import { useEffect, useRef, useState } from "react";
import { AudioWaveform, Check, FolderOpen, X } from "lucide-react";
import { cancelAudio, fileUrl, importMusic, isTauri, mixRender, pickPath, revealOutput, separateStems } from "../lib/audioApi";
import { useMedia } from "../context/MediaContext";
import { useEditorStore } from "../store/editorStore";
import type { AudioStepState } from "../types";

type ListenMode = "vocals" | "music" | "mix" | null;

export function AudioEditingFlow() {
  const videoName = useEditorStore((state) => state.videoName);
  const videoUrl = useEditorStore((state) => state.videoUrl);
  const videoPath = useEditorStore((state) => state.videoPath);
  const audio = useEditorStore((state) => state.audio);
  const musicName = useEditorStore((state) => state.musicName);
  const musicPreviewUrl = useEditorStore((state) => state.musicPreviewUrl);
  const vocalsPath = useEditorStore((state) => state.vocalsPath);
  const outputPath = useEditorStore((state) => state.outputPath);
  const vocalGain = useEditorStore((state) => state.vocalGain);
  const musicGain = useEditorStore((state) => state.musicGain);
  const musicOffset = useEditorStore((state) => state.musicOffset);
  const loopMusic = useEditorStore((state) => state.loopMusic);
  const fadeIn = useEditorStore((state) => state.fadeIn);
  const fadeOut = useEditorStore((state) => state.fadeOut);
  const duration = useEditorStore((state) => state.duration);
  const setTool = useEditorStore((state) => state.setTool);
  const setAudioStep = useEditorStore((state) => state.setAudioStep);
  const resetAudioFrom = useEditorStore((state) => state.resetAudioFrom);
  const openFilePicker = useMedia().openFilePicker;
  const audioInput = useRef<HTMLInputElement | null>(null);
  const mixTimer = useRef<number | null>(null);
  const vocalsRef = useRef<HTMLAudioElement | null>(null);
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const [listen, setListen] = useState<ListenMode>(null);
  const [vocalsUrl, setVocalsUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!vocalsPath || !isTauri()) {
      setVocalsUrl(null);
      return;
    }
    let cancelled = false;
    void fileUrl(vocalsPath).then((url) => {
      if (!cancelled) setVocalsUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [vocalsPath]);

  useEffect(() => {
    return () => {
      vocalsRef.current?.pause();
      musicRef.current?.pause();
    };
  }, []);

  const stopListen = () => {
    if (mixTimer.current !== null) {
      window.clearTimeout(mixTimer.current);
      mixTimer.current = null;
    }
    vocalsRef.current?.pause();
    musicRef.current?.pause();
    setListen(null);
  };

  const playListen = (mode: ListenMode) => {
    const vocals = vocalsRef.current;
    const music = musicRef.current;
    if (!vocals || !music) return;
    vocals.pause();
    music.pause();
    if (listen === mode) {
      setListen(null);
      return;
    }
    vocals.currentTime = 0;
    music.currentTime = 0;
    vocals.volume = Math.min(1, vocalGain);
    music.volume = Math.min(1, musicGain);
    music.loop = loopMusic;
    if (mode === "vocals") void vocals.play();
    if (mode === "music") void music.play();
    if (mode === "mix") {
      void vocals.play();
      mixTimer.current = window.setTimeout(() => {
        mixTimer.current = null;
        if (musicRef.current) void musicRef.current.play();
      }, Math.max(0, musicOffset) * 1000);
    }
    setListen(mode);
  };

  const separate = async () => {
    const state = useEditorStore.getState();
    if (!state.videoPath) {
      setAudioStep(2, {
        status: "error",
        message: isTauri()
          ? "Choose the video with the file button so XenoCut gets its path."
          : "Separation runs in the desktop app. The browser preview cannot read a filesystem path.",
      });
      return;
    }
    if (state.audio[2].status === "running") return;
    setAudioStep(2, { status: "running", progress: 0, message: "Starting" });
    setAudioStep(4, { status: "idle", progress: 0, message: "" });
    useEditorStore.getState().setOutputPath(null);
    try {
      const result = await separateStems(state.videoPath, (event) => {
        useEditorStore.getState().setAudioStep(2, {
          status: event.done ? "done" : "running",
          progress: event.progress,
          message: event.message,
        });
      });
      useEditorStore.getState().setStemPaths(result.vocalsPath, result.instrumentalPath);
      setAudioStep(2, { status: "done", progress: 1, message: result.message });
    } catch (error) {
      setAudioStep(2, { status: "error", message: messageOf(error) });
    }
  };

  const chooseMusic = async () => {
    if (isTauri()) {
      const selected = await pickPath("music");
      if (!selected) return;
      const name = selected.split(/[/\\]/).pop() || "music";
      useEditorStore.getState().setMusicFile(name, selected, await fileUrl(selected));
      resetAudioFrom(3);
      setAudioStep(3, { status: "running", progress: 0, message: "Checking file" });
      try {
        const result = await importMusic(selected, (event) => {
          useEditorStore.getState().setAudioStep(3, {
            status: event.done ? "done" : "running",
            progress: event.progress,
            message: event.message,
          });
        });
        setAudioStep(3, { status: "done", progress: 1, message: result.message });
      } catch (error) {
        setAudioStep(3, { status: "error", message: messageOf(error) });
      }
      return;
    }
    audioInput.current?.click();
  };

  const renderMix = async () => {
    const state = useEditorStore.getState();
    if (!state.videoPath || !state.vocalsPath || !state.musicPath) {
      setAudioStep(4, {
        status: "error",
        message: isTauri()
          ? "Separate the video and import a music file first."
          : "Render runs in the desktop app, after a real file path is available.",
      });
      return;
    }
    if (state.audio[4].status === "running") return;
    resetAudioFrom(4);
    setAudioStep(4, { status: "running", progress: 0, message: "Starting" });
    try {
      const result = await mixRender(
        {
          videoPath: state.videoPath,
          vocalsPath: state.vocalsPath,
          musicPath: state.musicPath,
          vocalGain: state.vocalGain,
          musicGain: state.musicGain,
          musicOffset: state.musicOffset,
          loopMusic: state.loopMusic,
          fadeIn: state.fadeIn,
          fadeOut: state.fadeOut,
          videoDuration: state.duration,
        },
        (event) => {
          useEditorStore.getState().setAudioStep(4, {
            status: event.done ? "done" : "running",
            progress: event.progress,
            message: event.message,
          });
        },
      );
      useEditorStore.getState().setOutputPath(result.outputPath);
      setAudioStep(4, { status: "done", progress: 1, message: result.message });
    } catch (error) {
      setAudioStep(4, { status: "error", message: messageOf(error) });
    }
  };

  const musicReady = audio[3].status === "done";

  return (
    <>
      <header className="side-header">
        <AudioWaveform size={15} strokeWidth={1.75} />
        <h2>Audio</h2>
        <button type="button" className="close" aria-label="Back to video" onClick={() => setTool("video")}>
          <X size={15} strokeWidth={1.75} />
        </button>
      </header>
      <div className="side-scroll" data-testid="audio-flow">
        <p className="audio-copy">
          Keep the original vocals, drop in a song you already exported from Suno, and write a new video. Nothing is sent to Suno.
        </p>
        <ol className="step-list">
          <li className="step-card">
            <div className="step-title">
              <StepIndex done={Boolean(videoUrl)} n={1} />
              Upload video
            </div>
            <p className="step-detail">Use a video on this device. The desktop app keeps its real path.</p>
            {videoName && <p className="filename">{videoName}</p>}
            {videoUrl && !videoPath && (
              <p className="step-message">Browser preview only. Open the desktop app to separate and render.</p>
            )}
            <div className="step-actions">
              <button type="button" className="step-action" onClick={openFilePicker}>
                {videoUrl ? "Replace video" : "Choose video"}
              </button>
            </div>
          </li>
          <li className="step-card">
            <div className="step-title">
              <StepIndex done={audio[2].status === "done"} n={2} />
              Separate vocals & music
            </div>
            <p className="step-detail">
              Extracts the soundtrack, then splits vocals from the backing track on this machine. The model downloads once.
            </p>
            <Progress state={audio[2]} />
            <div className="step-actions">
              <button
                type="button"
                className="step-action"
                disabled={!videoUrl || audio[2].status === "running"}
                onClick={() => void separate()}
              >
                {audio[2].status === "running" ? "Working" : audio[2].status === "done" ? "Separate again" : "Separate stems"}
              </button>
              {audio[2].status === "running" && (
                <button type="button" className="step-action secondary" onClick={() => void cancelAudio()}>
                  Cancel
                </button>
              )}
            </div>
          </li>
          <li className="step-card">
            <div className="step-title">
              <StepIndex done={musicReady} n={3} />
              Import music (Suno export)
            </div>
            <p className="step-detail">mp3, wav, or m4a you already downloaded. XenoCut does not call Suno.</p>
            {musicName && <p className="filename">{musicName}</p>}
            <Progress state={audio[3]} />
            <div className="step-actions">
              <button
                type="button"
                className="step-action"
                disabled={!videoUrl || audio[3].status === "running"}
                onClick={() => void chooseMusic()}
              >
                {musicReady ? "Replace music" : "Choose music"}
              </button>
            </div>
          </li>
          <li className="step-card">
            <div className="step-title">
              <StepIndex done={audio[4].status === "done"} n={4} />
              Mix & render
            </div>
            <p className="step-detail">Original picture, copied. New audio is the vocals plus your song.</p>
            <label className="mix-row">
              Vocals
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.05}
                value={vocalGain}
                aria-label="Vocal volume"
                disabled={!musicReady}
                onChange={(event) => useEditorStore.getState().setVocalGain(Number(event.target.value))}
              />
              <span>{Math.round(vocalGain * 100)}</span>
            </label>
            <label className="mix-row">
              Music
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.05}
                value={musicGain}
                aria-label="Music volume"
                disabled={!musicReady}
                onChange={(event) => useEditorStore.getState().setMusicGain(Number(event.target.value))}
              />
              <span>{Math.round(musicGain * 100)}</span>
            </label>
            <label className="mix-row">
              Offset
              <input
                type="range"
                min={0}
                max={Math.max(1, Math.min(30, duration))}
                step={0.1}
                value={musicOffset}
                aria-label="Music start offset"
                disabled={!musicReady}
                onChange={(event) => useEditorStore.getState().setMusicOffset(Number(event.target.value))}
              />
              <span>{musicOffset.toFixed(1)}s</span>
            </label>
            <label className="mix-row">
              Fade in
              <input
                type="range"
                min={0}
                max={5}
                step={0.1}
                value={fadeIn}
                aria-label="Fade in"
                disabled={!musicReady}
                onChange={(event) => useEditorStore.getState().setFadeIn(Number(event.target.value))}
              />
              <span>{fadeIn.toFixed(1)}s</span>
            </label>
            <label className="mix-row">
              Fade out
              <input
                type="range"
                min={0}
                max={5}
                step={0.1}
                value={fadeOut}
                aria-label="Fade out"
                disabled={!musicReady}
                onChange={(event) => useEditorStore.getState().setFadeOut(Number(event.target.value))}
              />
              <span>{fadeOut.toFixed(1)}s</span>
            </label>
            <label className="loop-row">
              <input
                type="checkbox"
                checked={loopMusic}
                disabled={!musicReady}
                onChange={(event) => useEditorStore.getState().setLoopMusic(event.target.checked)}
              />
              Loop music to the video length
            </label>
            <div className="step-actions">
              <button type="button" className={listen === "vocals" ? "step-action" : "step-action secondary"} disabled={!vocalsUrl} onClick={() => playListen("vocals")}>
                Vocals
              </button>
              <button type="button" className={listen === "music" ? "step-action" : "step-action secondary"} disabled={!musicPreviewUrl} onClick={() => playListen("music")}>
                Music
              </button>
              <button
                type="button"
                className={listen === "mix" ? "step-action" : "step-action secondary"}
                disabled={!vocalsUrl || !musicPreviewUrl}
                onClick={() => playListen("mix")}
              >
                Mix
              </button>
              {listen && (
                <button type="button" className="step-action secondary" onClick={stopListen}>
                  Stop
                </button>
              )}
            </div>
            <Progress state={audio[4]} />
            {outputPath && <p className="filename">{outputPath.split(/[/\\]/).pop()}</p>}
            <div className="step-actions">
              <button
                type="button"
                className="step-action"
                disabled={!musicReady || audio[4].status === "running"}
                onClick={() => void renderMix()}
              >
                {audio[4].status === "running" ? "Working" : audio[4].status === "done" ? "Render again" : "Mix & render"}
              </button>
              {audio[4].status === "running" && (
                <button type="button" className="step-action secondary" onClick={() => void cancelAudio()}>
                  Cancel
                </button>
              )}
              {outputPath && isTauri() && (
                <button type="button" className="step-action secondary" onClick={() => void revealOutput(outputPath)}>
                  <FolderOpen size={13} strokeWidth={1.75} /> Open folder
                </button>
              )}
            </div>
          </li>
        </ol>
      </div>
      <audio ref={vocalsRef} src={vocalsUrl ?? undefined} preload="none" onEnded={() => setListen(null)} />
      <audio ref={musicRef} src={musicPreviewUrl ?? undefined} preload="none" />
      <input
        ref={audioInput}
        type="file"
        accept="audio/mpeg,audio/wav,audio/mp4,.mp3,.wav,.m4a"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          const preview = URL.createObjectURL(file);
          useEditorStore.getState().setMusicFile(file.name, null, preview);
          useEditorStore.getState().setAudioStep(3, {
            status: "done",
            progress: 1,
            message: "Ready for preview. Render uses the file when you open the desktop app.",
          });
        }}
      />
    </>
  );
}

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "The audio step failed.";
}

function StepIndex({ n, done }: { n: number; done: boolean }) {
  return <span className={`step-index${done ? " done" : ""}`}>{done ? <Check size={12} strokeWidth={2.4} /> : n}</span>;
}

function Progress({ state }: { state: AudioStepState }) {
  if (state.status === "idle") return null;
  return (
    <>
      <div className="progress" role="progressbar" aria-valuenow={Math.round(state.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${Math.round(state.progress * 100)}%` }} />
      </div>
      {state.message && <p className={`step-message${state.status === "error" ? " error" : ""}`}>{state.message}</p>}
    </>
  );
}
