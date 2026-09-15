"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { PAGES } from "./pages";

/**
 * The function-key rail.
 *
 * The defining piece of terminal chrome: a fixed row of numbered keys that go
 * to the same place every time. Its value is not decorative — it is that F6 is
 * *always* tasks, so getting there stops being navigation and becomes muscle
 * memory.
 *
 * The keys are real. Pressing F5 navigates; the rail is not a picture of a
 * keyboard shortcut that does not exist. Destinations come from PAGES, which is
 * already the single source of truth the wheel and the launcher read, so a
 * renamed or moved route cannot leave a dead key behind.
 *
 * F1–F4 are left alone: browsers claim F1 (help) and F3 (find), and stealing
 * a key the browser has already promised is a worse outcome than starting the
 * row at F5.
 */

/*
 * The keys, by destination only.
 *
 * The labels used to be written here by hand, and five of the ten disagreed
 * with the wheel: F5 said DESK for a page the wheel called Dashboard, F7 said
 * TASKS for Workspace, F10 BIO for Health, F11 WIRE for Mail, F8 SIGNALS for
 * Sitrep. Three naming systems for the same ten pages — the breadcrumb, the
 * wheel and the rail — so nothing you learned in one place helped you in
 * another.
 *
 * The label now comes from PAGES, which the wheel and the launcher already
 * read. A page renamed once is renamed everywhere, and a key cannot drift
 * from the thing it opens.
 */
const KEYS: { fn: number; href: string }[] = [
  { fn: 5, href: "/dashboard" },
  { fn: 6, href: "/ops" },
  { fn: 7, href: "/workspace" },
  { fn: 8, href: "/sitrep" },
  { fn: 9, href: "/memory" },
  { fn: 10, href: "/health" },
  { fn: 11, href: "/mail" },
  { fn: 12, href: "/calendar" },
  { fn: 13, href: "/markets" },
  { fn: 14, href: "/study" },
];

/** Every key must point at a page that exists — a dead key is worse than none. */
export const FN_KEYS = KEYS
  .map((k) => ({ ...k, label: PAGES.find((p) => p.href === k.href)?.label.toUpperCase() ?? "" }))
  .filter((k) => k.label);

export function FnRail() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Never steal the key from someone typing, and never from a browser
      // shortcut the user has explicitly asked for with a modifier.
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;

      const hit = FN_KEYS.find((k) => e.key === `F${k.fn}`);
      if (!hit) return;
      e.preventDefault();
      router.push(hit.href);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <nav className="fn-rail" aria-label="Function keys">
      {FN_KEYS.map((k) => (
        <button
          key={k.fn}
          className={`fn-key${pathname === k.href ? " on" : ""}`}
          onClick={() => router.push(k.href)}
          title={`F${k.fn} — ${k.label}`}
        >
          <span className="fn-n">F{k.fn}</span>
          <span className="fn-l">{k.label}</span>
        </button>
      ))}
    </nav>
  );
}
