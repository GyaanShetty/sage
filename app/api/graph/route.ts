import { NextResponse } from "next/server";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

export const revalidate = 120;

export interface GNode { id: string; label: string; kind: "memory" | "note" | "source"; group: string; weight: number }
export interface GEdge { a: string; b: string }

const STOP = new Set("the a an and or of to in on for with is are was were be been being this that these those you your i my me we our it its as at by from into about over under not no yes have has had do does did will would can could should".split(" "));

function keywords(text: string): string[] {
  return Array.from(
    new Set(
      (text.toLowerCase().match(/[a-z][a-z']{3,}/g) ?? []).filter((w) => !STOP.has(w)),
    ),
  );
}

/** Build a concept graph from memories, notes, and sources. */
export async function GET() {
  const [{ data: mems }, { data: notes }, { data: sources }] = await Promise.all([
    db.from("Memory").select("id, content, type, importance").eq("userId", DEFAULT_USER_ID).is("supersededBy", null).limit(60),
    db.from("Note").select("id, title").eq("userId", DEFAULT_USER_ID).eq("kind", "doc").limit(40),
    db.from("Source").select("id, title, kind").eq("userId", DEFAULT_USER_ID).limit(30),
  ]);

  const nodes: GNode[] = [];
  const kw: Map<string, string[]> = new Map();

  for (const m of mems ?? []) {
    const label = String(m.content ?? "").slice(0, 60);
    nodes.push({ id: `m:${m.id}`, label, kind: "memory", group: String(m.type ?? "fact"), weight: 1 + (Number(m.importance) || 0) / 3 });
    kw.set(`m:${m.id}`, keywords(String(m.content ?? "")));
  }
  for (const n of notes ?? []) {
    nodes.push({ id: `n:${n.id}`, label: String(n.title ?? "").slice(0, 60), kind: "note", group: "note", weight: 1 });
    kw.set(`n:${n.id}`, keywords(String(n.title ?? "")));
  }
  for (const s of sources ?? []) {
    nodes.push({ id: `s:${s.id}`, label: String(s.title ?? "").slice(0, 60), kind: "source", group: String(s.kind ?? "doc"), weight: 1.4 });
    kw.set(`s:${s.id}`, keywords(String(s.title ?? "")));
  }

  // link nodes sharing >=1 significant keyword (cap per node to keep it legible)
  const edges: GEdge[] = [];
  const ids = nodes.map((n) => n.id);
  const degree = new Map<string, number>();
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const A = kw.get(ids[i]) ?? [], B = new Set(kw.get(ids[j]) ?? []);
      if (A.some((w) => B.has(w))) {
        if ((degree.get(ids[i]) ?? 0) < 5 && (degree.get(ids[j]) ?? 0) < 5) {
          edges.push({ a: ids[i], b: ids[j] });
          degree.set(ids[i], (degree.get(ids[i]) ?? 0) + 1);
          degree.set(ids[j], (degree.get(ids[j]) ?? 0) + 1);
        }
      }
    }
  }

  return NextResponse.json({ ok: true, data: { nodes, edges } });
}
