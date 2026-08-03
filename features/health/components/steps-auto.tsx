"use client";

import { useState } from "react";
import { Check, Copy, Footprints, Smartphone } from "lucide-react";

/**
 * Getting steps in automatically.
 *
 * Worth being straight about the constraint: no server can read your step
 * count. It lives in Apple Health on the phone, behind a permission that no
 * web request crosses. So SAGE cannot go and fetch it — the phone has to push
 * it, and the phone can, on a schedule, with no app to install.
 *
 * This panel exists because that setup is a five-minute job that is otherwise
 * invisible. SAGE closes the day out at 9pm either way: if the number arrived
 * it is recorded, and if it did not you get a nudge rather than silence.
 */
export function StepsAuto({ loggedToday }: { loggedToday: boolean }) {
  const [copied, setCopied] = useState<string | null>(null);

  const url = typeof window === "undefined" ? "" : `${window.location.origin}/api/health`;
  const body = '{ "steps": <Steps>, "activeKcal": <Active Energy> }';

  const copy = async (what: string, text: string) => {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="hl-card">
      <div className="hl-cardhead">
        <Footprints className="size-3.5" />
        <h3>DAILY STEPS</h3>
        <span className="hl-avg">{loggedToday ? "logged today" : "nothing today"}</span>
      </div>

      <p className="mt-1 text-[12px] leading-relaxed text-muted">
        SAGE closes the day at 9pm: it records whatever arrived, and pushes you a
        nudge if nothing did. It cannot read the count itself — that number lives
        in Apple Health, behind a permission no server can cross — so the phone
        has to send it. No app needed, just a Shortcut.
      </p>

      <ol className="mt-2 flex flex-col gap-1 pl-4 text-[12px] text-subtle" style={{ listStyle: "decimal" }}>
        <li>Shortcuts → Automation → Time of Day → 9:00 pm, daily, Run Immediately.</li>
        <li>Add <b className="text-muted">Find Health Samples</b> — Steps, Today, sum.</li>
        <li>Add <b className="text-muted">Get Contents of URL</b>, method POST, JSON body:</li>
      </ol>

      <div className="mt-2 flex flex-col gap-1">
        <button
          onClick={() => copy("url", url)}
          className="flex items-center gap-2 border border-border-glass px-2 py-1.5 text-left font-mono text-[11px] text-muted transition-colors hover:border-border-glass-strong hover:text-foreground"
        >
          {copied === "url" ? <Check className="size-3 shrink-0" /> : <Copy className="size-3 shrink-0" />}
          <span className="truncate">{url}</span>
        </button>
        <button
          onClick={() => copy("body", body)}
          className="flex items-center gap-2 border border-border-glass px-2 py-1.5 text-left font-mono text-[11px] text-muted transition-colors hover:border-border-glass-strong hover:text-foreground"
        >
          {copied === "body" ? <Check className="size-3 shrink-0" /> : <Copy className="size-3 shrink-0" />}
          <span className="truncate">{body}</span>
        </button>
      </div>

      <p className="mt-2 flex items-start gap-1.5 text-[11px] text-subtle">
        <Smartphone className="mt-0.5 size-3 shrink-0" />
        Replace the angle-bracket parts with the Shortcuts variables. Posting the
        same day twice is fine — the later value replaces the earlier one.
      </p>
    </div>
  );
}
