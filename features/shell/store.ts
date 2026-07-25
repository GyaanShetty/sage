"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ShellState {
  sidebarExpanded: boolean;
  paletteOpen: boolean;
  wakeWord: boolean;
  ambientArmed: boolean;
  gestureNav: boolean;
  toggleSidebar: () => void;
  setPaletteOpen: (open: boolean) => void;
  setWakeWord: (on: boolean) => void;
  setAmbientArmed: (on: boolean) => void;
  setGestureNav: (on: boolean) => void;
}

export const useShellStore = create<ShellState>()(
  persist(
    (set) => ({
      sidebarExpanded: false,
      paletteOpen: false,
      wakeWord: false,
      ambientArmed: true,
      gestureNav: false,
      toggleSidebar: () => set((s) => ({ sidebarExpanded: !s.sidebarExpanded })),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      setWakeWord: (wakeWord) => set({ wakeWord }),
      setAmbientArmed: (ambientArmed) => set({ ambientArmed }),
      setGestureNav: (gestureNav) => set({ gestureNav }),
    }),
    {
      name: "sage-shell",
      partialize: (s) => ({
        sidebarExpanded: s.sidebarExpanded,
        wakeWord: s.wakeWord,
        ambientArmed: s.ambientArmed,
        gestureNav: s.gestureNav,
      }),
    },
  ),
);
