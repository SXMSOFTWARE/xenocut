import { useState } from "react";
import { Modal } from "../../components/Modal";
import { useT } from "../../i18n";
import { useEditorUi } from "../../store/editorUi";
import { renameClip, renameTrack } from "./edit";

/** Name a clip or a track. */
export function RenameDialog() {
  const t = useT();
  const target = useEditorUi((s) => s.rename);
  const [value, setValue] = useState(target?.value ?? "");
  if (!target) return null;
  const close = () => useEditorUi.setState({ rename: null });
  const done = () => {
    if (target.kind === "clip") renameClip(target.id, value);
    else renameTrack(target.id, value);
    close();
  };
  return (
    <Modal
      title={t(target.kind === "clip" ? "menu.renameClip" : "menu.renameTrack")}
      onClose={close}
      width={380}
      footer={
        <>
          <button className="btn btn-sm btn-ghost" onClick={close}>
            {t("common.cancel")}
          </button>
          <button className="btn btn-sm btn-primary" onClick={done}>
            {t("common.ok")}
          </button>
        </>
      }
    >
      <input
        className="input"
        autoFocus
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") done();
        }}
      />
    </Modal>
  );
}
