// Stickers & animated titles: Lottie (Bodymovin JSON) entries of the installed packs as live
// cards (category tabs, search); a click puts one on a text track at the playhead. Above the
// browser, the selected Lottie clip's placement, timing and replaceable texts.
import { FileJson, Puzzle, RotateCcw, Search, Sticker, Trash2, X } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Slider, Switch } from "../../components/controls";
import { engine } from "../../engine/playback";
import { useT, type Key } from "../../i18n";
import { isAndroid, pickFiles } from "../../lib/backend";
import { messageOf } from "../../lib/format";
import { enabledPacks, packFile, usePlugins, type CatalogEntry, type Installed, type PackLottie } from "../../lib/plugins";
import { drawLottie, loadLottieData, lottieClipData, lottieInfo, onLottieReady } from "../../lottie/render";
import { addLottieClip, updateClip, updateLottie } from "../../project/ops";
import type { Clip, ClipLottie } from "../../project/types";
import { usePlayback } from "../../store/playback";
import { useProject } from "../../store/project";
import { useRouter } from "../../store/router";
import { toast } from "../../store/toast";
import { deleteSelection } from "./commands";

/** A browser card: one Lottie entry of an installed, enabled pack. */
export interface StickerDef {
  key: string;
  pack: Installed;
  entry: PackLottie;
  path: string;
}

const KNOWN_CATS = new Set(["sparkle", "love", "celebrate", "badge", "social", "shape", "emoji", "highlight", "titles", "imported"]);
const CARD_W = 160;
const CARD_H = 90;
/** Clip length bounds (seconds) for a new clip; loops get at least 3 s. */
const MIN_LEN = 1.5;
const MAX_LEN = 10;

/** Every Lottie entry of the enabled packs (plain function for non-React callers). */
export function stickerDefs(installed: Installed[]): StickerDef[] {
  return enabledPacks(installed).flatMap((pack) =>
    (pack.manifest.lottie ?? []).map((entry) => ({ key: `${pack.manifest.id}/${entry.id}`, pack, entry, path: packFile(pack, entry.file) })),
  );
}

export function useStickerDefs(): StickerDef[] {
  const installed = usePlugins((s) => s.installed);
  return useMemo(() => stickerDefs(installed), [installed]);
}

export function catLabel(t: ReturnType<typeof useT>, c: string): string {
  if (KNOWN_CATS.has(c)) return t(`lottie.cat.${c}` as Key);
  return c.charAt(0).toUpperCase() + c.slice(1);
}

/** Clip data for a card (parses the JSON once). */
async function clipFor(def: StickerDef): Promise<ClipLottie | null> {
  const info = lottieInfo(await loadLottieData(def.path));
  const project = useProject.getState().project;
  if (!info || !project) return null;
  const kind = def.entry.kind === "text" ? "text" : "overlay";
  return lottieClipData(def.path, def.entry.name, kind, info, def.pack.manifest.id, project.settings.width, project.settings.height);
}

/** Natural clip length: one play of the animation (loops get a little longer). */
export function naturalLength(l: ClipLottie): number {
  const once = (l.op - l.ip) / l.fr / (l.rate || 1);
  return Math.min(MAX_LEN, Math.max(l.loop ? 3 : MIN_LEN, once));
}

export async function addSticker(def: StickerDef): Promise<string | null> {
  const lottie = await clipFor(def);
  if (!lottie) return null;
  const at = engine.now();
  let id: string | null = null;
  useProject.getState().commit((p) => {
    const r = addLottieClip(p, lottie, at, naturalLength(lottie));
    id = r.clipId;
    return r.project;
  });
  if (id) useProject.getState().select([id]);
  return id;
}

/** A fake clip for drawing a card (no fades, full opacity). */
function cardClip(l: ClipLottie): Clip {
  return { id: "card", trackId: "", mediaId: "", start: 0, in: 0, out: 3600, speed: 1, volume: 1, opacity: 1, fadeIn: 0, fadeOut: 0, lottie: { ...l, x: 0.5, y: 0.5, scale: 0.92, rotation: 0, loop: true } };
}

