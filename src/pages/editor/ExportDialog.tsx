import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Download, FolderOpen, XCircle } from "lucide-react";
import { Segmented } from "../../components/controls";
import { Modal } from "../../components/Modal";
import { useT } from "../../i18n";
import { api, listen, pickSavePath, revealInFolder, type ExportOptions, type ProgressEvent } from "../../lib/backend";
import { bytes, joinPath, messageOf, timecode } from "../../lib/format";
import { dimensions, projectDuration } from "../../project/ops";
import type { Resolution } from "../../project/types";
import { useEditorUi } from "../../store/editorUi";
import { useProject } from "../../store/project";
import { useSettings } from "../../store/settings";

type Phase = { kind: "setup" } | { kind: "running"; progress: number } | { kind: "done"; path: string; bytes: number; seconds: number } | { kind: "error"; message: string } | { kind: "cancelled" };

const SAFE = /[\\/:*?"<>|]+/g;

export function ExportDialog() {
  const t = useT();
  const project = useProject((s) => s.project)!;
  const outputDir = useSettings((s) => s.outputDir);
  const [path, setPath] = useState(() => joinPath(outputDir, `${project.name.replace(SAFE, "_").trim() || "export"}.mp4`));
  const [resolution, setResolution] = useState<"project" | Resolution>("project");
  const [fps, setFps] = useState<number>(project.settings.fps);
  const [quality, setQuality] = useState<ExportOptions["quality"]>("balanced");
  const [phase, setPhase] = useState<Phase>({ kind: "setup" });
  const [exists, setExists] = useState(false);
  const duration = projectDuration(project);

  const size = useMemo(
    () => (resolution === "project" ? { width: project.settings.width, height: project.settings.height } : dimensions(project.settings.aspect, resolution)),
    [resolution, project.settings],
  );

  useEffect(() => {
    void api.pathsExist([path]).then(([e]) => setExists(!!e));
  }, [path]);

  const close = () => {
    if (phase.kind === "running") return;
    useEditorUi.setState({ exportOpen: false });
  };

  const choose = async () => {
    const picked = await pickSavePath(path, [{ name: "MP4", extensions: ["mp4"] }]);
    if (picked) setPath(picked.toLowerCase().endsWith(".mp4") ? picked : `${picked}.mp4`);
  };

  const start = async () => {
    setPhase({ kind: "running", progress: 0 });
    const began = performance.now();
    const unlisten = await listen<ProgressEvent>("export-progress", (p) =>
      setPhase((prev) => (prev.kind === "running" ? { kind: "running", progress: p.progress } : prev)),
    );
    try {
      const result = await api.exportStart(project, { outputPath: path, width: size.width, height: size.height, fps, quality });
      setPhase({ kind: "done", path: result.path, bytes: result.bytes, seconds: (performance.now() - began) / 1000 });
    } catch (error) {
      const message = messageOf(error);
      setPhase(/cancel/i.test(message) ? { kind: "cancelled" } : { kind: "error", message });
    } finally {
      unlisten();
    }
  };

  const resOptions: ("project" | Resolution)[] = ["project", "720p", "1080p", "1440p", "4K"];

  return (
    <Modal
      title={t("export.title")}
      subtitle={`${project.name} · ${timecode(duration, project.settings.fps)}`}
      onClose={close}
      dismissable={phase.kind !== "running"}
      width={560}
      footer={
        phase.kind === "setup" ? (
          <>
            <span className="muted tnum">
              MP4 · H.264 · AAC · {size.width}×{size.height} · {fps} fps
            </span>
            <span className="spacer" />
            <button className="btn btn-ghost" onClick={close}>
              {t("common.cancel")}
            </button>
            <button className="btn btn-primary" onClick={() => void start()} disabled={duration <= 0 || !path}>
              <Download />
              {t("export.start")}
            </button>
          </>
        ) : phase.kind === "running" ? (
          <button className="btn btn-danger" onClick={() => void api.exportCancel()}>
            {t("common.cancel")}
          </button>
        ) : (
          <>
            {phase.kind === "done" && (
              <button className="btn" onClick={() => void revealInFolder(phase.path)}>
                <FolderOpen />
                {t("export.openFolder")}
              </button>
            )}
            <span className="spacer" />
            {phase.kind !== "done" && (
              <button className="btn btn-ghost" onClick={() => setPhase({ kind: "setup" })}>
                {t("export.back")}
              </button>
            )}
            <button className="btn btn-primary" onClick={close}>
              {t("common.close")}
            </button>
          </>
        )
      }
    >
      {phase.kind === "setup" && (
        <>
          <div className="field">
            <span className="label">{t("export.output")}</span>
            <div className="path-field">
              <span className="path" title={path}>
                <bdi>{path}</bdi>
              </span>
              <button className="btn btn-sm" onClick={() => void choose()}>
                {t("common.change")}
              </button>
            </div>
            {exists && <small className="warn-text">{t("export.overwrite")}</small>}
          </div>
          <div className="field">
            <span className="label">{t("export.resolution")}</span>
            <div className="chip-group">
              {resOptions.map((r) => {
                const d = r === "project" ? project.settings : dimensions(project.settings.aspect, r);
                return (
                  <button key={r} className={`chip${resolution === r ? " active" : ""}`} onClick={() => setResolution(r)}>
                    {r === "project" ? t("export.projectRes") : r}
                    <span className="muted tnum">
                      {d.width}×{d.height}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="field">
            <span className="label">{t("export.fps")}</span>
            <div className="chip-group">
              {[24, 25, 30, 50, 60].map((f) => (
                <button key={f} className={`chip${fps === f ? " active" : ""}`} onClick={() => setFps(f)}>
                  {f} fps{f === project.settings.fps ? ` · ${t("export.projectShort")}` : ""}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="label">{t("export.quality")}</span>
            <Segmented
              value={quality}
              onChange={setQuality}
              options={[
                { value: "fast", label: t("export.q.fast") },
                { value: "balanced", label: t("export.q.balanced") },
                { value: "high", label: t("export.q.high") },
              ]}
            />
            <small className="muted">{t(`export.qText.${quality}`)}</small>
          </div>
        </>
      )}

      {phase.kind === "running" && (
        <div className="export-run">
          <div className="export-pct tnum">{Math.round(phase.progress * 100)}%</div>
          <div className="progress">
            <i style={{ width: `${Math.max(2, phase.progress * 100)}%` }} />
          </div>
          <p className="muted">{t("export.rendering")}</p>
        </div>
      )}

      {phase.kind === "done" && (
        <div className="export-result ok">
          <CheckCircle2 />
          <div>
            <b>{t("export.done")}</b>
            <p className="path-note">{phase.path}</p>
            <p className="muted tnum">
              {bytes(phase.bytes)} · {timecode(duration, fps)} · {t("export.took", { s: phase.seconds.toFixed(1) })}
            </p>
          </div>
        </div>
      )}

      {(phase.kind === "error" || phase.kind === "cancelled") && (
        <div className="export-result bad">
          <XCircle />
          <div>
            <b>{phase.kind === "cancelled" ? t("export.cancelled") : t("export.failed")}</b>
            {phase.kind === "error" && <p className="path-note">{phase.message}</p>}
          </div>
        </div>
      )}
    </Modal>
  );
}
