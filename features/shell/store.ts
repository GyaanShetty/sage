"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ShellState {
  sidebarExpanded: boolean;
  paletteOpen: boolean;
  wakeWord: boolean;
  ambientArmed: boolean;
  toggleSidebar: () => void;
  setPaletteOpen: (open: boolean) => void;
  setWakeWord: (on: boolean) => void;
  setAmbientArmed: (on: boolean) => void;
}

export const useShellStore = create<ShellState>()(
  persist(
    (set) => ({
      sidebarExpanded: false,
      paletteOpen: false,
      wakeWord: false,
      ambientArmed: true,
      toggleSidebar: () => set((s) => ({ sidebarExpanded: !s.sidebarExpanded })),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      setWakeWord: (wakeWord) => set({ wakeWord }),
      setAmbientArmed: (ambientArmed) => set({ ambientArmed }),
    }),
    {
      name: "sage-shell",
      partialize: (s) => ({
        sidebarExpanded: s.sidebarExpanded,
        wakeWord: s.wakeWord,
        ambientArmed: s.ambientArmed,
      }),
    },
  ),
);
