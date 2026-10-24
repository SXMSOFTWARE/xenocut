// OpenFX / frei0r plug-ins on the selected clip (Effects panel, desktop Linux). The parameter
// controls are generated from what each plug-in describes (lib/nativefx.ts); the values are
// stored on the clip and used by both the preview and the export bake.
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Puzzle, RefreshCw, RotateCcw, ShieldOff, Trash2 } from "lucide-react";
import { Slider, Switch } from "../../components/controls";
import { useT } from "../../i18n";
import { isTauri } from "../../lib/backend";
import { describeNative, useNativeFx, type NativeParam, type NativePlugin } from "../../lib/nativefx";
import { updateClip } from "../../project/ops";
import type { Clip, NativeFx } from "../../project/types";
import { useProject } from "../../store/project";
import { useSettings } from "../../store/settings";

/** True where the effect host exists (desktop Linux; the dev browser mocks it). */
export function useNativeFxSupported(): boolean {
  const os = useSettings((s) => s.info?.os);
  return os === "linux" && (isTauri || import.meta.env.DEV);
}

function useNativeClip(): Clip | null {
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

/** "InvertOFX" -> "Invert" (openfx-misc names carry the suffix). */
export const pluginName = (p: Pick<NativePlugin, "label" | "id">) => (p.label || p.id.replace(/^\w+:/, "")).replace(/(?<=[a-z0-9])OFX$/, "");

const setChain = (clip: Clip, chain: NativeFx[]) => useProject.getState().commit((p) => updateClip(p, clip.id, { nativeFx: chain.length ? chain : undefined }));

export function NativeFxSection() {
  const t = useT();
  const supported = useNativeFxSupported();
  const { catalog, loading, load, unblock } = useNativeFx();
  const clip = useNativeClip();
  const [query, setQuery] = useState("");
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  useEffect(() => {
    if (supported) void load();
  }, [supported, load]);

  const byId = useMemo(() => new Map((catalog?.plugins ?? []).map((p) => [p.id, p])), [catalog]);
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = new Map<string, NativePlugin[]>();
    for (const p of catalog?.plugins ?? []) {
      if (q && !`${pluginName(p)} ${p.group} ${p.description}`.toLowerCase().includes(q)) continue;
      const g = p.kind === "frei0r" ? "frei0r" : p.group || "OpenFX";
      out.set(g, [...(out.get(g) ?? []), p]);
    }
    for (const list of out.values()) list.sort((a, b) => pluginName(a).localeCompare(pluginName(b)));
    return [...out.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [catalog, query]);

  if (!supported) return null;
  const blocked = Object.keys(catalog?.blocked ?? {});
  const chain = clip?.nativeFx ?? [];
  const userDir = (kind: string) => catalog?.dirs.find((d) => d.endsWith(`/native/${kind}`)) ?? `plugins/native/${kind}`;
  const add = (p: NativePlugin) => clip && setChain(clip, [...chain, { id: p.id, params: {}, enabled: true }]);

  return (
    <div className="inspector-section nfx-section" data-native-fx>
      <h3 className="section-title">
        <Puzzle size={13} /> {t("nfx.title")}
        <button className="link-btn" onClick={() => void load(true)} disabled={loading} title={t("nfx.rescan")}>
          <RefreshCw size={12} className={loading ? "spin" : undefined} /> {t("nfx.rescan")}
        </button>
      </h3>
      <p className="sp-note">{t("nfx.sub")}</p>
      {catalog && !catalog.available && <p className="sp-note warn">{t("nfx.unavailable", { error: catalog.error ?? "?" })}</p>}
      {blocked.length > 0 && (
        <p className="sp-note warn nfx-blocked">
          {t("nfx.blockedHint", { names: blocked.map((b) => b.replace(/^\w+:/, "")).join(", ") })}
          <button className="link-btn" onClick={() => void unblock()} disabled={loading}>
            <ShieldOff size={12} /> {t("nfx.unblock", { n: blocked.length })}
          </button>
        </p>
      )}

      {clip && chain.length > 0 && (
        <div className="nfx-applied">
          <h4 className="nfx-sub">{t("nfx.applied")}</h4>
          {chain.map((fx, i) => (
            <AppliedFx key={`${fx.id}-${i}`} clip={clip} index={i} fx={fx} plugin={byId.get(fx.id)} />
          ))}
          <p className="sp-note">{t("nfx.preview")}</p>
        </div>
      )}

      {catalog?.available && catalog.plugins.length === 0 && <p className="sp-note">{t("nfx.none", { ofx: userDir("ofx"), frei0r: userDir("frei0r") })}</p>}
      {catalog?.available && catalog.plugins.length > 0 && (
        <>
          {!clip && <p className="sp-note">{t("nfx.pickClip")}</p>}
          <div className="nfx-search">
            <input type="search" value={query} placeholder={t("nfx.search")} onChange={(e) => setQuery(e.target.value)} aria-label={t("nfx.search")} />
            <small className="muted">{t("nfx.count", { n: catalog.plugins.length })}</small>
          </div>
          <div className="nfx-groups">
            {groups.map(([g, list]) => {
              const open = !!query.trim() || openGroup === g;
              return (
                <div key={g} className="nfx-group">
                  <button className="nfx-group-head" onClick={() => setOpenGroup(open && !query.trim() ? null : g)} aria-expanded={open}>
                    {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {g} <small className="muted">{list.length}</small>
                  </button>
                  {open && (
                    <div className="nfx-list">
                      {list.map((p) => (
                        <button key={p.id} className="nfx-item" disabled={!clip} onClick={() => add(p)} title={p.description || p.id} data-nfx={p.id}>
                          <span className="nfx-kind">{p.kind === "ofx" ? "OFX" : "f0r"}</span>
                          <span className="nfx-name">{pluginName(p)}</span>
                          <Plus size={13} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <details className="nfx-dirs">
            <summary>{t("nfx.folders")}</summary>
            {catalog.dirs.map((d) => (
              <code key={d}>{d}</code>
            ))}
          </details>
        </>
      )}
    </div>
  );
}

function AppliedFx({ clip, index, fx, plugin }: { clip: Clip; index: number; fx: NativeFx; plugin: NativePlugin | undefined }) {
  const t = useT();
  const [open, setOpen] = useState(index === (clip.nativeFx?.length ?? 1) - 1);
  const [params, setParams] = useState<NativeParam[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open || !plugin) return;
    let live = true;
    describeNative(fx.id)
      .then((p) => live && setParams(p))
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [open, plugin, fx.id]);

  const chain = clip.nativeFx ?? [];
  const patch = (next: Partial<NativeFx>) => setChain(clip, chain.map((f, i) => (i === index ? { ...f, ...next } : f)));
  const { beginGesture, endGesture, transient } = useProject.getState();
  const live = (name: string, value: number[] | string) =>
    transient((p) => updateClip(p, clip.id, { nativeFx: (p.clips.find((c) => c.id === clip.id)?.nativeFx ?? []).map((f, i) => (i === index ? { ...f, params: { ...f.params, [name]: value } } : f)) }));
  const set = (name: string, value: number[] | string) => patch({ params: { ...fx.params, [name]: value } });

  let lastGroup = "";
  return (
    <div className={`nfx-card${fx.enabled === false ? " off" : ""}`} data-nfx-applied={fx.id}>
      <div className="nfx-card-head">
        <button className="nfx-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span className="nfx-kind">{fx.id.startsWith("ofx:") ? "OFX" : "f0r"}</span>
          <b>{plugin ? pluginName(plugin) : fx.id.replace(/^\w+:/, "")}</b>
        </button>
        <Switch on={fx.enabled !== false} onChange={(v) => patch({ enabled: v })} label={t("nfx.enabled")} />
        <button className="icon-btn" onClick={() => patch({ params: {} })} title={t("nfx.reset")} aria-label={t("nfx.reset")}>
          <RotateCcw size={13} />
        </button>
        <button className="icon-btn" onClick={() => setChain(clip, chain.filter((_, i) => i !== index))} title={t("nfx.remove")} aria-label={t("nfx.remove")}>
          <Trash2 size={13} />
        </button>
      </div>
      {!plugin && <p className="sp-note warn">{t("nfx.missing")}</p>}
      {open && plugin && (
        <div className="nfx-params">
          {error ? (
            <p className="sp-note warn">{t("nfx.paramsFailed", { error })}</p>
          ) : !params ? (
            <p className="sp-note">{t("nfx.loadingParams")}</p>
          ) : params.length === 0 ? (
            <p className="sp-note">{t("nfx.noParams")}</p>
          ) : (
            params.map((p) => {
              const head = p.group && p.group !== lastGroup ? <h5 className="nfx-pgroup">{p.group}</h5> : null;
              lastGroup = p.group;
              const value = fx.params[p.name] ?? p.def;
              return (
                <div key={p.name} title={p.hint || undefined}>
                  {head}
                  <ParamControl param={p} value={value} onCommit={(v) => set(p.name, v)} onLive={(v) => live(p.name, v)} onStart={beginGesture} onEnd={endGesture} />
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

const hex = (c: number[]) => "#" + c.slice(0, 3).map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);

function ParamControl({
  param: p,
  value,
  onCommit,
  onLive,
  onStart,
  onEnd,
}: {
  param: NativeParam;
  value: number[] | string;
  onCommit: (v: number[] | string) => void;
  onLive: (v: number[] | string) => void;
  onStart: () => void;
  onEnd: () => void;
}) {
  const nums = Array.isArray(value) ? value : (p.def as number[]);
  switch (p.kind) {
    case "bool":
      return (
        <div className="nfx-row">
          <span>{p.label}</span>
          <Switch on={(nums[0] ?? 0) > 0.5} onChange={(v) => onCommit([v ? 1 : 0])} label={p.label} />
        </div>
      );
    case "choice":
      return (
        <label className="nfx-row">
          <span>{p.label}</span>
          <select value={Math.round(nums[0] ?? 0)} onChange={(e) => onCommit([Number(e.target.value)])}>
            {p.choices.map((c, i) => (
              <option key={i} value={i}>
                {c}
              </option>
            ))}
          </select>
        </label>
      );
    case "color":
      return (
        <label className="nfx-row">
          <span>{p.label}</span>
          <input type="color" value={hex(nums)} onChange={(e) => onCommit([...unhex(e.target.value), ...nums.slice(3)])} />
        </label>
      );
    case "string":
      return (
        <label className="nfx-row">
          <span>{p.label}</span>
          <input type="text" defaultValue={typeof value === "string" ? value : ""} onBlur={(e) => onCommit(e.target.value)} />
        </label>
      );
    case "number": {
      const axes = ["X", "Y", "Z"];
      const step = p.int ? 1 : (p.max - p.min) / 200 || 0.01;
      const fmt = (v: number) => (p.int ? String(Math.round(v)) : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));
      return (
        <>
          {Array.from({ length: p.dims }, (_, d) => (
            <Slider
              key={d}
              label={p.dims > 1 ? `${p.label} ${axes[d]}` : p.label}
              value={Math.min(p.max, Math.max(p.min, nums[d] ?? 0))}
              min={p.min}
              max={p.max}
              step={step}
              format={fmt}
              onStart={onStart}
              onEnd={onEnd}
              onChange={(v) => {
                const next = Array.from({ length: p.dims }, (_, k) => (k === d ? (p.int ? Math.round(v) : v) : (nums[k] ?? 0)));
                onLive(next);
              }}
            />
          ))}
        </>
      );
    }
  }
}
