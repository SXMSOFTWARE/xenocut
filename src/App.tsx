import { lazy, Suspense, useEffect } from "react";
import { useRouter } from "./store/router";
import { useSettings } from "./store/settings";
import { useRecent } from "./store/recent";
import { Toasts } from "./components/Toasts";
import { ContextMenuHost } from "./components/ContextMenu";
import { HomePage } from "./pages/home/HomePage";
import { messageOf } from "./lib/format";
import { usePlugins } from "./lib/plugins";

const EditorPage = lazy(() => import("./pages/editor/EditorPage"));
const MusicSwapPage = lazy(() => import("./pages/music/MusicSwapPage"));
const SettingsPage = lazy(() => import("./pages/settings/SettingsPage"));
const PluginsPage = lazy(() => import("./pages/plugins/PluginsPage"));

export function App() {
  const page = useRouter((s) => s.page);
  const ready = useSettings((s) => s.ready);
  const loadSettings = useSettings((s) => s.load);
  const loadRecent = useRecent((s) => s.load);

  useEffect(() => {
    loadSettings()
      .then(loadRecent)
      .then(() => usePlugins.getState().refresh())
      .catch((error) => {
        console.error(messageOf(error));
        useSettings.setState({ ready: true });
      });
    // Block the webview's own context menu and file-open-on-drop.
    const block = (e: Event) => e.preventDefault();
    window.addEventListener("contextmenu", block);
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("contextmenu", block);
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, [loadSettings, loadRecent]);

  if (!ready) return <div className="boot" />;

  return (
    <>
      <Suspense fallback={<div className="boot" />}>
        {page === "home" && <HomePage />}
        {page === "editor" && <EditorPage />}
        {page === "music" && <MusicSwapPage />}
        {page === "settings" && <SettingsPage />}
        {page === "plugins" && <PluginsPage />}
      </Suspense>
      <Toasts />
      <ContextMenuHost />
    </>
  );
}
