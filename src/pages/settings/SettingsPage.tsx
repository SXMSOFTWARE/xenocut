import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Cpu, Download, FolderOpen, Gauge, HardDrive, Languages, Save, Trash2 } from "lucide-react";
import { Segmented, Switch } from "../../components/controls";
import { useT } from "../../i18n";
import { api, listen, pickFolder, revealInFolder, type ProgressEvent } from "../../lib/backend";
import { bytes, messageOf } from "../../lib/format";
import { useRouter } from "../../store/router";
import { useSettings, type Language } from "../../store/settings";
import { toast } from "../../store/toast";
import "../../styles/settings.css";

type ModelStatus = Awaited<ReturnType<typeof api.modelStatus>>;

export default function SettingsPage() {
  const t = useT();
  const s = useSettings();
  const back = useRouter((r) => r.back);
  const [cache, setCache] = useState<{ bytes: number; path: string } | null>(null);
  const [model, setModel] = useState<ModelStatus | null>(null);
  const [download, setDownload] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void api.cacheInfo().then(setCache).catch(() => setCache(null));
    void api.modelStatus().then(setModel).catch(() => setModel(null));
  }, []);
  useEffect(refresh, [refresh]);

  const chooseFolder = async (key: "outputDir" | "projectDir") => {
    const picked = await pickFolder(s[key]);
    if (picked) s.update({ [key]: picked });
  };

  const clearCache = async () => {
    setBusy(true);
    try {
      await api.cacheClear();
      toast(t("settings.cacheCleared"), "success");
    } catch (e) {
      toast(messageOf(e), "error");
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const downloadModel = async () => {
    setDownload(0);
    const unlisten = await listen<ProgressEvent>("model-progress", (p) =>
      // The backend reports on the stem-separation scale (download = 8%…34%).
      setDownload(Math.min(1, Math.max(0, (p.progress - 0.08) / 0.26))),
    );
    try {
      await api.modelDownload();
      toast(t("settings.modelReady"), "success");
    } catch (e) {
      const msg = messageOf(e);
      toast(/cancel/i.test(msg) ? t("export.cancelled") : msg, "error");
    } finally {
      unlisten();
      setDownload(null);
      refresh();
    }
  };

  const deleteModel = async () => {
    try {
      await api.modelDelete();
    } catch (e) {
      toast(messageOf(e), "error");
    }
    refresh();
  };

  return (
    <div className="page settings-page">
      <header className="page-top">
        <button className="icon-btn" onClick={back} aria-label={t("editor.back")} title={t("editor.back")}>
          <ArrowLeft />
        </button>
        <h1>{t("settings.title")}</h1>
      </header>
      <div className="page-body">
        <div className="settings-wrap">
          <section className="settings-group">
            <h2 className="section-title">
              <FolderOpen /> {t("settings.folders")}
            </h2>
            <Row title={t("settings.outputDir")} text={t("settings.outputDirText")}>
              <PathPicker path={s.outputDir} onPick={() => void chooseFolder("outputDir")} />
            </Row>
            <Row title={t("settings.projectDir")} text={t("settings.projectDirText")}>
              <PathPicker path={s.projectDir} onPick={() => void chooseFolder("projectDir")} />
            </Row>
          </section>

          <section className="settings-group">
            <h2 className="section-title">
              <Save /> {t("settings.editing")}
            </h2>
            <Row title={t("settings.autosave")} text={t("settings.autosaveText")}>
              <Switch on={s.autosave} onChange={(v) => s.update({ autosave: v })} label={t("settings.autosave")} />
            </Row>
            <Row title={t("settings.language")} text={t("settings.languageText")} icon={<Languages />}>
              <Segmented<Language>
                value={s.language}
                onChange={(v) => s.update({ language: v })}
                options={[
                  { value: "tr", label: "Türkçe" },
                  { value: "en", label: "English" },
                ]}
              />
            </Row>
          </section>

          <section className="settings-group">
            <h2 className="section-title">
              <Gauge /> {t("settings.performance")}
            </h2>
            <Row title={t("settings.perfMode")} text={t("settings.perfModeText")}>
              <Switch on={s.performanceMode} onChange={(v) => s.update({ performanceMode: v })} label={t("settings.perfMode")} />
            </Row>
            <Row title={t("settings.cache")} text={t("settings.cacheText")} icon={<HardDrive />}>
              <div className="row-actions">
                <span className="stat tnum">{cache ? bytes(cache.bytes) : "—"}</span>
                {cache && (
                  <button className="icon-btn sm" onClick={() => void revealInFolder(cache.path)} title={t("export.openFolder")} aria-label={t("export.openFolder")}>
                    <FolderOpen />
                  </button>
                )}
                <button className="btn btn-sm" onClick={() => void clearCache()} disabled={busy || !cache?.bytes}>
                  <Trash2 /> {t("settings.clear")}
                </button>
              </div>
            </Row>
          </section>

          <section className="settings-group">
            <h2 className="section-title">
              <Cpu /> {t("settings.ai")}
            </h2>
            <Row title={t("settings.stemModel")} text={t("settings.stemModelText")}>
              <div className="row-actions">
                {download !== null ? (
                  <>
                    <div className="progress mini">
                      <i style={{ width: `${Math.max(2, download * 100)}%` }} />
                    </div>
                    <span className="stat tnum">{Math.round(download * 100)}%</span>
                    <button className="btn btn-sm btn-ghost" onClick={() => void api.audioCancel()}>
                      {t("common.cancel")}
                    </button>
                  </>
                ) : model?.installed ? (
                  <>
                    <span className="status-pill ok">
                      {t("settings.installed")} · {bytes(model.bytes)}
                    </span>
                    <button className="btn btn-sm btn-danger" onClick={() => void deleteModel()}>
                      <Trash2 /> {t("settings.delete")}
                    </button>
                  </>
                ) : (
                  <>
                    <span className="status-pill">{t("settings.notInstalled")}</span>
                    <button className="btn btn-sm btn-primary" onClick={() => void downloadModel()}>
                      <Download /> {t("settings.download")}
                    </button>
                  </>
                )}
              </div>
            </Row>
            {model && <p className="path-note settings-note">{model.name} · {model.path}</p>}
          </section>

          <section className="settings-group about">
            <span className="muted">
              XenoCut {s.info?.version ?? ""} · {s.info?.os ?? ""}
            </span>
          </section>
        </div>
      </div>
    </div>
  );
}

function Row({ title, text, icon, children }: { title: string; text: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-label">
        <b>
          {icon}
          {title}
        </b>
        <span className="muted">{text}</span>
      </div>
      <div className="settings-control">{children}</div>
    </div>
  );
}

function PathPicker({ path, onPick }: { path: string; onPick: () => void }) {
  const t = useT();
  return (
    <div className="path-field">
      <span className="path" title={path}>
        <bdi>{path}</bdi>
      </span>
      <button className="btn btn-sm" onClick={onPick}>
        {t("common.change")}
      </button>
    </div>
  );
}
