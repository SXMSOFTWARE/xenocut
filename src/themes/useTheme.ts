import { useEffect, useMemo } from "react";
import { usePlugins } from "../lib/plugins";
import { isMobileUi } from "../lib/platform";
import { useSettings } from "../store/settings";
import { applyTheme, BUILTIN_THEMES, cleanTheme, resolveTheme, type ThemeDef } from ".";

/** Built-in, user-saved and pack themes, in that order. */
export function useAllThemes(): ThemeDef[] {
  const user = useSettings((s) => s.userThemes);
  const installed = usePlugins((s) => s.installed);
  return useMemo(() => {
    const out = [...BUILTIN_THEMES, ...user];
    for (const pack of installed) {
      if (!pack.enabled) continue;
      for (const t of pack.manifest.themes ?? []) {
        const clean = cleanTheme(t, pack.manifest.id);
        if (clean && !out.some((o) => o.id === clean.id)) out.push(clean);
      }
    }
    return out;
  }, [user, installed]);
}

/** The chosen theme with the user's tweaks. */
export function useCurrentTheme(): ThemeDef {
  const all = useAllThemes();
  const id = useSettings((s) => s.theme);
  const tweaks = useSettings((s) => s.themeTweaks);
  return useMemo(() => resolveTheme(all.find((t) => t.id === id) ?? BUILTIN_THEMES[0], tweaks), [all, id, tweaks]);
}

/** Keeps <html> in sync with the current theme (mounted once in App). */
export function useApplyTheme() {
  const theme = useCurrentTheme();
  useEffect(() => applyTheme(theme, isMobileUi), [theme]);
}