const StickerCard = memo(function StickerCard({ def, onPick }: { def: StickerDef; onPick: (d: StickerDef) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const state = useRef<{ clip: Clip | null; raf: number; shown: boolean; hover: boolean; still: number }>({ clip: null, raf: 0, shown: false, hover: false, still: 0 });
  const [failed, setFailed] = useState(false);

  const draw = (lt: number) => {
    const el = canvas.current;
    const clip = state.current.clip;
    if (!el || !clip) return false;
    const ctx = el.getContext("2d")!;
    ctx.clearRect(0, 0, el.width, el.height);
    return drawLottie(ctx, clip, el.width, el.height, lt);
  };

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const s = state.current;
    let offReady: (() => void) | undefined;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting) || s.shown) return;
      s.shown = true;
      io.disconnect();
      void clipFor(def).then((l) => {
        if (!l) return setFailed(true);
        s.clip = cardClip(l);
        // The still: most of the way in (titles have their text up, stickers are mid-motion).
        s.still = Math.min(((l.op - l.ip) / l.fr) * 0.6, 2.5);
        if (!draw(s.still)) offReady = onLottieReady(() => !s.hover && draw(s.still) && offReady?.());
      });
    });
    io.observe(el);
    return () => {
      io.disconnect();
      offReady?.();
      cancelAnimationFrame(s.raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.key]);

  const start = () => {
    const s = state.current;
    s.hover = true;
    const t0 = performance.now();
    const loop = (now: number) => {
      draw((now - t0) / 1000);
      s.raf = requestAnimationFrame(loop);
    };
    cancelAnimationFrame(s.raf);
    s.raf = requestAnimationFrame(loop);
  };
  const stop = () => {
    const s = state.current;
    s.hover = false;
    cancelAnimationFrame(s.raf);
    s.raf = 0;
    draw(s.still);
  };
  return (
    <button
      role="listitem"
      className="fx-card lt-card"
      data-lottie={def.key}
      onClick={() => onPick(def)}
      onPointerEnter={start}
      onPointerLeave={stop}
      onFocus={start}
      onBlur={stop}
      title={`${def.entry.name} · ${def.pack.manifest.name}${def.pack.manifest.license ? ` · ${def.pack.manifest.license}` : ""}`}
    >
      <span className="fx-thumb lt-thumb">
        <canvas ref={canvas} width={CARD_W * 2} height={CARD_H * 2} />
        {failed && <Sticker size={20} />}
        {def.entry.kind === "text" && <em className="fx-badge">T</em>}
      </span>
      <span className="fx-name">{def.entry.name}</span>
    </button>
  );
});

/** Catalog packs with Lottie entries that aren't installed yet (one-click install). */
function CatalogOffer() {
  const t = useT();
  const installed = usePlugins((s) => s.installed);
  const catalog = usePlugins((s) => s.catalog);
  const busy = usePlugins((s) => s.busy);
  useEffect(() => void usePlugins.getState().loadCatalog(), []);
  const offers = (catalog ?? []).filter((e: CatalogEntry) => (e.contents.lottie ?? 0) > 0 && !installed.some((p) => p.manifest.id === e.id));
  if (!offers.length) return null;
  const install = async (e: CatalogEntry) => {
    try {
      await usePlugins.getState().installFromCatalog(e);
      toast(t("plugins.installed", { name: e.name }), "success");
    } catch (err) {
      toast(messageOf(err), "error");
    }
  };
  return (
    <div className="lt-offers">
      {offers.map((e) => (
        <div key={e.id} className="lt-offer" data-offer={e.id}>
          <div>
            <strong>{e.name}</strong>
            <span>
              {t("lottie.count", { n: e.contents.lottie ?? 0 })} · {e.license}
            </span>
          </div>
          <button className="btn btn-sm primary" disabled={!!busy} onClick={() => void install(e)}>
            {busy === e.id ? t("lottie.installing") : t("lottie.install")}
          </button>
        </div>
      ))}
    </div>
  );
}

function StickerBrowser({ compact }: { compact: boolean }) {
  const t = useT();
  const go = useRouter((r) => r.go);
  const defs = useStickerDefs();
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const cats = useMemo(() => [...new Set(defs.map((d) => d.entry.category || "imported"))], [defs]);
  const q = query.trim().toLocaleLowerCase();
  const list = useMemo(() => {
    if (q) return defs.filter((d) => d.entry.name.toLocaleLowerCase().includes(q) || d.entry.id.includes(q) || d.entry.category.includes(q));
    return tab === "all" ? defs : defs.filter((d) => (d.entry.category || "imported") === tab);
  }, [defs, tab, q]);
  const pick = (d: StickerDef) => {
    void addSticker(d).then((id) => !id && toast(t("lottie.loadFailed"), "error"));
  };
  const importJson = async () => {
    const paths = await pickFiles(isAndroid ? [] : [{ name: "Lottie (Bodymovin JSON)", extensions: ["json"] }], true);
    for (const path of paths) {
      try {
        const pack = await usePlugins.getState().install(path);
        toast(t("plugins.installed", { name: pack.manifest.name }), "success");
        const entry = pack.manifest.lottie?.[0];
        if (entry) await addSticker({ key: `${pack.manifest.id}/${entry.id}`, pack, entry, path: packFile(pack, entry.file) });
      } catch (e) {
        toast(messageOf(e), "error");
      }
    }
  };
  return (
    <div className={`fx-browser lt-browser${compact ? " compact" : ""}`}>
      <div className="lt-toolbar">
        <label className="tr-search">
          <Search size={13} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("lottie.search")} aria-label={t("lottie.search")} onKeyDown={(e) => e.stopPropagation()} />
          {query && (
            <button className="icon-btn" onClick={() => setQuery("")} aria-label={t("rail.close")}>
              <X size={12} />
            </button>
          )}
        </label>
        <button className="btn btn-sm" onClick={() => void importJson()} title={t("lottie.importHint")} data-lottie-import="">
          <FileJson size={13} /> {t("lottie.import")}
        </button>
      </div>
      {!q && cats.length > 1 && (
        <div className="fx-tabs" role="tablist">
          {["all", ...cats].map((c) => (
            <button key={c} role="tab" aria-selected={c === tab} className={`fx-tab${c === tab ? " active" : ""}`} onClick={() => setTab(c)}>
              {c === "all" ? t("trans.cat.all") : catLabel(t, c)}
            </button>
          ))}
        </div>
      )}
      {defs.length === 0 && <p className="fx-hint">{t("lottie.empty")}</p>}
      <CatalogOffer />
      <div className="fx-grid" role="list">
        {list.map((d) => (
          <StickerCard key={d.key} def={d} onPick={pick} />
        ))}
        <button role="listitem" className="fx-card get-more" onClick={() => go("plugins")}>
          <span className="fx-thumb">
            <Puzzle size={20} />
          </span>
          <span className="fx-name">{t("plugins.getMore")}</span>
        </button>
      </div>
    </div>
  );
}

