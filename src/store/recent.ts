import { create } from "zustand";
import { api } from "../lib/backend";

export interface RecentEntry {
  path: string;
  name: string;
  modified: string;
  aspect: string;
  duration: number;
  thumb: string | null;
  missing?: boolean;
}

interface RecentState {
  entries: RecentEntry[];
  loaded: boolean;
  load: () => Promise<void>;
  touch: (entry: RecentEntry) => void;
  remove: (path: string) => void;
}

const LIMIT = 24;

function persist(entries: RecentEntry[]) {
  void api.storeWrite(
    "recent",
    entries.map(({ missing: _missing, ...rest }) => rest),
  );
}

export const useRecent = create<RecentState>((set, get) => ({
  entries: [],
  loaded: false,
  load: async () => {
    const saved = (await api.storeRead<RecentEntry[]>("recent").catch(() => null)) ?? [];
    const list = Array.isArray(saved) ? saved : [];
    const exist = list.length ? await api.pathsExist(list.flatMap((e) => [e.path, e.thumb ?? ""])) : [];
    set({
      loaded: true,
      entries: list.map((e, i) => ({ ...e, missing: !exist[i * 2], thumb: exist[i * 2 + 1] ? e.thumb : null })),
    });
  },
  touch: (entry) => {
    const entries = [entry, ...get().entries.filter((e) => e.path !== entry.path)].slice(0, LIMIT);
    set({ entries });
    persist(entries);
  },
  remove: (path) => {
    const entries = get().entries.filter((e) => e.path !== path);
    set({ entries });
    persist(entries);
  },
}));
