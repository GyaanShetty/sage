import { NavRail } from "@/features/shell/components/nav-rail";
import { TopBar } from "@/features/shell/components/top-bar";
import { Launcher } from "@/features/shell/components/launcher";
import { Wheel } from "@/features/shell/components/wheel";
import { CommandPalette } from "@/features/command-palette/components/command-palette";
import { VoiceOverlay } from "@/features/voice/components/voice-overlay";
import { TickerTape } from "@/components/ticker-tape";
import { Toaster } from "@/components/toaster";
import { MotionLayer } from "@/components/motion-layer";
import { AmbientCanvas } from "@/components/ambient-canvas";
import { AmbientMode } from "@/components/ambient-mode";
import { AmbientVoice } from "@/components/ambient-voice";
import { BootSequence } from "@/components/boot-sequence";
import { BootBriefing } from "@/components/boot-briefing";
import { WakeWord } from "@/features/voice/wake-word";
import { HudLayer } from "@/components/hud-layer";
import { GestureNav } from "@/features/gestures/gesture-nav";
import { ErrorReporter } from "@/components/error-reporter";
import { ReminderTicker } from "@/components/reminder-ticker";
import { VoiceContinue } from "@/components/voice-continue";
import { FrameRail } from "@/components/frame-rail";
import { FitPage } from "@/components/fit-page";
import { NavGuard } from "@/components/nav-guard";

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="shellframe">
      <AmbientCanvas />
      <BootSequence />
      <BootBriefing />
      <ReminderTicker />
      <VoiceContinue />

      {/* The rail is the frame: eight destinations, always on screen.
          The function-key row it replaces is gone; the wheel and the command
          palette are still mounted and still reach the other twenty pages,
          which the rail deliberately does not list. */}
      <NavRail />

      <div className="shellframe-col">
        <TopBar />
        <TickerTape />
        <FrameRail edge="top" />
        <main className="hud-grid flex-1 overflow-y-auto">{children}</main>
        <FrameRail edge="bottom" />
      </div>
      <Wheel />
      <Launcher />
      <Toaster />
      <MotionLayer />
      <CommandPalette />
      <VoiceOverlay />
      <WakeWord />
      <AmbientMode />
      <AmbientVoice />
      <HudLayer />
      <FitPage />
      <GestureNav />
      <ErrorReporter />
      <NavGuard />
    </div>
  );
}
