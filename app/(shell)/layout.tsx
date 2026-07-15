import { Sidebar } from "@/features/shell/components/sidebar";
import { CommandPalette } from "@/features/command-palette/components/command-palette";
import { VoiceOverlay } from "@/features/voice/components/voice-overlay";

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">{children}</main>
      <CommandPalette />
      <VoiceOverlay />
    </div>
  );
}
