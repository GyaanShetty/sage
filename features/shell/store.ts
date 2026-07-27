"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { moodFromValue } from "@/lib/config";

interface ShellState {
  sidebarExpanded: boolean;
  paletteOpen: boolean;
  wakeWord: boolean;
  ambientArmed: boolean;
  gestureNav: boolean;
  mood: "formal" | "balanced" | "playful";
  moodValue: number;
  toggleSidebar: () => void;
  setPaletteOpen: (open: boolean) => void;
  setWakeWord: (on: boolean) => void;
  setAmbientArmed: (on: boolean) => void;
  setGestureNav: (on: boolean) => void;
  setMoodValue: (v: number) => void;
}

export const useShellStore = create<ShellState>()(
  persist(
    (set) => ({
      sidebarExpanded: false,
      paletteOpen: false,
      wakeWord: false,
      ambientArmed: true,
      gestureNav: false,
      mood: "playful",
      moodValue: 80,
      toggleSidebar: () => set((s) => ({ sidebarExpanded: !s.sidebarExpanded })),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      setWakeWord: (wakeWord) => set({ wakeWord }),
      setAmbientArmed: (ambientArmed) => set({ ambientArmed }),
      setGestureNav: (gestureNav) => set({ gestureNav }),
      setMoodValue: (moodValue) => set({ moodValue, mood: moodFromValue(moodValue) }),
    }),
    {
      name: "sage-shell",
      partialize: (s) => ({
        sidebarExpanded: s.sidebarExpanded,
        wakeWord: s.wakeWord,
        ambientArmed: s.ambientArmed,
        gestureNav: s.gestureNav,
        mood: s.mood,
        moodValue: s.moodValue,
      }),
    },
  ),
);
