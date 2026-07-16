import { cn } from "@/lib/utils";

/**
 * Core surface primitive — HUD panel: sharp corners, hairline border,
 * corner brackets, faint glass fill. Every feature inherits this look.
 */
export function GlassPanel({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative rounded-md border border-border-glass bg-glass backdrop-blur-xl",
        className,
      )}
      {...props}
    >
      {/* corner brackets */}
      <span aria-hidden className="pointer-events-none absolute -left-px -top-px size-2.5 border-l-2 border-t-2 border-border-glass-strong" />
      <span aria-hidden className="pointer-events-none absolute -right-px -top-px size-2.5 border-r-2 border-t-2 border-border-glass-strong" />
      <span aria-hidden className="pointer-events-none absolute -bottom-px -left-px size-2.5 border-b-2 border-l-2 border-border-glass-strong" />
      <span aria-hidden className="pointer-events-none absolute -bottom-px -right-px size-2.5 border-b-2 border-r-2 border-border-glass-strong" />
      {children}
    </div>
  );
}
