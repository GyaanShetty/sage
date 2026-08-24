"use client";

import { useEffect, useState } from "react";
import { Bell, Globe, Hand, Mic, Moon, Rows3, Sparkles } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { useShellStore } from "@/features/shell/store";
import { APP_NAME } from "@/lib/config";
import { cn } from "@/lib/utils";
import { useGlobeEnabled } from "@/lib/globe-pref";
import { useDensity } from "@/lib/density-pref";
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
  const gestureNav = useShellStore((s) => s.gestureNav);
  const setGestureNav = useShellStore((s) => s.setGestureNav);
  const moodValue = useShellStore((s) => s.moodValue);
  const mood = useShellStore((s) => s.mood);
  const setMoodValue = useShellStore((s) => s.setMoodValue);
  const voiceMode = useShellStore((s) => s.voiceMode);
  const setVoiceMode = useShellStore((s) => s.setVoiceMode);

  const [notify, setNotify] = useState(false);
  const [notifyMsg, setNotifyMsg] = useState<string | null>(null);
  const [notifyBusy, setNotifyBusy] = useState(false);
  // Client-only capability check — gate behind mount so SSR and first client
  // render agree (avoids a hydration mismatch).
  const [mounted, setMounted] = useState(false);
  const { on: globe, set: setGlobe } = useGlobeEnabled();
  const { value: densityValue, set: setDensityValue } = useDensity();

  useEffect(() => {
    setMounted(true);
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

  const moodLabel = mood === "formal" ? "Formal & composed" : mood === "playful" ? "Playful & warm" : "Balanced";

  return (
    <div className="mt-8">
      <h2 className="text-sm font-medium text-muted">Preferences · this device</h2>

      <GlassPanel className="mt-3 p-5">
        <div className="flex items-center gap-4">
          <Sparkles className="size-5 text-muted" />
          <div className="flex-1">
            <p className="text-sm font-medium">SAGE&apos;s mood</p>
            <p className="text-xs text-subtle">How much personality SAGE shows in voice &amp; chat.</p>
          </div>
          <span className="text-xs font-medium text-live">{moodLabel}</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={moodValue}
          onChange={(e) => setMoodValue(Number(e.target.value))}
          className="mood-range mt-4 w-full"
        />
        <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wide text-subtle">
          <span>Formal</span><span>Balanced</span><span>Playful</span>
        </div>
      </GlassPanel>

      <GlassPanel className="mt-3 p-5">
        <div className="flex items-center gap-4">
          <Mic className="size-5 text-muted" />
          <div className="flex-1">
            <p className="text-sm font-medium">Voice engine</p>
            <p className="text-xs text-subtle">
              {voiceMode === "device"
                ? "On-device — instant, unlimited, 100% free. Quality depends on your device's voices."
                : "Cloud — SAGE's premium voice (ElevenLabs), with free neural fallbacks. The richest, most human option."}
            </p>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          {([["cloud", "Cloud (free)"], ["device", "On-device"]] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setVoiceMode(v)}
              className={cn(
                "flex-1 rounded-lg border px-3 py-2 text-xs transition-colors",
                voiceMode === v ? "border-live bg-glass-strong text-foreground" : "border-border-glass text-muted hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </GlassPanel>

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

      <GlassPanel className="mt-3 flex items-center gap-4 p-5">
        <Hand className="size-5 text-muted" />
        <div className="flex-1">
          <p className="text-sm font-medium">Gesture control</p>
          <p className="text-xs text-subtle">
            Navigate hands-free with the webcam — pinch and drag to scroll like a touchscreen, make a fist and slide left/right to change pages. Uses computer vision; the camera runs only while this is on.
          </p>
        </div>
        <Toggle on={gestureNav} onClick={() => setGestureNav(!gestureNav)} />
      </GlassPanel>

      {mounted && (
        <GlassPanel className="mt-3 flex items-center gap-4 p-5">
          <Globe className="size-5 text-muted" />
          <div className="flex-1">
            <p className="text-sm font-medium">3D globe</p>
            <p className="text-xs text-subtle">
              The centrepiece on Home. It is the most expensive thing SAGE draws — a live
              WebGL scene that polls satellites every few seconds — and the usual cause of
              the app feeling sluggish. Turned off, the flat map takes over and nothing is
              rendered at all.
            </p>
          </div>
          <Toggle on={globe} onClick={() => setGlobe(!globe)} />
        </GlassPanel>
      )}

      {mounted && (
        <GlassPanel className="mt-3 flex items-center gap-4 p-5">
          <Rows3 className="size-5 text-muted" />
          <div className="flex-1">
            <p className="text-sm font-medium">Compact layout</p>
            <p className="text-xs text-subtle">
              Tightens spacing and shrinks the globe so more fits on screen at once. Worth
              turning on in a half-width window, where the standard spacing costs you whole
              panels below the fold. Nothing is hidden — only the room it takes up changes.
            </p>
          </div>
          <Toggle
            on={densityValue === "compact"}
            onClick={() => setDensityValue(densityValue === "compact" ? "comfortable" : "compact")}
          />
        </GlassPanel>
      )}

      {mounted && pushSupported() && (
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
