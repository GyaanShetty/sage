"use client";

/**
 * HUD event bus — the glue that makes SAGE feel present. Voice, tools and the
 * proactive engine emit these; listeners mounted in the shell react (flash a
 * panel, toast, refresh data). All are plain window CustomEvents so any
 * component can participate without prop drilling.
 */

export type HudTarget =
  | "tasks"
  | "notes"
  | "sitrep"
  | "agenda"
  | "markets"
  | "memory"
  | "graph";

/** Flash + scroll a panel into view. `target` resolves to [data-hud="target"]
 *  first, then #target as a fallback. */
export function hudHighlight(target: HudTarget | string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("sage:highlight", { detail: target }));
}

export interface SageAction {
  name: string;
  ok: boolean;
  result?: string;
  target?: HudTarget;
}

/** Announce that SAGE did something (voice tool-call, automation) so the UI can
 *  toast it, refresh, and light up the relevant panel in real time. */
export function hudAction(action: SageAction) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("sage:action", { detail: action }));
}

/** Convenience toast (reuses the existing Toaster listener). */
export function hudToast(title: string, body?: string, kind: "info" | "alert" = "info") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("sage:toast", { detail: { title, body, kind } }));
}

/** Map a voice/tool name to the panel it affects. */
export function targetForTool(name: string): HudTarget | undefined {
  switch (name) {
    case "create_task":
    case "complete_task":
    case "list_tasks":
      return "tasks";
    case "create_note":
    case "remember":
      return "notes";
    case "create_reminder":
    case "list_reminders":
      return "agenda";
    case "get_briefing":
      return "sitrep";
    default:
      return undefined;
  }
}
