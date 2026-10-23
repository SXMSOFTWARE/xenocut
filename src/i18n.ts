import { tr } from "./i18n/tr";
import { en } from "./i18n/en";
import { useSettings } from "./store/settings";

export type Key = keyof typeof tr;
const dictionaries: Record<"tr" | "en", Record<Key, string>> = { tr, en };

export function t(key: Key, params?: Record<string, string | number>): string {
  const lang = useSettings.getState().language;
  let text = dictionaries[lang]?.[key] ?? tr[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) text = text.replaceAll(`{${k}}`, String(v));
  return text;
}

/** Subscribes the component to language changes. */
export function useT() {
  useSettings((s) => s.language);
  return t;
}
