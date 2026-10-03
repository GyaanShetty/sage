import { CommandPalette } from "@/features/command-palette/components/command-palette";
import { Toaster } from "@/components/toaster";
import { ErrorReporter } from "@/components/error-reporter";
import { NavGuard } from "@/components/nav-guard";

/**
 * The shell, such as it is.
 *
 * The previous one mounted twenty-three components around every page: an
 * ambient canvas, a boot sequence, a ticker tape, two frame rails, a nav rail,
 * a radial wheel, a launcher, a voice overlay, a wake word, a gesture layer, a
 * motion layer, a HUD layer and a zoom-to-fit observer. Most of them drew
 * something; several of them fought each other for the same corner.
 *
 * Four remain. The palette is how you reach anything not on the page, the
 * toaster is how a fired reminder reaches you, and the error reporter is how a
 * crash reaches me.
 *
 * NavGuard I cut as scenery and put straight back, because it is not. A route
 * change is a React transition, and any state update landing mid-flight throws
 * the render away and restarts it — so on a page whose sections each answer
 * their own fetch, a click could begin a navigation that was never allowed to
 * finish. No error, no failed request, the URL simply never moved. There are
 * fewer fetches in flight here than on the old wall, which makes it rarer
 * rather than impossible.
 */
export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <CommandPalette />
      <Toaster />
      <ErrorReporter />
      <NavGuard />
    </>
  );
}
