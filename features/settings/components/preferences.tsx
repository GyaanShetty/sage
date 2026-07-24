"use client";

import { Mic, Moon } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { useShellStore } from "@/features/shell/store";
import { APP_NAME } from "@/lib/config";
import { cn } from "@/lib/utils";

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      role="switch"
      aria-checked={on}
      className={cn("relative h-5 w-9 shrink-0 border transition-colors", on ? "border-foreground bg-foreground" : "border-border-glass")}
    >
      <span className={cn("absolute top-0.5 size-3.5 transition-all", on ? "left-[18px] bg-background" : "left-0.5 bg-subtle")} />
    </button>
  );
}

/** Local device preferences — wake word + ambient standby. Persisted in the
 *  shell store (localStorage), so each device chooses for itself. */
export function Preferences() {
  const wakeWord = useShellStore((s) => s.wakeWord);
  const setWakeWord = useShellStore((s) => s.setWakeWord);
  const ambientArmed = useShellStore((s) => s.ambientArmed);
  const setAmbientArmed = useShellStore((s) => s.setAmbientArmed);

  return (
    <div className="mt-8">
      <h2 className="text-sm font-medium text-muted">Preferences · this device</h2>

      <GlassPanel className="mt-3 flex items-center gap-4 p-5">
        <Mic className="size-5 text-muted" />
        <div className="flex-1">
          <p className="text-sm font-medium">Wake word</p>
          <p className="text-xs text-subtle">
            Say &quot;{APP_NAME}&quot; or &quot;Hey {APP_NAME}&quot; to open the live assistant hands-free. Keeps the mic listening while this tab is open.
          </p>
        </div>
        <Toggle on={wakeWord} onClick={() => setWakeWord(!wakeWord)} />
      </GlassPanel>

      <GlassPanel className="mt-3 flex items-center gap-4 p-5">
        <Moon className="size-5 text-muted" />
        <div className="flex-1">
          <p className="text-sm font-medium">Ambient standby</p>
          <p className="text-xs text-subtle">
            After 90 seconds idle, {APP_NAME} fades to a cinematic clock &amp; briefing screen. Move to resume.
          </p>
        </div>
        <Toggle on={ambientArmed} onClick={() => setAmbientArmed(!ambientArmed)} />
      </GlassPanel>
    </div>
  );
}
