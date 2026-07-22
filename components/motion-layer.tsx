"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Scroll choreography: every band (.section) below the fold starts dimmed
 * and slightly dropped, then rises into place as it enters the viewport.
 * Pure IntersectionObserver + CSS classes — no per-component wiring, and
 * nothing is hidden before hydration (no-JS still sees everything).
 */
export function MotionLayer() {
  const pathname = usePathname();

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const sections = Array.from(document.querySelectorAll<HTMLElement>("main .section"));
    if (!sections.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("rv-in");
            observer.unobserve(e.target);
          }
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px -8% 0px" },
    );

    for (const s of sections) {
      // Only choreograph what's off-screen; visible content never blinks.
      const r = s.getBoundingClientRect();
      if (r.top > window.innerHeight * 0.92) {
        s.classList.add("rv-pre");
        observer.observe(s);
      }
    }
    return () => observer.disconnect();
  }, [pathname]);

  return null;
}
