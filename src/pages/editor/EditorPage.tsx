import { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import "../../styles/editor.css";
import { engine } from "../../engine/playback";
import { useT } from "../../i18n";
import { onFileDrop } from "../../lib/backend";
import { addToTimeline, importPaths, startAutosave } from "../../project/actions";
import { useEditorUi } from "../../store/editorUi";
import { usePlayback } from "../../store/playback";
import { useProject } from "../../store/project";
import { useRouter } from "../../store/router";
import { toast } from "../../store/toast";
import { deleteSelection, jumpToEdge, splitAtPlayhead, zoomBy } from "./commands";
import { ExportDialog } from "./ExportDialog";
import { Ambient } from "./Ambient";
import { BottomBar } from "./BottomBar";
import { MediaDragGhost } from "./MediaDragGhost";
import { Preview } from "./Preview";
import { Rail } from "./Rail";
import { SidePanel } from "./SidePanel";
import { TitleBar } from "./TitleBar";
import { Timeline } from "./timeline/Timeline";
import { laneAtPoint } from "./timeline/geometry";

export default function EditorPage() {
  const t = useT();
  const hasProject = useProject((s) => !!s.project);
  const exportOpen = useEditorUi((s) => s.exportOpen);
  const panelOpen = useEditorUi((s) => s.panel !== null);
  const [dropping, setDropping] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hasProject) useRouter.getState().go("home");
  }, [hasProject]);

  useEffect(() => startAutosave(), []);

  // Native file drops: on a lane they land on the timeline, anywhere else they go to the bin.
  useEffect(() => {
    let dispose: (() => void) | undefined;
    let alive = true;
    void onFileDrop(
      async (paths, point) => {
        const lane = laneAtPoint(point.x, point.y);
        const items = await importPaths(paths);
        if (lane && items.length) {
          let at = lane.time;
          for (const media of items) {
            const id = addToTimeline(media, at, lane.trackId);
            const clip = useProject.getState().project?.clips.find((c) => c.id === id);
            if (clip) at = clip.start + (clip.out - clip.in) / clip.speed;
          }
        }
      },
      (over) => setDropping(over),
    ).then((d) => {
      if (alive) dispose = d;
      else d();
    });
    return () => {
      alive = false;
      dispose?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "s") return;
      }
      if (useEditorUi.getState().exportOpen) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const fps = useProject.getState().project?.settings.fps ?? 30;
      const now = usePlayback.getState().time;
      let handled = true;
      if (mod && key === "z" && !e.shiftKey) useProject.getState().undo();
      else if (mod && (key === "y" || (key === "z" && e.shiftKey))) useProject.getState().redo();
      else if (mod && key === "s") {
        void useProject.getState().save().then((ok) => ok && toast(t("editor.saved"), "success"));
      } else if (mod && (key === "=" || key === "+")) zoomBy(1.25);
      else if (mod && key === "-") zoomBy(0.8);
      else if (mod && key === "e") {
        if (useProject.getState().project?.clips.length) useEditorUi.setState({ exportOpen: true });
      }
      else if (mod) handled = false;
      else if (key === " ") engine.toggle();
      else if (key === "k") engine.pause();
      else if (key === "l") engine.play();
      else if (key === "j") {
        engine.pause();
        engine.seek(now - 1);
      } else if (key === "arrowleft") {
        engine.pause();
        engine.seek(now - (e.shiftKey ? 1 : 1 / fps));
      } else if (key === "arrowright") {
        engine.pause();
        engine.seek(now + (e.shiftKey ? 1 : 1 / fps));
      } else if (key === "arrowup") jumpToEdge(-1);
      else if (key === "arrowdown") jumpToEdge(1);
      else if (key === "home") engine.seek(0);
      else if (key === "end") engine.seek(engine.duration());
      else if (key === "s") splitAtPlayhead();
      else if (key === "delete" || key === "backspace") deleteSelection();
      else if (key === "escape") useProject.getState().select([]);
      else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [t]);

  // Save on leave.
  useEffect(
    () => () => {
      engine.pause();
      const s = useProject.getState();
      if (s.project && s.saveState === "dirty") void s.save();
    },
    [],
  );

  if (!hasProject) return null;

  return (
    <div className={`editor${panelOpen ? " panel-open" : ""}`} ref={rootRef}>
      <div className="hero">
        <Ambient />
        <Preview />
        <Rail />
        <TitleBar />
        <SidePanel />
        <Timeline />
      </div>
      <BottomBar />
      <MediaDragGhost />
      {dropping && (
        <div className="drop-overlay">
          <div>
            <Upload />
            <span>{t("editor.dropHere")}</span>
          </div>
        </div>
      )}
      {exportOpen && <ExportDialog />}
    </div>
  );
}
