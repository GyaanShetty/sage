"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { APP_CREED, TZ } from "@/lib/config";

/**
 * The frame around the workspace.
 *
 * The reference sheets are bordered by thin strips of registration data —
 * track, frame, link, status — and that border is doing most of the work:
 * it is what makes the page read as a *readout of something* rather than as a
 * dark rectangle with content in it. Without it, panels float in space; with
 * it, they sit inside an instrument.
 *
 * Every field is real. The route is the route, the build is the deployed
 * commit, the clock is the clock. Inventing a plausible-looking "TRACK 006-2"
 * would look closer to the reference and would be the one dishonest thing on
 * a screen full of measurements — and once a viewer works out that a readout
 * is decorative, none of the others are trusted either.
 */
export function FrameRail({ edge }: { edge: "top" | "bottom" }) {
  const pathname = usePathname();
  const [build, setBuild] = useState<string | null>(null);
  const [clock, setClock] = useState<string>("");

  useEffect(() => {
    fetch("/api/version")
      .then((r) => r.json())
      .then((j) => setBuild(j?.data?.short ?? null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const tick = () =>
      setClock(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
        }).format(new Date()),
      );
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  // The route, as a coordinate. "/" is the dashboard rather than an empty label.
  const route = (pathname === "/" ? "dashboard" : pathname.replace(/^\//, "")).toUpperCase();

  return (
    <div className={`frame-rail ${edge}`} aria-hidden="true">
      {edge === "top" ? (
        <>
          <span className="fr-mark">SAGE</span>
          <span className="fr-k">VIEW</span><span className="fr-v">{route}</span>
          <span className="fr-rule" />
          <span className="fr-k">BUILD</span><span className="fr-v">{build ?? "····"}</span>
          <span className="fr-k">TZ</span><span className="fr-v">{TZ.split("/")[1] ?? TZ}</span>
        </>
      ) : (
        <>
          <span className="fr-k">STATUS</span><span className="fr-sig">NOMINAL</span>
          <span className="fr-rule" />
          {/* The creed from his identity sheet. The one field on this rail
              that is not a measurement, which is why it sits apart and
              greyed rather than beside the readouts. */}
          <span className="fr-creed">{APP_CREED}</span>
          <span className="fr-rule" />
          <span className="fr-k">LOCAL</span>
          <span className="fr-v" suppressHydrationWarning>{clock || "--:--:--"}</span>
        </>
      )}
    </div>
  );
}
