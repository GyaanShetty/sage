import { cn } from "@/lib/utils";

/** Core surface primitive: translucent glass over pure black. */
export function GlassPanel({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border-glass bg-glass backdrop-blur-xl",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
