// Plugins: the installed library (enable, remove, details) and the online catalog.
// Packs are data only (see docs/plugins.md); installing never runs code.
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, Blend, Check, ChevronDown, Download, Film, Library, Palette, Sparkles, Puzzle, RefreshCw, ShieldCheck, Store, Trash2, Type, Wand2 } from "lucide-react";
import { Switch } from "../../components/controls";
import { useT, type Key } from "../../i18n";
import { fileSrc, isAndroid, onFileDrop, openExternal, pickFiles } from "../../lib/backend";
import { bytes, messageOf } from "../../lib/format";
import { CATALOG_BASE, packFile, usePlugins, type CatalogEntry, type Installed } from "../../lib/plugins";
import { useRouter } from "../../store/router";
import { toast } from "../../store/toast";
import "../../styles/plugins.css";

type Tab = "library" | "catalog";
type Counts = CatalogEntry["contents"];

const KINDS: { key: keyof Counts; icon: typeof Palette; label: Key }[] = [
  { key: "luts", icon: Palette, label: "plugins.n.luts" },
  { key: "effects", icon: Film, label: "plugins.n.effects" },
  { key: "animations", icon: Wand2, label: "plugins.n.animations" },
  { key: "textPresets", icon: Type, label: "plugins.n.textPresets" },
  { key: "transitions", icon: Blend, label: "plugins.n.transitions" },
  { key: "lottie", icon: Sparkles, label: "plugins.n.lottie" },
];

function countsOf(p: Installed): Counts {
  const m = p.manifest;
  return { luts: m.luts?.length, effects: m.effects?.length, animations: m.animations?.length, textPresets: m.textPresets?.length, transitions: m.transitions?.length, lottie: m.lottie?.length };
}

/** Compare dotted versions numerically ("1.10.0" > "1.9.2"). */
function newer(a: string, b: string): boolean {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}

function Badges({ counts }: { counts: Counts }) {
  const t = useT();
  return (
    <div className="plugin-badges">
      {KINDS.filter((k) => (counts[k.key] ?? 0) > 0).map(({ key, icon: Icon, label }) => (
        <span className="chip plugin-count" key={key}>
          <Icon size={12} /> {t(label, { n: counts[key] ?? 0 })}
        </span>
      ))}
    </div>
  );
}

function Thumb({ src, name }: { src?: string | null; name: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <div className="plugin-thumb empty" aria-hidden>
        <Puzzle size={26} />
        <span>{name.slice(0, 1)}</span>
      </div>
    );
  }
  return <img className="plugin-thumb" src={src} alt="" draggable={false} loading="lazy" onError={() => setBroken(true)} />;
}

