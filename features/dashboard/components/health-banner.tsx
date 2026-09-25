"use client";

/**
 * The one thing on the dashboard that is allowed to interrupt.
 *
 * Everything in SAGE degrades rather than crashes when a key is missing, which
 * is right — and it is also how a half-configured instance runs for a week
 * before anyone notices the reminders never fired. /api/preflight has always
 * known, and it was reachable only by going to Settings and looking, which is
 * the one thing you do not do when nothing appears to be wrong.
 *
 * So it says something on the dashboard, and only when there is something to
 * say: a missing required key, a database that is not answering, or a heartbeat
 * that has stopped. A banner that appears when everything is fine is a banner
 * people learn to ignore, and then it is worth nothing on the day it matters.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { asArray } from "@/lib/as-array";

interface Check { key: string; set: boolean; note: string }
interface Preflight {
  verdict: string;
  database: string;
  heartbeat: { healthy: boolean; ageMinutes: number | null };
  required: Check[];
}

export function HealthBanner() {
  const [faults, setFaults] = useState<string[]>([]);

  useEffect(() => {
    /*
     * Once, on mount, and late. Preflight pings the database and reads the
     * heartbeat, so it is not free — and it is the least urgent thing on a page
     * that is already making a dozen calls. Nothing here changes minute to
     * minute; a configuration fault is a fault until someone fixes it.
     */
    const id = setTimeout(() => {
      fetch("/api/preflight")
        .then((r) => r.json())
        .then((j) => {
          const d = j?.data as Preflight | undefined;
          if (!d) return;
          const out: string[] = [];
          if (d.database !== "ok") out.push("the database is not answering");
          for (const c of asArray<Check>(d.required)) if (!c.set) out.push(`${c.key} is not set`);
          if (!d.heartbeat?.healthy) out.push("nothing is driving the clock — no reminders or alerts will fire");
          setFaults(out);
        })
        .catch(() => {});
    }, 4000);
    return () => clearTimeout(id);
  }, []);

  if (!faults.length) return null;

  return (
    <div className="hb" role="status">
      <AlertTriangle className="size-3.5" strokeWidth={1.75} aria-hidden />
      <span className="hb-t">
        {faults.length === 1 ? "SAGE is missing something:" : `SAGE is missing ${faults.length} things:`}
      </span>
      {/* The faults themselves, not a count — "1 problem" makes you go and look
          to find out whether it is the one you already know about. */}
      <span className="hb-d">{faults.slice(0, 3).join(" · ")}{faults.length > 3 ? ` · +${faults.length - 3} more` : ""}</span>
      <Link href="/settings#diagnostics" className="hb-a">DIAGNOSTICS →</Link>
    </div>
  );
}