const PLACES = [0.2, 0.5, 0.8];

/** The selected Lottie clip: placement, playback and its replaceable texts. */
function LottieInspector({ clip }: { clip: Clip }) {
  const t = useT();
  const l = clip.lottie!;
  const { beginGesture, endGesture, transient, commit } = useProject.getState();
  const set = (patch: Partial<ClipLottie>, live = false) => (live ? transient : commit)((p) => updateLottie(p, clip.id, patch));
  const g = { onStart: beginGesture, onEnd: endGesture };
  const fitLength = () =>
    commit((p) => updateClip(p, clip.id, { out: clip.in + naturalLength(l) * (clip.speed || 1) }));
  return (
    <div className="inspector-section lt-inspector" data-lottie-inspector={clip.id}>
      <h3 className="section-title">
        <Sticker size={13} /> {clip.name ?? l.name}
      </h3>
      {(l.texts ?? []).map((txt, i) => (
        <label key={i} className="field lt-text">
          <span>{t("lottie.text", { n: i + 1 })}</span>
          <textarea
            className="input"
            rows={txt.includes("\n") ? 2 : 1}
            value={txt}
            onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              const texts = [...(l.texts ?? [])];
              texts[i] = e.target.value;
              set({ texts });
            }}
          />
        </label>
      ))}
      <div className="lt-place" role="group" aria-label={t("lottie.place")}>
        {PLACES.map((y) =>
          PLACES.map((x) => (
            <button key={`${x}-${y}`} className={`lt-dot${Math.abs(l.x - x) < 0.01 && Math.abs(l.y - y) < 0.01 ? " active" : ""}`} onClick={() => set({ x, y })} aria-label={`${x},${y}`} />
          )),
        )}
      </div>
      <Slider label={t("lottie.scale")} value={l.scale} min={0.05} max={2} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ scale: v }, true)} {...g} />
      <Slider label={t("lottie.x")} value={l.x} min={0} max={1} step={0.005} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ x: v }, true)} {...g} />
      <Slider label={t("lottie.y")} value={l.y} min={0} max={1} step={0.005} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ y: v }, true)} {...g} />
      <Slider label={t("lottie.rotation")} value={l.rotation} min={-180} max={180} step={1} format={(v) => `${Math.round(v)}°`} onChange={(v) => set({ rotation: v }, true)} {...g} />
      <Slider
        label={t("lottie.opacity")}
        value={clip.opacity}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => transient((p) => updateClip(p, clip.id, { opacity: v }))}
        {...g}
      />
      <Slider label={t("lottie.rate")} value={l.rate || 1} min={0.25} max={3} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => set({ rate: v }, true)} {...g} />
      <div className="lt-row">
        <span>{t("lottie.loop")}</span>
        <Switch label={t("lottie.loop")} on={l.loop} onChange={(v) => set({ loop: v })} />
      </div>
      <div className="tr-actions">
        <button className="btn btn-sm" onClick={fitLength}>
          <RotateCcw size={13} /> {t("lottie.fit")}
        </button>
        <button className="btn btn-sm danger" onClick={() => deleteSelection()}>
          <Trash2 size={13} /> {t("lottie.remove")}
        </button>
      </div>
    </div>
  );
}

export function StickersPanel({ compact = false }: { compact?: boolean }) {
  const clip = useProject((s) => {
    if (!s.project || s.selection.length !== 1) return null;
    const c = s.project.clips.find((x) => x.id === s.selection[0]);
    return c?.lottie ? c : null;
  });
  useEffect(() => void usePlugins.getState().refresh(), []);
  // Show a freshly picked clip at a moment where it's visible.
  useEffect(() => {
    if (!clip || usePlayback.getState().playing) return;
    const now = usePlayback.getState().time;
    if (now < clip.start || now >= clip.start + (clip.out - clip.in) / (clip.speed || 1)) engine.seek(clip.start + 0.05);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip?.id]);
  return (
    <div className="inspector lt-panel">
      <div className="inspector-body">
        {clip && <LottieInspector clip={clip} />}
        <StickerBrowser compact={compact} />
      </div>
    </div>
  );
}