function LibraryCard({ pack }: { pack: Installed }) {
  const t = useT();
  const { setEnabled, remove } = usePlugins.getState();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const m = pack.manifest;
  const thumb = m.thumbnail ? fileSrc(packFile(pack, m.thumbnail)) : null;
  const sections: [Key, string[]][] = [
    ["plugins.sectionLuts", (m.luts ?? []).map((x) => x.name)],
    ["plugins.sectionEffects", (m.effects ?? []).map((x) => x.name)],
    ["plugins.sectionAnims", (m.animations ?? []).map((x) => x.name)],
    ["plugins.sectionText", (m.textPresets ?? []).map((x) => x.name)],
    ["plugins.sectionTransitions", (m.transitions ?? []).map((x) => x.name)],
    ["plugins.sectionLottie", (m.lottie ?? []).map((x) => x.name)],
  ];
  return (
    <article className={`plugin-card${pack.enabled ? "" : " off"}`} data-plugin={m.id}>
      <Thumb src={thumb} name={m.name} />
      <div className="plugin-main">
        <div className="plugin-head">
          <div className="plugin-title">
            <b>{m.name}</b>
            <small>
              v{m.version} · {t("plugins.by", { author: m.author })}
            </small>
          </div>
          <Switch on={pack.enabled} label={t("plugins.enabled")} onChange={(v) => void setEnabled(m.id, v).catch((e) => toast(messageOf(e), "error"))} />
        </div>
        <p className="plugin-desc">{m.description}</p>
        <div className="plugin-meta">
          <span className="chip license">{m.license}</span>
          <span className="plugin-size">{bytes(pack.bytes)}</span>
          {!pack.enabled && <span className="chip muted">{t("plugins.disabled")}</span>}
        </div>
        <Badges counts={countsOf(pack)} />
        <div className="plugin-actions">
          <button className="btn btn-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            <ChevronDown size={14} className={open ? "flip" : ""} /> {open ? t("plugins.hideDetails") : t("plugins.details")}
          </button>
          {m.homepage && (
            <button className="btn btn-sm" onClick={() => void openExternal(m.homepage!)}>
              <ArrowUpRight size={14} /> {t("plugins.homepage")}
            </button>
          )}
          <button className="btn btn-sm danger" onClick={() => setConfirming(true)}>
            <Trash2 size={14} /> {t("plugins.remove")}
          </button>
        </div>
        {confirming && (
          <div className="plugin-confirm" role="alert">
            <span>{t("plugins.removeConfirm", { name: m.name })}</span>
            <div>
              <button className="btn btn-sm" onClick={() => setConfirming(false)}>
                {t("common.cancel")}
              </button>
              <button
                className="btn btn-sm btn-danger"
                onClick={() =>
                  void remove(m.id)
                    .then(() => toast(t("plugins.removed", { name: m.name }), "success"))
                    .catch((e) => toast(messageOf(e), "error"))
                }
              >
                <Trash2 size={14} /> {t("plugins.remove")}
              </button>
            </div>
          </div>
        )}
        {open && (
          <div className="plugin-details">
            <code>{m.id}</code>
            {sections
              .filter(([, names]) => names.length > 0)
              .map(([label, names]) => (
                <div key={label}>
                  <h4>{t(label)}</h4>
                  <p>{names.join(" · ")}</p>
                </div>
              ))}
          </div>
        )}
      </div>
    </article>
  );
}

function CatalogCard({ entry, installed }: { entry: CatalogEntry; installed?: Installed }) {
  const t = useT();
  const busy = usePlugins((s) => s.busy === entry.id);
  const update = installed ? newer(entry.version, installed.manifest.version) : false;
  const thumb = entry.thumbnail ? (/^(https:\/\/|data:image\/)/.test(entry.thumbnail) ? entry.thumbnail : CATALOG_BASE + entry.thumbnail) : null;
  const install = () =>
    void usePlugins
      .getState()
      .installFromCatalog(entry)
      .then((p) => toast(t("plugins.installed", { name: p.manifest.name }), "success"))
      .catch((e) => toast(messageOf(e), "error"));
  return (
    <article className="plugin-card" data-catalog={entry.id}>
      <Thumb src={thumb} name={entry.name} />
      <div className="plugin-main">
        <div className="plugin-head">
          <div className="plugin-title">
            <b>{entry.name}</b>
            <small>
              v{entry.version} · {t("plugins.by", { author: entry.author })}
            </small>
          </div>
          {installed && !update ? (
            <span className="chip ok">
              <Check size={12} /> {t("plugins.installedBadge")}
            </span>
          ) : (
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={install}>
              {busy ? <RefreshCw size={14} className="spin" /> : <Download size={14} />} {update ? t("plugins.update") : t("plugins.installBtn")}
            </button>
          )}
        </div>
        <p className="plugin-desc">{entry.description}</p>
        <div className="plugin-meta">
          <span className="chip license">{entry.license}</span>
          <span className="plugin-size">{bytes(entry.bytes)}</span>
          {entry.homepage && (
            <button className="link-btn" onClick={() => void openExternal(entry.homepage!)}>
              {t("plugins.homepage")} <ArrowUpRight size={12} />
            </button>
          )}
        </div>
        <Badges counts={entry.contents} />
      </div>
    </article>
  );
}

