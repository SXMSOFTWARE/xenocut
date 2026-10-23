import { useRef } from "react";
import { AudioWaveform, Check, X } from "lucide-react";
import { runAudioStep } from "../lib/audioApi";
import { useMedia } from "../context/MediaContext";
import { useEditorStore } from "../store/editorStore";
import type { AudioStepState } from "../types";

export function AudioEditingFlow() {
  const videoName = useEditorStore((state) => state.videoName);
  const videoUrl = useEditorStore((state) => state.videoUrl);
  const audio = useEditorStore((state) => state.audio);
  const musicPrompt = useEditorStore((state) => state.musicPrompt);
  const musicName = useEditorStore((state) => state.musicName);
  const vocalGain = useEditorStore((state) => state.vocalGain);
  const musicGain = useEditorStore((state) => state.musicGain);
  const setTool = useEditorStore((state) => state.setTool);
  const setMusicPrompt = useEditorStore((state) => state.setMusicPrompt);
  const setMusicName = useEditorStore((state) => state.setMusicName);
  const setVocalGain = useEditorStore((state) => state.setVocalGain);
  const setMusicGain = useEditorStore((state) => state.setMusicGain);
  const setAudioStep = useEditorStore((state) => state.setAudioStep);
  const resetAudioFrom = useEditorStore((state) => state.resetAudioFrom);
  const openFilePicker = useMedia().openFilePicker;
  const audioInput = useRef<HTMLInputElement | null>(null);

  const run = async (step: 2 | 3 | 4, localPath?: string | null) => {
    const state = useEditorStore.getState();
    if (state.audio[step].status === "running") return;
    resetAudioFrom(step);
    setAudioStep(step, { status: "running", progress: 0, message: "Starting" });
    try {
      const result = await runAudioStep(
        step,
        {
          inputPath: state.videoName ?? "untitled",
          prompt: state.musicPrompt,
          localPath,
          vocalGain: state.vocalGain,
          musicGain: state.musicGain,
        },
        (event) => {
          useEditorStore.getState().setAudioStep(step, {
            status: event.done ? "done" : "running",
            progress: event.progress,
            message: event.message,
          });
        },
      );
      const current = useEditorStore.getState().audio[step];
      if (current.status !== "error") {
        setAudioStep(step, {
          status: "done",
          progress: 1,
          message: current.message || result,
        });
      }
    } catch (error) {
      const message =
        typeof error === "string" ? error : error instanceof Error ? error.message : "The audio step failed.";
      useEditorStore.getState().setAudioStep(step, { status: "error", message });
    }
  };

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
          One-click audio. Separate the dialogue, drop in music, then mix and render.
        </p>
        <ol className="step-list">
          <li className="step-card">
            <div className="step-title">
              <StepIndex done={Boolean(videoUrl)} n={1} />
              Upload video
            </div>
            <p className="step-detail">Use a video on this device. Nothing is uploaded.</p>
            {videoName && <p className="filename">{videoName}</p>}
            <div className="step-actions">
              <button type="button" className="step-action" onClick={openFilePicker}>
                {videoUrl ? "Replace video" : "Choose video"}
              </button>
            </div>
          </li>
          <Step
            n={2}
            title="Separate vocals & music"
            detail="On-device ONNX (MDX-Net / UVR via ort). Stubbed until the model is bundled."
            state={audio[2]}
            disabled={!videoUrl || audio[2].status === "running"}
            action={audio[2].status === "done" ? "Separate again" : "Separate stems"}
            onRun={() => void run(2)}
          />
          <li className="step-card">
            <div className="step-title">
              <StepIndex done={audio[3].status === "done"} n={3} />
              Import AI music
            </div>
            <p className="step-detail">
              Suno has no official public API. Next milestone: a third-party provider with your key, or a local file. This step is a stub.
            </p>
            <input
              className="music-prompt"
              aria-label="Music prompt"
              value={musicPrompt}
              onChange={(event) => setMusicPrompt(event.target.value)}
            />
            {musicName && <p className="filename">{musicName}</p>}
            <Progress state={audio[3]} />
            <div className="step-actions">
              <button
                type="button"
                className="step-action"
                disabled={!videoUrl || audio[2].status !== "done" || audio[3].status === "running"}
                onClick={() => {
                  setMusicName(null);
                  void run(3, null);
                }}
              >
                {audio[3].status === "done" ? "Generate again" : "Generate with Suno"}
              </button>
              <button
                type="button"
                className="step-action secondary"
                disabled={!videoUrl || audio[2].status !== "done" || audio[3].status === "running"}
                onClick={() => audioInput.current?.click()}
              >
                Choose audio file
              </button>
            </div>
          </li>
          <li className="step-card">
            <div className="step-title">
              <StepIndex done={audio[4].status === "done"} n={4} />
              Mix & render
            </div>
            <p className="step-detail">
              Mix the stems with the new music through FFmpeg. The sidecar is not bundled yet.
            </p>
            <label className="mix-row">
              Vocals
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.05}
                value={vocalGain}
                aria-label="Vocal gain"
                disabled={audio[3].status !== "done"}
                onChange={(event) => setVocalGain(Number(event.target.value))}
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
                aria-label="Music gain"
                disabled={audio[3].status !== "done"}
                onChange={(event) => setMusicGain(Number(event.target.value))}
              />
              <span>{Math.round(musicGain * 100)}</span>
            </label>
            <Progress state={audio[4]} />
            <div className="step-actions">
              <button
                type="button"
                className="step-action"
                disabled={audio[3].status !== "done" || audio[4].status === "running"}
                onClick={() => void run(4)}
              >
                {audio[4].status === "done" ? "Render again" : "Mix & render"}
              </button>
            </div>
          </li>
        </ol>
      </div>
      <input
        ref={audioInput}
        type="file"
        accept="audio/*,.mp3,.wav,.m4a,.aac,.flac"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setMusicName(file.name);
          void run(3, file.name);
        }}
      />
    </>
  );
}

function Step({
  n,
  title,
  detail,
  state,
  disabled,
  action,
  onRun,
}: {
  n: number;
  title: string;
  detail: string;
  state: AudioStepState;
  disabled: boolean;
  action: string;
  onRun: () => void;
}) {
  return (
    <li className="step-card">
      <div className="step-title">
        <StepIndex done={state.status === "done"} n={n} />
        {title}
      </div>
      <p className="step-detail">{detail}</p>
      <Progress state={state} />
      <div className="step-actions">
        <button type="button" className="step-action" disabled={disabled} onClick={onRun}>
          {state.status === "running" ? "Working" : action}
        </button>
      </div>
    </li>
  );
}

function StepIndex({ n, done }: { n: number; done: boolean }) {
  return <span className={`step-index${done ? " done" : ""}`}>{done ? <Check size={12} strokeWidth={2.4} /> : n}</span>;
}

function Progress({ state }: { state: AudioStepState }) {
  if (state.status === "idle") return null;
  return (
    <>
      <div className="progress" aria-hidden="true">
        <span style={{ width: `${Math.round(state.progress * 100)}%` }} />
      </div>
      {state.message && <p className={`step-message${state.status === "error" ? " error" : ""}`}>{state.message}</p>}
    </>
  );
}
