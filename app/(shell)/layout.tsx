import { StatusBar } from "@/features/shell/components/status-bar";
import { Launcher } from "@/features/shell/components/launcher";
import { Wheel } from "@/features/shell/components/wheel";
import { CommandPalette } from "@/features/command-palette/components/command-palette";
import { VoiceOverlay } from "@/features/voice/components/voice-overlay";
import { TickerTape } from "@/components/ticker-tape";
import { Toaster } from "@/components/toaster";
import { MotionLayer } from "@/components/motion-layer";
import { AmbientCanvas } from "@/components/ambient-canvas";
import { AmbientMode } from "@/components/ambient-mode";
import { BootSequence } from "@/components/boot-sequence";
import { BootBriefing } from "@/components/boot-briefing";
import { WakeWord } from "@/features/voice/wake-word";
import { HudLayer } from "@/components/hud-layer";
import { GestureNav } from "@/features/gestures/gesture-nav";
import { ErrorReporter } from "@/components/error-reporter";
import { ReminderTicker } from "@/components/reminder-ticker";
import { VoiceContinue } from "@/components/voice-continue";

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <AmbientCanvas />
      <BootSequence />
      <BootBriefing />
      <ReminderTicker />
      <VoiceContinue />
      <StatusBar />
      <TickerTape />
      <div className="flex min-h-0 flex-1">
        <main className="hud-grid flex-1 overflow-y-auto pb-8">{children}</main>
      </div>
      <Wheel />
      <Launcher />
      <Toaster />
      <MotionLayer />
      <CommandPalette />
      <VoiceOverlay />
      <WakeWord />
      <AmbientMode />
      <HudLayer />
      <GestureNav />
      <ErrorReporter />
    </div>
  );
}