export default function PluginsPage() {
  const t = useT();
  const back = useRouter((r) => r.back);
  const installed = usePlugins((s) => s.installed);
  const loaded = usePlugins((s) => s.loaded);
  const catalog = usePlugins((s) => s.catalog);
  const catalogError = usePlugins((s) => s.catalogError);
  const busy = usePlugins((s) => s.busy);
  const [tab, setTab] = useState<Tab>(() => (usePlugins.getState().installed.length ? "library" : "catalog"));
  const [dropping, setDropping] = useState(false);

  useEffect(() => {
    void usePlugins.getState().refresh();
  }, []);
  useEffect(() => {
    if (tab === "catalog") void usePlugins.getState().loadCatalog();
  }, [tab]);

  const installPaths = async (paths: string[]) => {
    for (const path of paths) {
      try {
        const p = await usePlugins.getState().install(path);
        toast(t("plugins.installed", { name: p.manifest.name }), "success");
        setTab("library");
      } catch (e) {
        toast(messageOf(e), "error");
      }
    }
  };

  // Desktop: drop .xcpack / .cube files (or an unpacked pack folder) anywhere on the page.
  useEffect(() => {
    let off: (() => void) | undefined;
    let dead = false;
    void onFileDrop((paths) => void installPaths(paths), setDropping).then((u) => (dead ? u() : (off = u)));
    return () => {
      dead = true;
      off?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = async () => {
    // Android's picker can't filter by unknown extensions, so offer every file there.
    const paths = await pickFiles(isAndroid ? [] : [{ name: "XenoCut pack / LUT", extensions: ["xcpack", "zip", "cube"] }], true);
    await installPaths(paths);
  };

  const byId = useMemo(() => new Map(installed.map((p) => [p.manifest.id, p])), [installed]);

  return (
    <div className={`page plugins-page${dropping ? " dropping" : ""}`}>
      <header className="page-top">
        <button className="icon-btn" onClick={back} aria-label={t("common.back")}>
          <ArrowLeft />
        </button>
        <h1>{t("plugins.title")}</h1>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={() => void pick()} disabled={!!busy}>
          <Download size={14} /> {t("plugins.install")}
        </button>
      </header>
      <div className="page-body">
        <div className="plugins-wrap">
          <div className="plugins-tabs seg" role="tablist">
            <button role="tab" aria-selected={tab === "library"} className={tab === "library" ? "active" : ""} onClick={() => setTab("library")}>
              <Library size={14} /> {t("plugins.library")} {installed.length > 0 && <em>{installed.length}</em>}
            </button>
            <button role="tab" aria-selected={tab === "catalog"} className={tab === "catalog" ? "active" : ""} onClick={() => setTab("catalog")}>
              <Store size={14} /> {t("plugins.catalog")}
            </button>
          </div>

          {tab === "library" &&
            (installed.length === 0 && loaded ? (
              <div className="plugins-empty">
                <Puzzle size={36} />
                <h2>{t("plugins.empty")}</h2>
                <p>{t("plugins.emptyText")}</p>
                <div>
                  <button className="btn btn-primary" onClick={() => setTab("catalog")}>
                    <Store size={15} /> {t("plugins.browse")}
                  </button>
                  <button className="btn" onClick={() => void pick()}>
                    <Download size={15} /> {t("plugins.install")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="plugin-list">
                {installed.map((p) => (
                  <LibraryCard key={p.manifest.id} pack={p} />
                ))}
              </div>
            ))}

          {tab === "catalog" &&
            (catalogError ? (
              <div className="plugins-empty error">
                <p>{t("plugins.catalogError", { error: catalogError })}</p>
                <button className="btn" onClick={() => void usePlugins.getState().loadCatalog(true)}>
                  <RefreshCw size={15} /> {t("plugins.retry")}
                </button>
              </div>
            ) : !catalog ? (
              <div className="plugins-empty">
                <RefreshCw size={24} className="spin" />
                <p>{t("plugins.loading")}</p>
              </div>
            ) : (
              <div className="plugin-list">
                {catalog.map((e) => (
                  <CatalogCard key={e.id} entry={e} installed={byId.get(e.id)} />
                ))}
              </div>
            ))}

          <footer className="plugins-note">
            <ShieldCheck size={16} />
            <div>
              <p>{t("plugins.safety")}</p>
              <p>{t("plugins.formats")}</p>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
