"use client";

import { useEffect, useState } from "react";
import { Bell, Mic, Moon } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { useShellStore } from "@/features/shell/store";
import { APP_NAME } from "@/lib/config";
import { cn } from "@/lib/utils";
import { disablePush, enablePush, pushEnabled, pushSupported } from "@/features/notifications/push-client";

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

  const [notify, setNotify] = useState(false);
  const [notifyMsg, setNotifyMsg] = useState<string | null>(null);
  const [notifyBusy, setNotifyBusy] = useState(false);

  useEffect(() => {
    pushEnabled().then(setNotify).catch(() => {});
  }, []);

  const toggleNotify = async () => {
    if (notifyBusy) return;
    setNotifyBusy(true);
    setNotifyMsg(null);
    try {
      if (notify) {
        await disablePush();
        setNotify(false);
      } else {
        const r = await enablePush();
        setNotify(r.ok);
        if (!r.ok) setNotifyMsg(r.reason ?? "Couldn't enable notifications.");
      }
    } finally {
      setNotifyBusy(false);
    }
  };

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

      {pushSupported() && (
        <GlassPanel className="mt-3 flex items-center gap-4 p-5">
          <Bell className="size-5 text-muted" />
          <div className="flex-1">
            <p className="text-sm font-medium">Push notifications</p>
            <p className="text-xs text-subtle">
              {notifyMsg ?? `Let ${APP_NAME} reach this device — reminders, overdue tasks and important alerts, even when the app is closed.`}
            </p>
          </div>
          <Toggle on={notify} onClick={toggleNotify} />
        </GlassPanel>
      )}
    </div>
  );
}
