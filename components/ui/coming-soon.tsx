import { GlassPanel } from "@/components/ui/glass-panel";

export function ComingSoon({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <GlassPanel className="max-w-sm p-8 text-center">
        <h1 className="text-lg font-medium">{title}</h1>
        <p className="mt-2 text-sm text-subtle">
          Lands in {phase}. See <span className="font-mono text-xs">docs/architecture</span> for the design.
        </p>
      </GlassPanel>
    </div>
  );
}
