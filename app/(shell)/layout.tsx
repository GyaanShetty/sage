import { Sidebar } from "@/features/shell/components/sidebar";
import { StatusBar } from "@/features/shell/components/status-bar";
import { MobileNav } from "@/features/shell/components/mobile-nav";
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
import { ProactiveVoice } from "@/components/proactive-voice";

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <AmbientCanvas />
      <BootSequence />
      <BootBriefing />
      <StatusBar />
      <TickerTape />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="hud-grid flex-1 overflow-y-auto pb-16 md:pb-0">{children}</main>
      </div>
      <MobileNav />
      <Toaster />
      <MotionLayer />
      <CommandPalette />
      <VoiceOverlay />
      <WakeWord />
      <AmbientMode />
      <HudLayer />
      <ProactiveVoice />
    </div>
  );
}
