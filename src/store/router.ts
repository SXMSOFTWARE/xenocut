import { create } from "zustand";

export type Page = "home" | "editor" | "music" | "settings";

interface RouterState {
  page: Page;
  previous: Page;
  go: (page: Page) => void;
  back: () => void;
}

export const useRouter = create<RouterState>((set, get) => ({
  page: "home",
  previous: "home",
  go: (page) => set({ page, previous: get().page }),
  back: () => set({ page: get().previous === get().page ? "home" : get().previous, previous: "home" }),
}));
