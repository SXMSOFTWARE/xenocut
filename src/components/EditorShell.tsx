import { useEffect } from "react";
import { Music, WandSparkles } from "lucide-react";
import { AudioEditingFlow } from "./AudioEditingFlow";
import { IconRail } from "./IconRail";
import { PreviewArea } from "./PreviewArea";
import { ProjectTitle, PromptPanel } from "./PromptPanel";
import { Timeline } from "./Timeline";
import { TransportBar } from "./TransportBar";
import { MediaProvider } from "../context/MediaContext";
import { useEditorStore } from "../store/editorStore";

export function EditorShell() {
  return (
    <MediaProvider>
      <Shell />
    </MediaProvider>
  );
}

function Shell() {
  const promptOpen = useEditorStore((state) => state.promptOpen);
  const tool = useEditorStore((state) => state.tool);
  const toast = useEditorStore((state) => state.toast);
  const projectName = useEditorStore((state) => state.projectName);
  const setPromptOpen = useEditorStore((state) => state.setPromptOpen);

  useEffect(() => {
    document.title = `${projectName} — XenoCut`;
  }, [projectName]);

  return (
    <div className="canvas">
      <h1 className="sr-only">XenoCut</h1>
      <div className="editor-window">
        <div className="preview-stage">
          <PreviewArea />
          <IconRail />
          <ProjectTitle />
          <section
            className={`side-panel${promptOpen ? " open" : ""}`}
            aria-label={tool === "music" ? "Audio editing" : "Prompt"}
            aria-hidden={!promptOpen}
            data-testid={tool === "music" ? "audio-panel" : "prompt-panel"}
          >
            <div className="sheet-handle" />
            {tool === "music" ? <AudioEditingFlow /> : <PromptPanel />}
          </section>
          {!promptOpen && (
            <button
              type="button"
              className="glass-btn reopen"
              aria-label={tool === "music" ? "Open audio editing" : "Open prompt"}
              onClick={() => setPromptOpen(true)}
            >
              {tool === "music" ? <Music size={15} strokeWidth={1.75} /> : <WandSparkles size={15} strokeWidth={1.75} />}
            </button>
          )}
          <Timeline />
          {toast && (
            <div className="toast" role="status">
              {toast}
            </div>
          )}
        </div>
        <TransportBar />
      </div>
    </div>
  );
}
