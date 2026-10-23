import { useState } from "react";
import { AudioWaveform, Check, Mic, Pencil, Plus, Send, WandSparkles, X } from "lucide-react";
import { STACK_FEATHER, STACK_GOLD } from "../data/demo";
import { useMedia } from "../context/MediaContext";
import { useEditorStore } from "../store/editorStore";

export function PromptPanel() {
  const prompt = useEditorStore((state) => state.prompt);
  const setPrompt = useEditorStore((state) => state.setPrompt);
  const setPromptOpen = useEditorStore((state) => state.setPromptOpen);
  const showToast = useEditorStore((state) => state.showToast);
  const openFilePicker = useMedia().openFilePicker;
  const [sent, setSent] = useState(false);

  return (
    <>
      <header className="side-header">
        <WandSparkles size={15} strokeWidth={1.75} />
        <h2>Prompt</h2>
        <button type="button" className="close" aria-label="Close prompt" onClick={() => setPromptOpen(false)}>
          <X size={15} strokeWidth={1.75} />
        </button>
      </header>
      <div className="side-scroll">
        <textarea
          className="prompt-text"
          aria-label="Scene prompt"
          value={prompt}
          rows={6}
          onChange={(event) => setPrompt(event.target.value)}
        />
        <div className="stack-stage">
          <img className="stack-photo back" src={STACK_FEATHER} alt="Crimson feathers and gold pigment beside an eye" />
          <img className="stack-photo front" src={STACK_GOLD} alt="Gold makeup and a red feather in warm light" />
        </div>
      </div>
      <footer className="side-footer">
        <div className="outline-row">
          <button type="button" className="outline-btn" aria-label="Import video" onClick={openFilePicker}>
            <Plus size={15} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            className="outline-btn"
            aria-label="Voice prompt"
            onClick={() => showToast("Voice prompts arrive with the audio milestone.")}
          >
            <Mic size={15} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            className="outline-btn"
            aria-label="Audio reference"
            onClick={() => showToast("Audio references arrive with the audio milestone.")}
          >
            <AudioWaveform size={15} strokeWidth={1.75} />
          </button>
        </div>
        <button
          type="button"
          className="send-btn"
          aria-label="Save prompt"
          onClick={() => {
            setSent(true);
            showToast("Prompt kept for this project.");
            window.setTimeout(() => setSent(false), 800);
          }}
        >
          {sent ? <Check size={15} strokeWidth={2} /> : <Send size={15} strokeWidth={1.75} />}
        </button>
      </footer>
    </>
  );
}

export function ProjectTitle() {
  const projectName = useEditorStore((state) => state.projectName);
  const setProjectName = useEditorStore((state) => state.setProjectName);
  const openFilePicker = useMedia().openFilePicker;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(projectName);

  const commit = () => {
    const next = draft.trim() || "Untitled";
    setProjectName(next);
    setDraft(next);
    setEditing(false);
  };

  return (
    <div className="title-row">
      {editing ? (
        <label className="title-pill">
          <input
            aria-label="Project name"
            value={draft}
            autoFocus
            maxLength={48}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit();
              if (event.key === "Escape") {
                setDraft(projectName);
                setEditing(false);
              }
            }}
          />
          <Pencil size={13} strokeWidth={1.75} />
        </label>
      ) : (
        <button type="button" className="title-pill" onClick={() => { setDraft(projectName); setEditing(true); }}>
          <span>{projectName}</span>
          <Pencil size={13} strokeWidth={1.75} />
        </button>
      )}
      <button type="button" className="glass-btn" aria-label="Import video" onClick={openFilePicker}>
        <Plus size={16} strokeWidth={1.75} />
      </button>
    </div>
  );
}
