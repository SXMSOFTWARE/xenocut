import type { ReactNode } from "react";
import {
  ArrowLeft,
  AudioWaveform,
  Clapperboard,
  Mic,
  Music,
  Type,
} from "lucide-react";
import { ThreeCirclesIcon, TransitionsIcon } from "./icons";
import { useEditorStore } from "../store/editorStore";
import type { ToolId } from "../types";

const PLANNED: Partial<Record<ToolId, string>> = {
  mic: "Voiceover is planned for a later milestone.",
  effects: "Transitions are planned for a later milestone.",
  waveform: "Waveform editing is planned for a later milestone.",
  color: "Color and filters are planned for a later milestone.",
  text: "Text is planned for a later milestone.",
};

export function IconRail() {
  const tool = useEditorStore((state) => state.tool);
  const setTool = useEditorStore((state) => state.setTool);
  const showToast = useEditorStore((state) => state.showToast);

  const select = (id: ToolId) => {
    if (id === "video" || id === "music") {
      setTool(id);
      return;
    }
    const message = PLANNED[id];
    if (message) showToast(message);
  };

  return (
    <nav className="rail" aria-label="Tools">
      <button
        type="button"
        className="rail-btn"
        aria-label="Back to video"
        onClick={() => setTool("video")}
      >
        <ArrowLeft size={16} strokeWidth={1.75} />
      </button>
      <RailButton label="Video" active={tool === "video"} onClick={() => select("video")}>
        <Clapperboard size={16} strokeWidth={1.75} />
      </RailButton>
      <RailButton label="Microphone" onClick={() => select("mic")}>
        <Mic size={16} strokeWidth={1.75} />
      </RailButton>
      <RailButton label="Audio editing" active={tool === "music"} onClick={() => select("music")}>
        <Music size={16} strokeWidth={1.75} />
      </RailButton>
      <RailButton label="Transitions" onClick={() => select("effects")}>
        <TransitionsIcon />
      </RailButton>
      <RailButton label="Waveform" onClick={() => select("waveform")}>
        <AudioWaveform size={16} strokeWidth={1.75} />
      </RailButton>
      <RailButton label="Color" onClick={() => select("color")}>
        <ThreeCirclesIcon />
      </RailButton>
      <RailButton label="Text" onClick={() => select("text")}>
        <Type size={16} strokeWidth={1.75} />
      </RailButton>
    </nav>
  );
}

function RailButton({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`rail-btn${active ? " active" : ""}`}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
