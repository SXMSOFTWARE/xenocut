import { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import "../../styles/editor.css";
import "../../styles/effects.css";
import "../../styles/themes.css";
import { engine } from "../../engine/playback";
import { useT } from "../../i18n";
import { onFileDrop } from "../../lib/backend";
import { addToTimeline, importPaths, startAutosave } from "../../project/actions";
import { useEditorUi } from "../../store/editorUi";
import { useProject } from "../../store/project";
import { useRouter } from "../../store/router";
import { useSettings } from "../../store/settings";
import { toast } from "../../store/toast";
import { handleShortcut, onSaved } from "./shortcuts";
import { ExportDialog } from "./ExportDialog";
import { RenameDialog } from "./RenameDialog";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { Ambient } from "./Ambient";
import { BottomBar } from "./BottomBar";
import { MediaDragGhost } from "./MediaDragGhost";
import { Preview } from "./Preview";
import { Rail } from "./Rail";
import { SidePanel } from "./SidePanel";
import { TitleBar } from "./TitleBar";
import { Timeline } from "./timeline/Timeline";
import { laneAtPoint } from "./timeline/geometry";
import { layoutVars } from "./layout";
import { isMobileUi } from "../../lib/platform";
import { MobileEditor } from "./mobile/MobileEditor";
import { DockBin } from "./DockBin";
import { useCurrentTheme } from "../../themes/useTheme";

export default function EditorPage() {
  const panelSide = useSettings((s) => s.panelSide);
  const panelWidth = useSettings((s) => s.panelWidth);
  const timelineFrac = useSettings((s) => s.timelineFrac);
  const layout = useCurrentTheme().layout;
  const t = useT();
  const hasProject = useProject((s) => !!s.project);
  const exportOpen = useEditorUi((s) => s.exportOpen);
  const shortcutsOpen = useEditorUi((s) => s.shortcutsOpen);
  const renaming = useEditorUi((s) => s.rename?.id);
  const panelOpen = useEditorUi((s) => s.panel !== null);
  const [dropping, setDropping] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hasProject) useRouter.getState().go("home");
  }, [hasProject]);

  useEffect(() => startAutosave(), []);

  // Modern docks the media bin, so the tool panel opens on the clip inspector instead.
  useEffect(() => {
    if (layout === "modern" && !isMobileUi) {
      const ui = useEditorUi.getState();
      if (ui.panel === "media" || ui.panel === null) useEditorUi.setState({ panel: "effects" });
    }
  }, [layout]);

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
    onSaved((ok) => ok && toast(t("editor.saved"), "success"));
    window.addEventListener("keydown", handleShortcut);
    return () => {
      window.removeEventListener("keydown", handleShortcut);
      onSaved(null);
    };
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

  if (isMobileUi) {
    return (
      <>
        <MobileEditor />
        {exportOpen && <ExportDialog />}
      {shortcutsOpen && <ShortcutsDialog />}
      {renaming && <RenameDialog key={renaming} />}
      </>
    );
  }

  return (
    <div className={`editor${panelOpen ? " panel-open" : ""}${panelSide === "left" ? " panel-left" : ""}${panelWidth ? " panel-sized" : ""}`} style={layoutVars(panelWidth, timelineFrac)} ref={rootRef}>
      <div className="hero">
        {layout === "xenocut" && <Ambient />}
        {layout === "modern" && <DockBin />}
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
      {shortcutsOpen && <ShortcutsDialog />}
      {renaming && <RenameDialog key={renaming} />}
    </div>
  );
}
