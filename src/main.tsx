import "./lib/perfHook";
import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/inter/latin-ext-400.css";
import "@fontsource/inter/latin-ext-500.css";
import "@fontsource/inter/latin-ext-600.css";
import "@fontsource/inter/latin-ext-700.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/ui.css";
import "./styles/app.css";
import { App } from "./App";
import { initBackend, log, transport } from "./lib/backend";
import { initDeviceMetrics, isMobileUi } from "./lib/platform";

document.documentElement.classList.toggle("mobile", isMobileUi);
initDeviceMetrics();

// Dev builds expose the stores to the browser test harness.
if (import.meta.env.DEV) void import("./store/project").then(({ useProject }) => Object.assign(window, { __xcProject: () => useProject.getState().project, __xcStore: useProject }));

window.addEventListener("error", (e) => log("error", `window error: ${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener("unhandledrejection", (e) => log("error", `unhandled rejection: ${String(e.reason)}`));

void initBackend().then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
  if (transport.autotest) void import("./lib/autotest").then((m) => m.runAutotest(transport.autotest!));
  else if (transport.audiocheck) void import("./lib/audiocheck").then((m) => m.runAudioCheck(transport.audiocheck!));
});
