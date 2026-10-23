import { useEffect, useRef, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { useT } from "../../i18n";
import { importDialog } from "../../project/actions";
import { useEditorUi } from "../../store/editorUi";
import { useProject } from "../../store/project";

/** Top-centre frosted project-name pill with a pencil, plus the round import button. */
export function TitleBar() {
  const t = useT();
  const name = useProject((s) => s.project?.name ?? "");
  const saveState = useProject((s) => s.saveState);
  const saveError = useProject((s) => s.saveError);
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(name), [name]);

  const rename = () => {
    const value = draft.trim();
    if (!value) return setDraft(name);
    if (value !== name) useProject.getState().commit((p) => ({ ...p, name: value }));
  };

  const doImport = async () => {
    setBusy(true);
    try {
      const items = await importDialog();
      if (items.length) useEditorUi.setState({ panel: "media" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="title-row">
      <label className="title-pill" title={saveError ?? t(`save.${saveState}`)}>
        <i className={`save-dot ${saveState}`} />
        <input
          ref={input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={rename}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setDraft(name);
              e.currentTarget.blur();
            }
          }}
          aria-label={t("newProject.name")}
          spellCheck={false}
          size={Math.max(6, Math.min(32, draft.length + 1))}
          maxLength={80}
        />
        <button className="title-edit" onClick={() => input.current?.select()} title={t("editor.rename")} aria-label={t("editor.rename")}>
          <Pencil size={11} strokeWidth={2} />
        </button>
      </label>
      <button className="glass-btn" onClick={() => void doImport()} disabled={busy} title={t("editor.import")} aria-label={t("editor.import")}>
        <Plus size={15} strokeWidth={1.9} />
      </button>
    </div>
  );
}
