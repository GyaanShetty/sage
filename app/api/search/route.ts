import { NextResponse } from "next/server";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

export const dynamic = "force-dynamic";

export type SearchKind = "task" | "note" | "memory" | "holding" | "career" | "workout" | "expense";

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  at?: string | null;
}

/** Escape PostgREST's ILIKE wildcards so a literal % or _ doesn't match everything. */
function escapeLike(q: string): string {
  return q.replace(/[%_\\]/g, (m) => `\\${m}`);
}

/** Pull the first bit of readable text out of a Tiptap doc. */
function docText(content: unknown): string {
  const blocks = (content as { content?: { content?: { text?: string }[] }[] } | null)?.content ?? [];
  return blocks
    .flatMap((b) => (b.content ?? []).map((c) => c.text ?? ""))
    .filter(Boolean)
    .join(" ")
    .slice(0, 120);
}

/**
 * One search across everything SAGE holds — tasks, notes, memories, holdings,
 * job applications, workouts and expenses. Each source is queried
 * independently and a failure in one never blanks the rest.
 */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (raw.length < 2) return NextResponse.json({ ok: true, data: [] });
  const q = escapeLike(raw);
  const like = `%${q}%`;
  const limit = 6;

  const settle = async <T>(p: PromiseLike<T>): Promise<T | null> => {
    try { return await p; } catch { return null; }
  };

  const [tasks, notes, memories, events] = await Promise.all([
    settle(db.from("Task").select("id, title, status, dueAt")
      .eq("userId", DEFAULT_USER_ID).ilike("title", like).limit(limit)),
    settle(db.from("Note").select("id, title, kind, content, createdAt")
      .eq("userId", DEFAULT_USER_ID).ilike("title", like).limit(limit)),
    settle(db.from("Memory").select("id, content, createdAt")
      .eq("userId", DEFAULT_USER_ID).ilike("content", like).limit(limit)),
    // Event rows hold holdings, applications, workouts and expenses as JSON,
    // so they're filtered in memory rather than by SQL.
    settle(db.from("Event").select("id, type, payload, createdAt")
      .eq("userId", DEFAULT_USER_ID)
      .in("type", ["portfolio.holding", "career.application", "health.workout", "finance.expense"])
      .order("createdAt", { ascending: false }).limit(400)),
  ]);

  const hits: SearchHit[] = [];

  for (const t of tasks?.data ?? []) {
    hits.push({
      kind: "task", id: t.id as string, title: t.title as string,
      subtitle: (t.status as string) + (t.dueAt ? ` · due ${String(t.dueAt).slice(0, 10)}` : ""),
      href: "/workspace", at: t.dueAt as string | null,
    });
  }

  for (const n of notes?.data ?? []) {
    hits.push({
      kind: "note", id: n.id as string, title: (n.title as string) || "Untitled note",
      subtitle: docText(n.content) || (n.kind as string),
      href: (n.kind as string) === "journal" ? "/journal" : `/knowledge?note=${n.id}`,
      at: n.createdAt as string,
    });
  }

  for (const m of memories?.data ?? []) {
    const text = String(m.content ?? "");
    hits.push({
      kind: "memory", id: m.id as string,
      title: text.slice(0, 90), subtitle: "memory",
      href: "/memory", at: m.createdAt as string,
    });
  }

  const needle = raw.toLowerCase();
  for (const ev of events?.data ?? []) {
    const p = (ev.payload ?? {}) as Record<string, unknown>;
    const type = ev.type as string;
    const blob = JSON.stringify(p).toLowerCase();
    if (!blob.includes(needle)) continue;

    if (type === "portfolio.holding") {
      hits.push({
        kind: "holding", id: ev.id as string,
        title: String(p.symbol ?? "—"),
        subtitle: `${p.qty ?? 0} @ ${p.avgCost ?? 0}${p.thesis ? ` · ${String(p.thesis).slice(0, 60)}` : ""}`,
        href: "/portfolio", at: ev.createdAt as string,
      });
    } else if (type === "career.application") {
      hits.push({
        kind: "career", id: ev.id as string,
        title: `${p.role ?? "Role"} · ${p.company ?? "—"}`,
        subtitle: String(p.status ?? "applied"),
        href: "/career", at: ev.createdAt as string,
      });
    } else if (type === "health.workout") {
      hits.push({
        kind: "workout", id: ev.id as string,
        title: `${p.type ?? "Workout"} · ${p.minutes ?? 0} min`,
        subtitle: String(p.intensity ?? ""),
        href: "/health", at: ev.createdAt as string,
      });
    } else if (type === "finance.expense") {
      hits.push({
        kind: "expense", id: ev.id as string,
        title: `${p.merchant ?? "—"} · ₹${p.amount ?? 0}`,
        subtitle: String(p.category ?? ""),
        href: "/portfolio", at: ev.createdAt as string,
      });
    }
  }

  // Prefix matches first, then whole-word, then the rest; newest wins on ties.
  const score = (h: SearchHit) => {
    const t = h.title.toLowerCase();
    if (t.startsWith(needle)) return 0;
    if (new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(t)) return 1;
    return 2;
  };
  hits.sort((a, b) => score(a) - score(b) || (b.at ?? "").localeCompare(a.at ?? ""));

  const failed = [tasks, notes, memories, events].filter((r) => r === null || r?.error).length;
  return NextResponse.json({ ok: true, data: hits.slice(0, 24), partial: failed > 0 });
}
