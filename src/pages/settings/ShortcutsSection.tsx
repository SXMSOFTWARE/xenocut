import { useEffect, useState } from "react";
import { Keyboard, Plus, RotateCcw, X } from "lucide-react";
import { useT } from "../../i18n";
import { useSettings } from "../../store/settings";
import { KeyCombo } from "../editor/ShortcutsDialog";
import { ACTIONS, actionLabel, comboOf, conflicts, groupLabel, keysOf, normalizeCombo, type ShortcutGroup } from "../editor/shortcuts";

const GROUPS: ShortcutGroup[] = ["playback", "edit", "clipboard", "timeline", "app"];

/** Rebind keyboard shortcuts: remove a key, record a new one, reset. */
export function ShortcutsSection() {
  const t = useT();
  const overrides = useSettings((s) => s.shortcuts);
  const update = useSettings((s) => s.update);
  const [recording, setRecording] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const clash = conflicts(overrides);

  const setKeys = (id: string, keys: string[]) => {
    const defaults = ACTIONS.find((a) => a.id === id)?.keys ?? [];
    const next = { ...overrides };
    if (keys.length === defaults.length && keys.every((k, i) => normalizeCombo(k) === normalizeCombo(defaults[i]))) delete next[id];
    else next[id] = keys;
    update({ shortcuts: next });
  };

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecording(null);
        return;
      }
      const combo = comboOf(e);
      if (!combo) return;
      const keys = keysOf(recording, useSettings.getState().shortcuts);
      if (!keys.some((k) => normalizeCombo(k) === normalizeCombo(combo))) setKeys(recording, [...keys, combo]);
      setRecording(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  return (
    <section className="settings-group">
      <h2 className="section-title">
        <Keyboard /> {t("sc.title")}
      </h2>
      <div className="settings-row">
        <div className="settings-label">
          <b>{t("sc.settingsTitle")}</b>
          <span className="muted">{t("sc.settingsText")}</span>
        </div>
        <div className="settings-control row-actions">
          <button className="btn btn-sm btn-ghost" onClick={() => update({ shortcuts: {} })} disabled={!Object.keys(overrides).length}>
            <RotateCcw /> {t("sc.resetAll")}
          </button>
          <button className="btn btn-sm" onClick={() => setOpen(!open)}>
            {open ? t("about.ossHide") : t("sc.edit")}
          </button>
        </div>
      </div>
      {open && (
        <div className="sc-editor">
          {GROUPS.map((g) => (
            <div key={g} className="sc-group">
              <h3 className="section-title">{t(groupLabel(g))}</h3>
              {ACTIONS.filter((a) => a.group === g).map((a) => {
                const keys = keysOf(a.id, overrides);
                return (
                  <div key={a.id} className={`sc-row${clash.has(a.id) ? " clash" : ""}`}>
                    <span>
                      {t(actionLabel(a.id))}
                      {clash.has(a.id) && <small className="sc-clash">{t("sc.conflict")}</small>}
                    </span>
                    <span className="sc-keys">
                      {keys.map((k) => (
                        <span key={k} className="sc-chip">
                          <KeyCombo combo={k} />
                          <button className="sc-x" aria-label={t("settings.delete")} onClick={() => setKeys(a.id, keys.filter((x) => x !== k))}>
                            <X />
                          </button>
                        </span>
                      ))}
                      <button className={`sc-add${recording === a.id ? " rec" : ""}`} onClick={() => setRecording(recording === a.id ? null : a.id)} title={t("sc.record")}>
                        {recording === a.id ? t("sc.pressKey") : <Plus />}
                      </button>
                      {overrides[a.id] && (
                        <button className="sc-add" onClick={() => setKeys(a.id, ACTIONS.find((x) => x.id === a.id)!.keys)} title={t("sc.reset")}>
                          <RotateCcw />
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
