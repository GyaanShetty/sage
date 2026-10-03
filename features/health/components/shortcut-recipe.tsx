"use client";

import { useState } from "react";
import { Copy, Check, ChevronDown } from "lucide-react";

/**
 * How to get data out of the iPhone and into SAGE.
 *
 * This lived nowhere. The webhook has always accepted the fields, and the
 * shortcut that feeds it existed once on his phone and posts only sleep now —
 * which is why the dashboard shows four traces and fills one. Written down,
 * on the page where the gap is visible, it stops being something to
 * reconstruct from memory every time it breaks.
 *
 * The body below is what Shortcuts should post. Every key is one the receiver
 * already reads (app/api/webhook/health/route.ts documents the aliases), so
 * this can be copied verbatim rather than adapted.
 */

const BODY = `{
  "steps": 8420,
  "sleepHours": 7.2,
  "restingHr": 58,
  "spo2": 97,
  "activeKcal": 420,
  "dietaryKcal": 2150,
  "proteinG": 118,
  "waterMl": 500,
  "weightKg": 71.4
}`;

const STEPS: [string, string][] = [
  ["1 · New shortcut", "Shortcuts → + → name it SAGE HEALTH."],
  ["2 · Read the metrics", "Add a Find Health Sample action per metric: Steps, Sleep Analysis, Resting Heart Rate, Blood Oxygen, Active Energy, Dietary Energy, Protein, Water, Weight. Set each to Today, and All for the range."],
  ["3 · Build the body", "Add a Dictionary action and set the keys below, each to the matching sample."],
  ["4 · Post it", "Add Get Contents of URL: method POST, request body JSON, and the Dictionary as the body."],
  ["5 · Automate", "Shortcuts → Automation → Time of Day → 23:45 daily → run it, and turn OFF Ask Before Running."],
];

export function ShortcutRecipe() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (what: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      // Clipboard is blocked outside a secure context and on some in-app
      // browsers. Saying so beats a button that silently does nothing.
      setCopied("blocked");
    }
  };

  // The key is not rendered. It is a bearer secret, this page is a screenshot
  // away from a chat, and the placeholder is the one part he already knows.
  const url = typeof window === "undefined"
    ? "/api/webhook/health?key=CRON_SECRET"
    : `${window.location.origin}/api/webhook/health?key=CRON_SECRET`;

  return (
    <section className="rcp">
      <button className="rcp-head" onClick={() => setOpen((o) => !o)}>
        <span className="rcp-t">Apple Health → SAGE</span>
        <span className="rcp-s">SHORTCUT RECIPE</span>
        <ChevronDown className={`size-3.5 rcp-chev${open ? " on" : ""}`} />
      </button>

      {open && (
        <div className="rcp-body">
          <div className="rcp-row">
            <span className="rcp-k">POST to</span>
            <code className="rcp-code">{url}</code>
            <button className="rcp-copy" onClick={() => void copy("url", url)}>
              {copied === "url" ? <Check className="size-3" /> : <Copy className="size-3" />}
            </button>
          </div>
          <p className="rcp-note">
            Replace <b>CRON_SECRET</b> with the value from your Vercel environment. It is a
            bearer token, so treat the finished shortcut as a credential.
          </p>

          {STEPS.map(([k, v]) => (
            <div className="rcp-step" key={k}>
              <span className="rcp-sk">{k}</span>
              <span className="rcp-sv">{v}</span>
            </div>
          ))}

          <div className="rcp-row">
            <span className="rcp-k">Body</span>
            <button className="rcp-copy" onClick={() => void copy("body", BODY)}>
              {copied === "body" ? <Check className="size-3" /> : <Copy className="size-3" />}
            </button>
          </div>
          <pre className="rcp-pre">{BODY}</pre>

          <p className="rcp-note">
            Send only the metrics you have — missing keys are left missing rather than stored as
            zero. Shortcuts can also post one metric per request; the store merges by IST day, so
            several small posts through the day are fine and are easier to build than one that
            gathers everything.
          </p>
          <p className="rcp-note">
            <b>MyFitnessPal</b> has had no public API since 2016, and its partner programme is not
            open to individuals. It does write calories and water into Apple Health, so turn that on
            in MFP under Settings → Apple Health and the same shortcut carries it —
            <b> dietaryKcal</b> is intake, <b>activeKcal</b> is burn, and they are deliberately
            separate.
          </p>
          {copied === "blocked" && <p className="rcp-note">Copying is blocked here — select the text instead.</p>}
        </div>
      )}
    </section>
  );
}
