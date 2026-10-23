import { useEffect, useState } from "react";
import { AlertCircle, Check, ChevronLeft, Download, LoaderCircle, Redo2, Undo2 } from "lucide-react";
import { LogoMark } from "../../components/Logo";
import { useT } from "../../i18n";
import { useEditorUi } from "../../store/editorUi";
import { useProject } from "../../store/project";
import { useRouter } from "../../store/router";

export function TopBar() {
  const t = useT();
  const name = useProject((s) => s.project?.name ?? "");
  const settings = useProject((s) => s.project?.settings);
  const saveState = useProject((s) => s.saveState);
  const saveError = useProject((s) => s.saveError);
  const canUndo = useProject((s) => s.past.length > 0);
  const canRedo = useProject((s) => s.future.length > 0);
  const hasClips = useProject((s) => (s.project?.clips.length ?? 0) > 0);
  const [draft, setDraft] = useState(name);

  useEffect(() => setDraft(name), [name]);

  const rename = () => {
    const value = draft.trim();
    if (!value) return setDraft(name);
    if (value !== name) useProject.getState().commit((p) => ({ ...p, name: value }));
  };

  const leave = async () => {
    const s = useProject.getState();
    if (s.saveState === "dirty") await s.save();
    s.close();
    useRouter.getState().go("home");
  };

  return (
    <header className="topbar">
      <button className="icon-btn" onClick={() => void leave()} title={t("editor.back")} aria-label={t("editor.back")}>
        <ChevronLeft />
      </button>
      <LogoMark size={26} />
      <input
        className="project-name"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={rename}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(name);
            (e.target as HTMLInputElement).blur();
          }
        }}
        aria-label={t("newProject.name")}
        spellCheck={false}
        size={Math.max(8, draft.length + 1)}
        maxLength={80}
      />
      <span className={`save-state ${saveState}`} title={saveError ?? undefined}>
        {saveState === "saved" && <Check />}
        {saveState === "saving" && <LoaderCircle className="spin" />}
        {saveState === "error" && <AlertCircle />}
        {saveState === "dirty" && <i className="dot" />}
        {t(`save.${saveState}`)}
      </span>
      {settings && (
        <span className="chip tnum">
          {settings.width}×{settings.height} · {settings.fps} fps
        </span>
      )}
      <div className="spacer" />
      <button className="icon-btn" disabled={!canUndo} onClick={() => useProject.getState().undo()} title={`${t("editor.undo")} (Ctrl+Z)`} aria-label={t("editor.undo")}>
        <Undo2 />
      </button>
      <button className="icon-btn" disabled={!canRedo} onClick={() => useProject.getState().redo()} title={`${t("editor.redo")} (Ctrl+Shift+Z)`} aria-label={t("editor.redo")}>
        <Redo2 />
      </button>
      <button className="btn btn-primary" disabled={!hasClips} onClick={() => useEditorUi.setState({ exportOpen: true })}>
        <Download />
        {t("export.button")}
      </button>
    </header>
  );
}
