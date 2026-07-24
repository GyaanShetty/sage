"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { SageAction } from "@/lib/hud";
import { hudHighlight, hudToast, targetForTool } from "@/lib/hud";

/**
 * Grounding layer: listens for SAGE's highlight + action events and makes the
 * interface react — flashing the relevant panel, scrolling it into view,
 * toasting what happened, and refreshing server data so voice-driven changes
 * appear instantly. This is what makes SAGE feel like it's operating the
 * console with you, JARVIS-style.
 */
export function HudLayer() {
  const router = useRouter();

  useEffect(() => {
    const onHighlight = (e: Event) => {
      const target = String((e as CustomEvent).detail || "");
      if (!target) return;
      const el =
        document.querySelector<HTMLElement>(`[data-hud="${target}"]`) ??
        document.getElementById(target);
      if (!el) return;
      el.classList.remove("hud-flash");
      // force reflow so the animation restarts even if already applied
      void el.offsetWidth;
      el.classList.add("hud-flash");
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => el.classList.remove("hud-flash"), 2600);
    };

    const onAction = (e: Event) => {
      const a = (e as CustomEvent).detail as SageAction;
      if (!a?.name) return;
      const target = a.target ?? targetForTool(a.name);
      if (a.ok) {
        const label = a.result || prettyName(a.name);
        hudToast("SAGE", label, "alert");
        if (target) hudHighlight(target);
        // Pull fresh server data so the new task/note/reminder shows up.
        router.refresh();
      } else if (a.result) {
        hudToast("SAGE", a.result, "info");
      }
    };

    window.addEventListener("sage:highlight", onHighlight);
    window.addEventListener("sage:action", onAction);
    return () => {
      window.removeEventListener("sage:highlight", onHighlight);
      window.removeEventListener("sage:action", onAction);
    };
  }, [router]);

  return null;
}

function prettyName(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
