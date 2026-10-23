import { create } from "zustand";

export type Page = "home" | "editor" | "music" | "settings";

interface RouterState {
  page: Page;
  previous: Page;
  /** Video handed from the editor to Music Swap (skips its "choose video" step). */
  musicSource: string | null;
  openMusicSwap: (videoPath: string | null) => void;
  go: (page: Page) => void;
  back: () => void;
}

export const useRouter = create<RouterState>((set, get) => ({
  page: "home",
  previous: "home",
  musicSource: null,
  openMusicSwap: (videoPath) => set({ musicSource: videoPath, page: "music", previous: get().page }),
  go: (page) => set({ page, previous: get().page }),
  back: () => set({ page: get().previous === get().page ? "home" : get().previous, previous: "home" }),
}));
