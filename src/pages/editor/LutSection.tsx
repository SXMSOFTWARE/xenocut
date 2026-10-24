// Per-clip colour LUTs from installed plugin packs (Color panel). The swatches run the
// .cube on the CPU over a small poster frame; the preview uses LutView and export lut3d.
import { useEffect, useMemo, useState } from "react";
import { Ban, Palette, Puzzle } from "lucide-react";
import { Slider } from "../../components/controls";
import { useT } from "../../i18n";
import { applyCube, enabledPacks, loadCube, packFile, usePlugins } from "../../lib/plugins";
import { updateClip } from "../../project/ops";
import type { Clip } from "../../project/types";
import { useProject } from "../../store/project";
import { useRouter } from "../../store/router";
import { usePosterThumb } from "./SidePanel";

interface LutItem {
  path: string;
  name: string;
  pack: string;
}

const swatches = new Map<string, Promise<string | null>>();

/** A data URL of `thumb` graded by the cube at `path` (null when the frame can't be read). */
function lutSwatch(thumb: string, path: string): Promise<string | null> {
  const key = thumb + "\n" + path;
  let job = swatches.get(key);
  if (!job) {
    job = (async () => {
      const cube = await loadCube(path);
      if (!cube) return null;
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = thumb;
      await img.decode();
      const w = 192;
      const h = Math.max(1, Math.round((w * img.naturalHeight) / Math.max(1, img.naturalWidth)));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h); // throws on a tainted frame -> null
      const px = data.data;
      const out = [0, 0, 0];
      for (let i = 0; i < px.length; i += 4) {
        applyCube(cube, px[i] / 255, px[i + 1] / 255, px[i + 2] / 255, out);
        px[i] = out[0] * 255;
        px[i + 1] = out[1] * 255;
        px[i + 2] = out[2] * 255;
      }
      ctx.putImageData(data, 0, 0);
      return canvas.toDataURL("image/jpeg", 0.85);
    })().catch(() => null);
    swatches.set(key, job);
  }
  return job;
}

function Swatch({ thumb, path }: { thumb: string | null; path: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setSrc(null);
    if (thumb) void lutSwatch(thumb, path).then((s) => live && setSrc(s));
    return () => {
      live = false;
    };
  }, [thumb, path]);
  const bg = src ?? thumb;
  return <span className={`grade-swatch${src ? "" : " pending"}`} style={{ backgroundImage: bg ? `url("${bg}")` : undefined }} />;
}

/** The selected video/image clip (not text, effect layers or audio). */
function useLutClip(): Clip | null {
  const project = useProject((s) => s.project);
  const selection = useProject((s) => s.selection);
  return useMemo(() => {
    if (!project || selection.length !== 1) return null;
    const clip = project.clips.find((c) => c.id === selection[0]);
    if (!clip || clip.text) return null;
    const media = project.media.find((m) => m.id === clip.mediaId);
    return media && (media.kind === "video" || media.kind === "image") ? clip : null;
  }, [project, selection]);
}

export function LutSection() {
  const t = useT();
  const go = useRouter((r) => r.go);
  const installed = usePlugins((s) => s.installed);
  const thumb = usePosterThumb();
  const clip = useLutClip();
  const luts = useMemo<LutItem[]>(
    () => enabledPacks(installed).flatMap((p) => (p.manifest.luts ?? []).map((l) => ({ path: packFile(p, l.file), name: l.name, pack: p.manifest.name }))),
    [installed],
  );
  const current = clip?.lut;
  const set = (item: LutItem | null) => {
    if (!clip) return;
    useProject.getState().commit((p) => updateClip(p, clip.id, { lut: item ? { path: item.path, name: item.name, amount: current?.amount ?? 1 } : undefined }));
  };
  const { beginGesture, endGesture, transient } = useProject.getState();

  return (
    <div className="lut-section" data-lut-section>
      <h3 className="section-title">
        <Palette size={13} /> {t("lut.title")}
        <button className="link-btn" onClick={() => go("plugins")}>
          <Puzzle size={12} /> {t("plugins.getMore")}
        </button>
      </h3>
      {luts.length === 0 ? (
        <p className="sp-note">{t("lut.empty")}</p>
      ) : (
        <>
          {!clip && <p className="sp-note">{t("lut.pickClip")}</p>}
          <div className="grade-grid lut-grid">
            <button className={`grade-card${clip && !current ? " active" : ""}`} disabled={!clip} onClick={() => set(null)} aria-pressed={!!clip && !current}>
              <span className="grade-swatch none" style={{ backgroundImage: thumb ? `url("${thumb}")` : undefined }}>
                <Ban size={16} />
              </span>
              <span>{t("lut.none")}</span>
            </button>
            {luts.map((l) => {
              const on = current?.path === l.path;
              return (
                <button key={l.path} className={`grade-card${on ? " active" : ""}`} disabled={!clip} onClick={() => set(l)} aria-pressed={on} title={`${l.name} · ${l.pack}`} data-lut={l.name}>
                  <Swatch thumb={thumb} path={l.path} />
                  <span>{l.name}</span>
                </button>
              );
            })}
          </div>
          {clip && current && (
            <Slider
              label={t("lut.amount")}
              value={current.amount}
              min={0}
              max={1}
              step={0.01}
              format={(v) => `${Math.round(v * 100)}%`}
              onStart={beginGesture}
              onEnd={endGesture}
              onChange={(v) => transient((p) => updateClip(p, clip.id, { lut: { ...current, amount: Math.round(v * 100) / 100 } }))}
            />
          )}
        </>
      )}
    </div>
  );
}
