import Link from "next/link";
import type { Metadata } from "next";
import { SageMark } from "@/components/ui/sage-mark";

export const metadata: Metadata = {
  title: "Not found",
  description: "That address does not exist in SAGE.",
};

/**
 * The 404.
 *
 * Next's default is an unstyled white page reading "This page could not be
 * found" — the same problem the crash page had: it is not SAGE, it says
 * nothing useful, and it leaves you at a dead end with no way back except the
 * browser's own button.
 *
 * A 404 in a private single-user app almost always means one of two things: a
 * typed URL, or a link into something that has since been deleted. Both are
 * best answered with the way back, so the screen is mostly doors.
 */
const DOORS = [
  { href: "/dashboard", label: "Command", hint: "the wall" },
  { href: "/ops", label: "Ops", hint: "standing state" },
  { href: "/board", label: "Boards", hint: "canvas" },
  { href: "/mail", label: "Mail", hint: "gmail · outlook" },
];

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "var(--background, #08090b)",
        color: "var(--foreground, #f4f5f7)",
      }}
    >
      <div style={{ maxWidth: 460, width: "100%", display: "grid", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--signal, #ff3b30)" }}>
          <SageMark size={26} />
          <span style={{ fontSize: 11, letterSpacing: "0.22em" }}>SAGE · 404</span>
        </div>

        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 400, letterSpacing: "0.02em" }}>
          No such address.
        </h1>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--muted, #9a9ba1)" }}>
          Either the URL was mistyped, or whatever used to be here has been
          deleted. Nothing is broken — this screen just does not exist.
        </p>

        <nav style={{ display: "grid", gap: 1, background: "var(--rule, rgba(244,245,247,0.09))", border: "1px solid var(--rule, rgba(244,245,247,0.09))" }}>
          {DOORS.map((d) => (
            <Link
              key={d.href}
              href={d.href}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: 12,
                padding: "10px 12px",
                background: "var(--panel, #0c0d0f)",
                color: "inherit",
                textDecoration: "none",
                fontSize: 13,
              }}
            >
              <span>{d.label}</span>
              <span style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--subtle, #5c5d64)" }}>
                {d.hint}
              </span>
            </Link>
          ))}
        </nav>
      </div>
    </main>
  );
}
