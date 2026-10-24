import { Modal } from "../../components/Modal";
import { useT } from "../../i18n";
import { useEditorUi } from "../../store/editorUi";
import { useSettings } from "../../store/settings";
import { useRouter } from "../../store/router";
import { ACTIONS, actionLabel, groupLabel, keysOf, prettyCombo, type ShortcutGroup } from "./shortcuts";

const GROUPS: ShortcutGroup[] = ["playback", "edit", "clipboard", "timeline", "app"];

export function KeyCombo({ combo }: { combo: string }) {
  return (
    <span className="combo">
      {prettyCombo(combo).map((k, i) => (
        <kbd key={i} className="kbd">
          {k}
        </kbd>
      ))}
    </span>
  );
}

/** Cheat sheet of every shortcut (? key). */
export function ShortcutsDialog() {
  const t = useT();
  const overrides = useSettings((s) => s.shortcuts);
  const close = () => useEditorUi.setState({ shortcutsOpen: false });
  return (
    <Modal
      title={t("sc.title")}
      subtitle={t("sc.subtitle")}
      onClose={close}
      width={1000}
      footer={
        <button
          className="btn btn-sm"
          onClick={() => {
            close();
            useRouter.getState().go("settings");
          }}
        >
          {t("sc.customize")}
        </button>
      }
    >
      <div className="sc-sheet">
        {GROUPS.map((g) => (
          <section key={g} className="sc-group">
            <h3 className="section-title">{t(groupLabel(g))}</h3>
            {ACTIONS.filter((a) => a.group === g).map((a) => {
              const keys = keysOf(a.id, overrides);
              return (
                <div key={a.id} className="sc-row">
                  <span>{t(actionLabel(a.id))}</span>
                  <span className="sc-keys">
                    {keys.length ? keys.map((k) => <KeyCombo key={k} combo={k} />) : <span className="muted">—</span>}
                  </span>
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </Modal>
  );
}
