import { cn } from "@/lib/utils";

/** Core surface primitive — flat technical cell: hairline border, square corners. */
export function GlassPanel({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("border border-border-glass bg-background", className)} {...props}>
      {children}
    </div>
  );
}
