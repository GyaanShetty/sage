import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

/**
 * What you already know about someone, gathered before you need it.
 *
 * "Sir, Ms Potts is on line two" was never impressive because JARVIS could
 * route a call. It was impressive because he had already read the file.
 *
 * Everything here is data SAGE already holds — mail, memories, notes,
 * applications, meetings. What was missing is that it is scattered across
 * pages by *type* rather than by *who*, so remembering what was last said to
 * someone meant searching four places and joining it yourself, in the two
 * minutes before you walk in.
 *
 * No model. A dossier is a filing job, and the value is in it being instant,
 * complete and verifiably his own data rather than a plausible summary.
 */

export interface DossierEntry {
  source: "mail" | "memory" | "note" | "career" | "calendar" | "decision";
  title: string;
  detail?: string;
  at?: string;
  href?: string;
}

export interface Dossier {
  subject: string;
  entries: DossierEntry[];
  /** The last time this person or thing appeared anywhere, at all. */
  lastSeen: string | null;
  empty: boolean;
}

/**
 * Search terms from a subject.
 *
 * A calendar entry is rarely a bare name — "Call with Priya re: internship",
 * "Goldman OA". The words that survive are the ones worth searching; the
 * scaffolding around them matches everything and therefore nothing.
 */
export function searchTerms(subject: string): string[] {
  const stop = new Set([
    "call", "meeting", "sync", "with", "and", "the", "for", "re", "about",
    "catch", "up", "chat", "interview", "round", "session", "discussion", "1:1",
  ]);
  return subject
    .split(/[\s,–—:;()/|-]+/)
    .map((w) => w.trim().replace(/[^\w@.]/g, ""))
    .filter((w) => {
      if (stop.has(w.toLowerCase())) return false;
      // Short all-caps tokens are acronyms — OA, SDE, PM, HR — and are often
      // the most searchable word in the whole entry. A blanket length filter
      // threw away exactly the term worth searching for.
      if (/^[A-Z0-9]{2,}$/.test(w)) return true;
      return w.length > 2;
    })
    .slice(0, 4);
}

export async function buildDossier(subject: string): Promise<Dossier> {
  const clean = subject.trim();
  if (!clean) return { subject: clean, entries: [], lastSeen: null, empty: true };

  const terms = searchTerms(clean);
  const query = terms.length ? terms.join(" ") : clean;

  const [mail, memories, notes, applications, meetings, decisions] = await Promise.all([
    mailFor(query).catch(() => []),
    memoriesFor(clean).catch(() => []),
    notesFor(query).catch(() => []),
    applicationsFor(query).catch(() => []),
    meetingsFor(query).catch(() => []),
    decisionsFor(query).catch(() => []),
  ]);

  const entries = [...mail, ...memories, ...notes, ...applications, ...meetings, ...decisions]
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));

  return {
    subject: clean,
    entries: entries.slice(0, 30),
    lastSeen: entries.find((e) => e.at)?.at ?? null,
    empty: entries.length === 0,
  };
}

async function mailFor(query: string): Promise<DossierEntry[]> {
  const { searchGmail } = await import("@/infrastructure/integrations/google");
  const mail = await searchGmail(`newer_than:365d ${query}`, 6);
  return (mail ?? []).map((m) => ({
    source: "mail" as const,
    title: m.subject || "(no subject)",
    detail: `${m.from} — ${m.snippet.slice(0, 160)}`,
    href: "/mail",
  }));
}

async function memoriesFor(subject: string): Promise<DossierEntry[]> {
  const { recallWithin } = await import("@/core/memory/recall");
  const found = await recallWithin(subject, 6, 3000);
  return found.map((m) => ({
    source: "memory" as const,
    title: m.content.slice(0, 200),
    detail: m.type,
    href: "/memory",
  }));
}

async function notesFor(query: string): Promise<DossierEntry[]> {
  // A single OR'd pattern rather than one query per term: four round trips to
  // build a dossier someone is waiting on is three too many.
  const pattern = query.split(/\s+/).filter(Boolean).slice(0, 3).map((t) => `content.ilike.%${t}%`).join(",");
  if (!pattern) return [];
  const { data } = await db
    .from("Note").select("id, title, content, createdAt")
    .eq("userId", DEFAULT_USER_ID).or(pattern).limit(5);

  return (data ?? []).map((n) => ({
    source: "note" as const,
    title: (n.title as string) || "Note",
    detail: String(n.content ?? "").slice(0, 160),
    at: n.createdAt as string,
    href: "/workspace",
  }));
}

async function applicationsFor(query: string): Promise<DossierEntry[]> {
  const { data } = await db
    .from("Event").select("payload, createdAt")
    .eq("userId", DEFAULT_USER_ID).eq("type", "career.application")
    .limit(100);

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return (data ?? [])
    .filter((r) => {
      const p = JSON.stringify(r.payload ?? {}).toLowerCase();
      return terms.some((t) => p.includes(t));
    })
    .slice(0, 4)
    .map((r) => {
      const p = r.payload as { company?: string; role?: string; status?: string };
      return {
        source: "career" as const,
        title: `${p.company ?? "Application"}${p.role ? ` — ${p.role}` : ""}`,
        detail: p.status ? `status: ${p.status}` : undefined,
        at: r.createdAt as string,
        href: "/career",
      };
    });
}

async function meetingsFor(query: string): Promise<DossierEntry[]> {
  const { upcomingEvents } = await import("@/core/calendar");
  const events = await upcomingEvents(20, 30);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return events
    .filter((e) => terms.some((t) => e.summary.toLowerCase().includes(t)))
    .slice(0, 4)
    .map((e) => ({
      source: "calendar" as const,
      title: e.summary,
      detail: e.location ?? undefined,
      at: e.start,
      href: "/dashboard",
    }));
}

async function decisionsFor(query: string): Promise<DossierEntry[]> {
  const { listDecisions } = await import("@/core/decisions/store");
  const all = await listDecisions(100);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return all
    .filter((d) => terms.some((t) => `${d.title} ${d.reasoning}`.toLowerCase().includes(t)))
    .slice(0, 3)
    .map((d) => ({
      source: "decision" as const,
      title: d.title,
      detail: d.outcome ? `scored ${d.outcome} · claimed ${d.confidence}%` : `open · ${d.confidence}% confident`,
      at: d.decidedAt,
      href: "/decisions",
    }));
}
