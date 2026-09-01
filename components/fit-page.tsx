"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Make a page fit the screen, when that is an honest thing to do.
 *
 * The dashboard is built to end at the bottom of the viewport. Every other
 * screen is a normal scrolling page, and most of them overshoot by a little —
 * a row and a half of cards, a footer just past the fold — which is the
 * annoying amount. You scroll a short distance, twice, to see something that
 * would have fit if it were nine percent smaller.
 *
 * So: measure the overshoot and shrink the page by exactly that much.
 *
 * Three limits, because "always fit" is the wrong goal and produces
 * unreadable screens:
 *
 * - Only above 1400px. Below that a phone is already the constraint, and
 *   shrinking further is how text becomes unreadable.
 * - Only up to MAX_OVERSHOOT. A page that is twice the viewport is a
 *   document, and a document is meant to be scrolled. Squeezing a mail thread
 *   to 0.5 does not let you read it; it just makes it small.
 * - Never below MIN_ZOOM, whatever the arithmetic says.
 *
 * `zoom` rather than `transform: scale` on purpose: zoom reflows, so text
 * re-lays out and stays crisp and selectable, and fixed-position children
 * (the launcher, the toaster) keep working. A scale transform would blur the
 * type and trap every fixed descendant inside the transformed box.
 */

const MIN_WIDTH = 1400;
const MAX_OVERSHOOT = 1.5;
const MIN_ZOOM = 0.7;

/**
 * Screens where scrolling is the point.
 *
 * These are readers and editors — long-form text, a threaded mailbox, a code
 * buffer. Shrinking them to fit would defeat what they are for, and their
 * height is a function of the content rather than of the layout, so the
 * measurement would swing wildly as you move between items.
 */
const NEVER_FIT = ["/dashboard", "/mail", "/code", "/chat", "/read", "/knowledge", "/memory"];

export function FitPage() {
  const pathname = usePathname();

  useEffect(() => {
    const main = document.querySelector<HTMLElement>("main.hud-grid");
    if (!main) return;

    const clear = () => { main.style.zoom = ""; };

    if (NEVER_FIT.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
      clear();
      return;
    }

    /**
     * The applied value, so a measurement that agrees with what is already set
     * writes nothing.
     *
     * This is what stops the feedback loop: the ResizeObserver below fires
     * from the relayout our own write causes, and a fit that always writes
     * would observe itself forever.
     */
    let applied = "";

    const apply = (z: string) => {
      if (z === applied) return;
      applied = z;
      main.style.zoom = z;
    };

    const fit = () => {
      if (window.innerWidth < MIN_WIDTH) { apply(""); return; }

      /*
       * Correct relative to the zoom already applied, and iterate.
       *
       * The obvious version — clear the zoom, read the height, put it back —
       * writes to the element twice on every pass, and each write wakes the
       * ResizeObserver that called us. On a page still settling (a video
       * embed resolving, an image landing) that oscillates.
       *
       * This instead treats `content / viewport` as an error term and steps
       * the zoom toward the fixed point where they are equal. It converges in
       * two or three frames and needs nothing un-applied to take a reading,
       * so a page that changes height later simply re-converges.
       */
      const z = Number(applied) || 1;
      const content = main.scrollHeight;
      const available = main.clientHeight;
      if (content <= 0 || available <= 0) return;

      // Overshoot expressed at zoom 1, so the ceiling means the same thing on
      // every pass regardless of where the iteration currently sits.
      const natural = (content / available) / z;
      if (natural > MAX_OVERSHOOT) { apply(""); return; }
      if (natural <= 1.005 && z >= 1) { apply(""); return; }

      const next = Math.min(1, Math.max(MIN_ZOOM, z * (available / content) - 0.004));
      // A dead band: a page that breathes by a pixel must not rewrite the
      // zoom every frame, since each rewrite is another observer callback.
      if (Math.abs(next - z) < 0.008) return;
      apply(String(next));
    };

    fit();
    window.addEventListener("resize", fit);

    // Pages fill in after first paint — a tile resolves, an image loads — so
    // one measurement at mount is never enough.
    let queued = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(queued);
      queued = requestAnimationFrame(fit);
    });
    ro.observe(main);

    return () => {
      window.removeEventListener("resize", fit);
      cancelAnimationFrame(queued);
      ro.disconnect();
      clear();
    };
  }, [pathname]);

  return null;
}
