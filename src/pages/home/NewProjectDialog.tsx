import { useState } from "react";
import { useEditorUi, type PanelId } from "../../store/editorUi";
import { Modal } from "../../components/Modal";
import { useT } from "../../i18n";
import { createAndOpen } from "../../project/actions";
import { dimensions } from "../../project/ops";
import type { Aspect, Resolution } from "../../project/types";
import { messageOf } from "../../lib/format";
import { toast } from "../../store/toast";

const ASPECTS: { value: Aspect; key: "aspect.landscape" | "aspect.vertical" | "aspect.square" | "aspect.portrait" }[] = [
  { value: "16:9", key: "aspect.landscape" },
  { value: "9:16", key: "aspect.vertical" },
  { value: "1:1", key: "aspect.square" },
  { value: "4:5", key: "aspect.portrait" },
];
const RESOLUTIONS: Resolution[] = ["720p", "1080p", "1440p", "4K"];
const FPS = [24, 30, 60];

/** `panel` opens that editor panel in the new project (a Home quick tool). */
export function NewProjectDialog({ onClose, panel }: { onClose: () => void; panel?: PanelId }) {
  const t = useT();
  const [name, setName] = useState(t("home.untitled"));
  const [aspect, setAspect] = useState<Aspect>("16:9");
  const [resolution, setResolution] = useState<Resolution>("1080p");
  const [fps, setFps] = useState(30);
  const [busy, setBusy] = useState(false);
  const size = dimensions(aspect, resolution);

  const create = async () => {
    setBusy(true);
    try {
      if (panel) useEditorUi.setState({ panel });
      await createAndOpen(name, aspect, resolution, fps);
    } catch (error) {
      toast(messageOf(error), "error");
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t("newProject.title")}
      subtitle={t("newProject.subtitle")}
      onClose={onClose}
      width={600}
      footer={
        <>
          <span className="muted tnum">
            {size.width} × {size.height} · {fps} fps
          </span>
          <span className="spacer" />
          <button className="btn btn-ghost" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={() => void create()}>
            {t("newProject.create")}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="np-name">{t("newProject.name")}</label>
        <input
          id="np-name"
          className="input"
          value={name}
          autoFocus
          maxLength={80}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && name.trim() && !busy && void create()}
        />
      </div>

      <div className="field">
        <span className="label">{t("newProject.aspect")}</span>
        <div className="aspect-grid">
          {ASPECTS.map((a) => {
            const [w, h] = a.value.split(":").map(Number);
            const scale = 34 / Math.max(w, h);
            return (
              <button key={a.value} className={`aspect-card${aspect === a.value ? " active" : ""}`} onClick={() => setAspect(a.value)}>
                <span className="aspect-shape" style={{ width: w * scale, height: h * scale }} />
                <b>{a.value}</b>
                <small>{t(a.key)}</small>
              </button>
            );
          })}
        </div>
      </div>

      <div className="field">
        <span className="label">{t("newProject.resolution")}</span>
        <div className="chip-group">
          {RESOLUTIONS.map((r) => {
            const d = dimensions(aspect, r);
            return (
              <button key={r} className={`chip${resolution === r ? " active" : ""}`} onClick={() => setResolution(r)}>
                {r} <span className="muted tnum">{d.width}×{d.height}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="field">
        <span className="label">{t("newProject.fps")}</span>
        <div className="chip-group">
          {FPS.map((f) => (
            <button key={f} className={`chip${fps === f ? " active" : ""}`} onClick={() => setFps(f)}>
              {f} fps
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
