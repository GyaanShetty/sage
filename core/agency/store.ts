/**
 * Where proposals live.
 *
 * On the generic `Event` table, as `agency.proposal`, which is the same
 * pattern expenses and board documents already use. That is not laziness:
 * SAGE's Supabase is a free tier that Gyaan owns, and shipping a feature
 * that needs a migration means shipping a feature that does not work until
 * he runs it. v2 has to be deployable the moment it is pushed.
 */

import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import type { AgencySettings, Proposal, ProposalKind, ProposalStatus } from "./types";

const TYPE = "agency.proposal";
const SETTINGS_TYPE = "agency.settings";

type Row = { id: string; payload: Omit<Proposal, "id"> };

export async function listProposals(opts: { status?: ProposalStatus[]; limit?: number } = {}): Promise<Proposal[]> {
  const { data } = await db
    .from("Event").select("id, payload")
    .eq("userId", DEFAULT_USER_ID).eq("type", TYPE)
    .order("createdAt", { ascending: false })
    .limit(opts.limit ?? 200);

  const rows = ((data ?? []) as Row[]).map((r) => ({ id: r.id, ...r.payload }));
  const want = opts.status;
  return rows
    .filter((p) => !want || want.includes(p.status))
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

/**
 * Add a proposal unless an open one already says the same thing.
 *
 * Producers run on the heartbeat, so without this the same receipt is
 * proposed every five minutes until it is dealt with. Dedupe is checked
 * against proposals in ANY state, not just open ones: a proposal he
 * dismissed should stay dismissed rather than coming back on the next
 * beat, which is the behaviour that makes an assistant exhausting.
 */
export async function propose(p: Omit<Proposal, "id" | "status" | "createdAt">): Promise<string | null> {
  const existing = await listProposals({ limit: 400 });
  if (existing.some((x) => x.dedupe === p.dedupe)) return null;

  const id = crypto.randomUUID();
  const row: Omit<Proposal, "id"> = { ...p, status: "proposed", createdAt: new Date().toISOString() };
  await db.from("Event").insert({ id, userId: DEFAULT_USER_ID, type: TYPE, payload: row });
  return id;
}

export async function getProposal(id: string): Promise<Proposal | null> {
  const { data } = await db
    .from("Event").select("id, payload")
    .eq("userId", DEFAULT_USER_ID).eq("type", TYPE).eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const r = data as Row;
  return { id: r.id, ...r.payload };
}

export async function patchProposal(id: string, patch: Partial<Proposal>): Promise<void> {
  const cur = await getProposal(id);
  if (!cur) return;
  const { id: _drop, ...rest } = { ...cur, ...patch };
  void _drop;
  await db.from("Event").update({ payload: rest }).eq("userId", DEFAULT_USER_ID).eq("id", id);
}

/* ── settings ──────────────────────────────────────────────────────────── */

const DEFAULTS: AgencySettings = { auto: {} };

/**
 * Nothing is automatic until he says so.
 *
 * The defaults are empty on purpose. An assistant that starts out acting on
 * its own has to be caught doing something wrong before it can be trusted,
 * which is backwards — it should be watched doing things right and then let
 * off the leash, one kind at a time.
 */
export async function getSettings(): Promise<AgencySettings> {
  const { data } = await db
    .from("Event").select("payload")
    .eq("userId", DEFAULT_USER_ID).eq("type", SETTINGS_TYPE)
    .maybeSingle();
  const p = (data as { payload?: AgencySettings } | null)?.payload;
  return { auto: { ...DEFAULTS.auto, ...(p?.auto ?? {}) } };
}

export async function setAuto(kind: ProposalKind, on: boolean): Promise<AgencySettings> {
  const cur = await getSettings();
  const next: AgencySettings = { auto: { ...cur.auto, [kind]: on } };
  const { data } = await db
    .from("Event").select("id")
    .eq("userId", DEFAULT_USER_ID).eq("type", SETTINGS_TYPE)
    .maybeSingle();
  if (data?.id) {
    await db.from("Event").update({ payload: next }).eq("id", data.id as string);
  } else {
    await db.from("Event").insert({
      id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: SETTINGS_TYPE, payload: next,
    });
  }
  return next;
}
