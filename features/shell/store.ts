"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ShellState {
  sidebarExpanded: boolean;
  paletteOpen: boolean;
  toggleSidebar: () => void;
  setPaletteOpen: (open: boolean) => void;
}

export const useShellStore = create<ShellState>()(
  persist(
    (set) => ({
      sidebarExpanded: false,
      paletteOpen: false,
      toggleSidebar: () => set((s) => ({ sidebarExpanded: !s.sidebarExpanded })),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
    }),
    {
      name: "sage-shell",
      partialize: (s) => ({ sidebarExpanded: s.sidebarExpanded }),
    },
  ),
);
