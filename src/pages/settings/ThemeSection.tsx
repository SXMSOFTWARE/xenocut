import { useState, type CSSProperties } from "react";
import { Download, Palette, RotateCcw, Save, Trash2, Upload } from "lucide-react";
import { Segmented, Slider } from "../../components/controls";
import { useT, type Key } from "../../i18n";
import { call, pickFiles, pickSavePath } from "../../lib/backend";
import { messageOf } from "../../lib/format";
import { usePlugins } from "../../lib/plugins";
import { isMobileUi } from "../../lib/platform";
import { useSettings } from "../../store/settings";
import { toast } from "../../store/toast";
import { themePackManifest, themeVars, type Density, type LayoutKind, type ThemeDef } from "../../themes";
import { useAllThemes, useCurrentTheme } from "../../themes/useTheme";

const LAYOUT_TEXT: Record<LayoutKind, Key> = {
  xenocut: "theme.layoutXenocut",
  modern: "theme.layoutModern",
  basic: "theme.layoutBasic",
  classic: "theme.layoutClassic",
};

/** The panel side a layout starts with (Classic is Premiere-like: tools on the left). */
const sideOf = (layout: LayoutKind) => (layout === "classic" ? "left" : "right");

/** A tiny schematic of the layout, painted in the theme's own colours. */
function Thumb({ theme }: { theme: ThemeDef }) {
  const vars = themeVars(theme);
  const style = Object.fromEntries(Object.entries(vars).filter(([k]) => !k.startsWith("--fs-"))) as CSSProperties;
  return (
    <div className={`th-thumb th-${theme.layout}`} style={style} aria-hidden>
      <i className="th-rail" />
      <i className="th-title" />
      {theme.layout === "modern" && <i className="th-bin" />}
      <i className="th-stage" />
      <i className="th-panel" />
      <i className="th-tl">
        <b />
        <b />
      </i>
    </div>
  );
}

