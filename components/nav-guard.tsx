"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { navStarted } from "@/lib/nav-busy";

/**
 * The click always lands.
 *
 * A route change in the App Router is a React *transition*: React renders the
 * next page in the background and swaps it in — and only then does the URL
 * change. Any ordinary state update that arrives while that render is in
 * flight throws the work away and starts it again.
 *
 * On a wall of thirty tiles, that is not an edge case. Every tile answers its
 * own fetch, and on a slow morning those answers keep arriving for eight or
 * ten seconds. Each one restarted the navigation, so the render never reached
 * the end and the URL never moved. Clicking a link did nothing at all, with
 * no error in the console and no failed request — the navigation had begun,
 * it simply was never allowed to finish.
 *
 * Measured, not guessed: with tile responses blocked at the network layer the
 * same click navigates in under a second; unblocked, the RSC payload arrives
 * at ~900ms and the URL is still unchanged nine seconds later.
 *
 * The honest fix is not to out-clever React's scheduler. It is to notice that
 * the navigation has not happened and complete it the way the browser always
 * could:
 *
 *   · Client-side navigation is still tried first, and when it works — which
 *     is most of the time, on quiet pages — nothing here fires.
 *   · If the path has not changed after the grace period, this does a real
 *     browser navigation to the href that was clicked. A full load costs a
 *     second; a link that does nothing costs the trust in every link.
 *
 * Anything the browser would handle itself is left alone: modified clicks,
 * new tabs, downloads, other origins, and hash links on the current page.
 */

/** How long a client navigation gets before the browser is asked to do it. */
const GRACE_MS = 1200;

export function NavGuard() {
  const pathname = usePathname();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let endNav: (() => void) | null = null;

    const onClick = (e: MouseEvent) => {
      // Let the browser have the clicks it owns: new tab, save, middle-click.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const a = (e.target as HTMLElement | null)?.closest?.("a");
      if (!a) return;
      const href = a.getAttribute("href");
      if (!href || !href.startsWith("/")) return;                 // external or hash
      if (a.target && a.target !== "_self") return;
      if (a.hasAttribute("download")) return;

      const from = window.location.pathname;
      const to = href.split("#")[0].split("?")[0];
      if (to === from) return;

      // Quieten the wall for the duration: fewer updates landing mid-render
      // means the client-side navigation has a chance to finish on its own.
      if (endNav) endNav();
      endNav = navStarted();

      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        // Still here? Then the transition never committed. Go properly.
        if (window.location.pathname === from) window.location.assign(href);
      }, GRACE_MS);
    };

    // Capture phase, so this sees the click even where a handler stops it
    // from bubbling.
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      if (timer) clearTimeout(timer);
      if (endNav) endNav();
    };
  }, [pathname]);

  /**
   * Arrival releases everything.
   *
   * The listener effect above is keyed on the pathname, so a committed
   * navigation tears it down — cancelling the fallback timer and ending the
   * pause — and sets it up again for the page just arrived at.
   */
  useEffect(() => undefined, [pathname]);

  return null;
}
