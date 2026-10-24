import { useState } from "react";
import { AudioLines, Captions, Clapperboard, FolderOpen, Plus, Puzzle, Scissors, Settings, Sparkles, X, Film } from "lucide-react";
import { Logo } from "../../components/Logo";
import { useT, type Key } from "../../i18n";
import { useRecent, type RecentEntry } from "../../store/recent";
import { useRouter } from "../../store/router";
import { useSettings } from "../../store/settings";
import { fileSrc } from "../../lib/backend";
import { shortTime } from "../../lib/format";
import { openProjectDialog, openProjectPath } from "../../project/actions";
import { NewProjectDialog } from "./NewProjectDialog";
import { isMobileUi } from "../../lib/platform";

const SOON_TOOLS: { icon: typeof Captions; title: Key; text: Key }[] = [
  { icon: Scissors, title: "tools.silence", text: "tools.silenceText" },
  { icon: Film, title: "tools.reframe", text: "tools.reframeText" },
];

export function HomePage() {
  const t = useT();
  const [creating, setCreating] = useState<false | "plain" | "captions">(false);
  const go = useRouter((s) => s.go);
  const entries = useRecent((s) => s.entries);

  return (
    <div className="home">
      <header className="home-top">
        <Logo size={30} />
        <div className="spacer" />
        <button className="icon-btn" onClick={() => go("settings")} aria-label={t("settings.title")} title={t("settings.title")}>
          <Settings />
        </button>
      </header>

      <main className="home-main">
        <div className="home-col">
          <section className="home-hero">
            <h1>{t("home.welcome")}</h1>
            <p>{t(isMobileUi ? "home.taglineMobile" : "home.tagline")}</p>
          </section>

          <section className="home-actions">
            <button className="action-card primary" onClick={() => setCreating("plain")}>
              <span className="action-icon">
                <Plus />
              </span>
              <span className="action-text">
                <b>{t("home.newProject")}</b>
                <small>{t("home.newProjectText")}</small>
              </span>
            </button>
            <button className="action-card" onClick={() => void openProjectDialog()}>
              <span className="action-icon">
                <FolderOpen />
              </span>
              <span className="action-text">
                <b>{t("home.openProject")}</b>
                <small>{t("home.openProjectText")}</small>
              </span>
            </button>
          </section>

          <section className="home-section">
            <div className="home-section-head">
              <h3 className="section-title">{t("home.recent")}</h3>
              <span className="muted">{entries.length ? entries.length : ""}</span>
            </div>
            {entries.length === 0 ? (
              <div className="recent-empty empty">
                <Clapperboard />
                <span>{t("home.noRecent")}</span>
              </div>
            ) : (
              <div className="recent-grid">
                {entries.map((entry) => (
                  <RecentCard key={entry.path} entry={entry} />
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="home-side">
          <h3 className="section-title">{t("home.quickTools")}</h3>
          <button className="tool-card live" onClick={() => go("music")}>
            <span className="tool-icon">
              <AudioLines />
            </span>
            <span className="tool-text">
              <b>
                {t("tools.musicSwap")}
              </b>
              <small>{t("tools.musicSwapText")}</small>
            </span>
            <Sparkles className="tool-spark" />
          </button>
          <button className="tool-card live" onClick={() => setCreating("captions")}>
            <span className="tool-icon">
              <Captions />
            </span>
            <span className="tool-text">
              <b>{t("tools.captions")}</b>
              <small>{t("tools.captionsText")}</small>
            </span>
          </button>
          <button className="tool-card live" onClick={() => go("plugins")}>
            <span className="tool-icon">
              <Puzzle />
            </span>
            <span className="tool-text">
              <b>{t("home.plugins")}</b>
              <small>{t("home.pluginsText")}</small>
            </span>
          </button>
          {SOON_TOOLS.map(({ icon: Icon, title, text }) => (
            <div className="tool-card" key={title} aria-disabled="true">
              <span className="tool-icon">
                <Icon />
              </span>
              <span className="tool-text">
                <b>
                  {t(title)} <span className="soon">{t("common.soon")}</span>
                </b>
                <small>{t(text)}</small>
              </span>
            </div>
          ))}
        </aside>
      </main>

      {creating && <NewProjectDialog panel={creating === "captions" ? "captions" : undefined} onClose={() => setCreating(false)} />}
    </div>
  );
}

function RecentCard({ entry }: { entry: RecentEntry }) {
  const t = useT();
  const remove = useRecent((s) => s.remove);
  const language = useSettings((s) => s.language);
  const date = new Date(entry.modified);
  const when = Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(date);
  const ratio = entry.aspect.replace(":", " / ");

  return (
    <div className={`recent-card${entry.missing ? " missing" : ""}`}>
      <button
        className="recent-open"
        disabled={entry.missing}
        onClick={() => void openProjectPath(entry.path)}
        title={entry.missing ? t("home.missing") : entry.path}
      >
        <span className="recent-thumb">
          {entry.thumb ? (
            <img src={fileSrc(entry.thumb)} alt="" loading="lazy" style={{ aspectRatio: ratio }} />
          ) : (
            <span className="recent-ph" style={{ aspectRatio: ratio }}>
              <Clapperboard />
            </span>
          )}
          <span className="recent-badge">{entry.aspect}</span>
          {entry.duration > 0 && <span className="recent-badge right tnum">{shortTime(entry.duration)}</span>}
        </span>
        <span className="recent-meta">
          <b>{entry.name}</b>
          <small>{entry.missing ? t("home.missing") : when}</small>
        </span>
      </button>
      <button className="icon-btn xs recent-remove" onClick={() => remove(entry.path)} aria-label={t("home.removeRecent")} title={t("home.removeRecent")}>
        <X />
      </button>
    </div>
  );
}