export function ThemeSection() {
  const t = useT();
  const s = useSettings();
  const all = useAllThemes();
  const current = useCurrentTheme();
  const install = usePlugins((p) => p.install);
  const [name, setName] = useState("");
  const tweaks = s.themeTweaks;
  const tweaked = Object.keys(tweaks).length > 0;

  const choose = (theme: ThemeDef) => s.update({ theme: theme.id, themeTweaks: {}, panelSide: sideOf(theme.layout) });
  const tweak = (patch: Partial<typeof tweaks>) => s.update({ themeTweaks: { ...tweaks, ...patch } });

  const saveMine = () => {
    const label = name.trim() || `${current.name} *`;
    const id = `my-${Date.now().toString(36)}`;
    const mine: ThemeDef = { ...current, id, name: label.slice(0, 48), source: "user" };
    s.update({ userThemes: [...s.userThemes, mine], theme: id, themeTweaks: {} });
    setName("");
    toast(t("theme.saved"), "success");
  };

  const removeMine = (id: string) => {
    s.update({ userThemes: s.userThemes.filter((u) => u.id !== id), ...(s.theme === id ? { theme: "xenocut", themeTweaks: {} } : {}) });
  };

  const exportTheme = async () => {
    const manifest = themePackManifest(current, "");
    const file = `${s.outputDir || "."}/${manifest.id}.xcpack`;
    const path = await pickSavePath(file, [{ name: "XenoCut pack", extensions: ["xcpack"] }]);
    if (!path) return;
    try {
      await call("plugin_export", { manifest, path });
      toast(t("theme.exported", { path }), "success");
    } catch (e) {
      toast(messageOf(e), "error");
    }
  };

  const importTheme = async () => {
    const [path] = await pickFiles([{ name: "XenoCut pack", extensions: ["xcpack", "zip"] }], false);
    if (!path) return;
    try {
      const pack = await install(path);
      const theme = pack.manifest.themes?.[0];
      if (!theme) throw new Error(t("theme.noTheme"));
      s.update({ theme: theme.id, themeTweaks: {}, panelSide: sideOf(theme.layout) });
      toast(t("theme.imported", { name: theme.name }), "success");
    } catch (e) {
      toast(messageOf(e), "error");
    }
  };

  return (
    <section className="settings-group" id="themes">
      <h2 className="section-title">
        <Palette /> {t("theme.title")}
      </h2>
      <p className="muted th-intro">{t(isMobileUi ? "theme.introMobile" : "theme.intro")}</p>
      <div className="th-grid" role="radiogroup" aria-label={t("theme.title")}>
        {all.map((theme) => {
          const active = theme.id === s.theme;
          return (
            <div key={theme.id} className={`th-card${active ? " active" : ""}`}>
              <button className="th-pick" role="radio" aria-checked={active} onClick={() => choose(theme)} data-theme-id={theme.id}>
                <Thumb theme={active ? current : theme} />
                <span className="th-name">{theme.name}</span>
                <span className="th-sub">
                  {t(LAYOUT_TEXT[theme.layout])}
                  {theme.source && theme.source !== "builtin" && theme.source !== "user" ? ` · ${t("theme.fromPack")}` : theme.source === "user" ? ` · ${t("theme.mine")}` : ""}
                </span>
              </button>
              {theme.source === "user" && (
                <button className="icon-btn sm th-del" onClick={() => removeMine(theme.id)} title={t("settings.delete")} aria-label={t("settings.delete")}>
                  <Trash2 />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="settings-row">
        <div className="settings-label">
          <b>{t("theme.accent")}</b>
          <span className="muted">{t("theme.accentText")}</span>
        </div>
        <div className="settings-control row-actions">
          <input type="color" className="th-color" value={current.accent || "#ff5e3a"} onChange={(e) => tweak({ accent: e.target.value })} aria-label={t("theme.accent")} />
          {["#ff5e3a", "#4f8cff", "#2fc8a8", "#a77bff", "#ff4f9a", "#f5c46b"].map((c) => (
            <button key={c} className={`th-swatch${current.accent === c ? " on" : ""}`} style={{ background: c }} onClick={() => tweak({ accent: c })} aria-label={c} title={c} />
          ))}
        </div>
      </div>
      <div className="settings-row">
        <div className="settings-label">
          <b>{t("theme.density")}</b>
          <span className="muted">{t("theme.densityText")}</span>
        </div>
        <div className="settings-control">
          <Segmented<Density>
            value={current.density}
            onChange={(v) => tweak({ density: v })}
            options={[
              { value: "compact", label: t("theme.compact") },
              { value: "normal", label: t("theme.normal") },
              { value: "comfortable", label: t("theme.comfortable") },
            ]}
          />
        </div>
      </div>
      <div className="settings-row">
        <div className="settings-label">
          <b>{t("theme.shape")}</b>
          <span className="muted">{t("theme.shapeText")}</span>
        </div>
        <div className="settings-control th-sliders">
          <Slider label={t("theme.radius")} value={current.radius} min={0} max={1.5} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => tweak({ radius: v })} />
          <Slider label={t("theme.fontSize")} value={current.fontScale} min={0.85} max={1.25} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => tweak({ fontScale: v })} />
        </div>
      </div>
      {!isMobileUi && (
        <div className="settings-row">
          <div className="settings-label">
            <b>{t("theme.panelSide")}</b>
            <span className="muted">{t("theme.panelSideText")}</span>
          </div>
          <div className="settings-control">
            <Segmented<"left" | "right">
              value={s.panelSide}
              onChange={(v) => s.update({ panelSide: v })}
              options={[
                { value: "left", label: t("theme.left") },
                { value: "right", label: t("theme.right") },
              ]}
            />
          </div>
        </div>
      )}
      <div className="settings-row">
        <div className="settings-label">
          <b>{t("theme.mineTitle")}</b>
          <span className="muted">{t("theme.mineText")}</span>
        </div>
        <div className="settings-control row-actions th-actions">
          <input className="input th-name-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={`${current.name} *`} maxLength={48} aria-label={t("theme.nameLabel")} />
          <button className="btn btn-sm" onClick={saveMine}>
            <Save /> {t("theme.save")}
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => s.update({ themeTweaks: {} })} disabled={!tweaked}>
            <RotateCcw /> {t("theme.reset")}
          </button>
        </div>
      </div>
      <div className="settings-row">
        <div className="settings-label">
          <b>{t("theme.share")}</b>
          <span className="muted">{t("theme.shareText")}</span>
        </div>
        <div className="settings-control row-actions">
          <button className="btn btn-sm th-export" onClick={() => void exportTheme()}>
            <Download /> {t("theme.export")}
          </button>
          <button className="btn btn-sm th-import" onClick={() => void importTheme()}>
            <Upload /> {t("theme.import")}
          </button>
        </div>
      </div>
    </section>
  );
}
