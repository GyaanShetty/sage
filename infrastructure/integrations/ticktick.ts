import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { proxyFetch } from "@/infrastructure/http/fetch";
import { appUrl } from "./google";

const AUTH_URL = "https://ticktick.com/oauth/authorize";
const TOKEN_URL = "https://ticktick.com/oauth/token";
const API = "https://api.ticktick.com/open/v1";
const SCOPES = "tasks:read tasks:write";

function redirectUri() {
  return `${appUrl()}/api/integrations/ticktick/callback`;
}

export function ticktickAuthUrl(): string {
  const params = new URLSearchParams({
    client_id: process.env.TICKTICK_CLIENT_ID!,
    scope: SCOPES,
    response_type: "code",
    redirect_uri: redirectUri(),
    state: "sage",
  });
  return `${AUTH_URL}?${params}`;
}

export async function exchangeTickTickCode(code: string): Promise<boolean> {
  const basic = Buffer.from(`${process.env.TICKTICK_CLIENT_ID}:${process.env.TICKTICK_CLIENT_SECRET}`).toString("base64");
  const res = await proxyFetch(TOKEN_URL, {
    method: "POST",
    headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, grant_type: "authorization_code", scope: SCOPES, redirect_uri: redirectUri() }),
  });
  if (!res.ok) return false;
  const tok = (await res.json()) as { access_token: string; expires_in?: number };
  await db.from("Integration").upsert(
    {
      id: crypto.randomUUID(),
      userId: DEFAULT_USER_ID,
      provider: "ticktick",
      scopes: SCOPES.split(" "),
      accessToken: tok.access_token,
      refreshToken: null,
      expiresAt: tok.expires_in ? new Date(Date.now() + tok.expires_in * 1000).toISOString() : null,
      status: "active",
    },
    { onConflict: "userId,provider" },
  );
  return true;
}

async function token(): Promise<string | null> {
  const { data } = await db
    .from("Integration")
    .select("accessToken")
    .eq("userId", DEFAULT_USER_ID)
    .eq("provider", "ticktick")
    .eq("status", "active")
    .maybeSingle();
  return (data?.accessToken as string) ?? null;
}

export interface TickTask {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  dueDate?: string;
  priority: number; // 0 none,1 low,3 medium,5 high
  status: number; // 0 open, 2 done
}

/** Pull open tasks (with deadlines) across all TickTick lists. */
export async function getTickTickTasks(): Promise<TickTask[] | null> {
  const t = await token();
  if (!t) return null;
  try {
    const projRes = await proxyFetch(`${API}/project`, { headers: { authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(9000) });
    if (!projRes.ok) return null;
    const projects = (await projRes.json()) as { id: string; name: string }[];
    // include the inbox implicitly by querying each project's data
    const out: TickTask[] = [];
    for (const p of [{ id: "inbox", name: "Inbox" }, ...projects].slice(0, 12)) {
      try {
        const dRes = await proxyFetch(`${API}/project/${p.id}/data`, { headers: { authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(8000) });
        if (!dRes.ok) continue;
        const data = (await dRes.json()) as { tasks?: { id: string; title: string; dueDate?: string; priority?: number; status?: number }[] };
        for (const task of data.tasks ?? []) {
          out.push({ id: task.id, title: task.title, projectId: p.id, projectName: p.name, dueDate: task.dueDate, priority: task.priority ?? 0, status: task.status ?? 0 });
        }
      } catch {}
    }
    // sort: due first (soonest), then by priority
    out.sort((a, b) => {
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return b.priority - a.priority;
    });
    return out;
  } catch {
    return null;
  }
}

/** Complete a TickTick task. */
export async function completeTickTask(projectId: string, taskId: string): Promise<boolean | null> {
  const t = await token();
  if (!t) return null;
  const res = await proxyFetch(`${API}/project/${projectId}/task/${taskId}/complete`, {
    method: "POST",
    headers: { authorization: `Bearer ${t}` },
  });
  return res.ok;
}

/**
 * Delete a TickTick task outright.
 *
 * Completing and deleting are different intentions and the integration only
 * had the first, so anything created here by mistake could be ticked off but
 * never removed — and a task deleted in TickTick had no counterpart action in
 * SAGE at all. Removal has to travel in both directions or the two lists drift,
 * which is the same hole createTickTask closed for additions.
 */
export async function deleteTickTask(projectId: string, taskId: string): Promise<boolean | null> {
  const t = await token();
  if (!t) return null;
  const res = await proxyFetch(`${API}/project/${projectId}/task/${taskId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${t}` },
    signal: AbortSignal.timeout(9000),
  });
  return res.ok;
}

/** Change a task's priority — the axis behind the Eisenhower matrix. TickTick
 *  priorities: 0 none, 1 low, 3 medium, 5 high. */
export async function updateTickTaskPriority(projectId: string, taskId: string, priority: number): Promise<boolean | null> {
  const t = await token();
  if (!t) return null;
  const res = await proxyFetch(`${API}/task/${taskId}`, {
    method: "POST",
    headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
    body: JSON.stringify({ id: taskId, projectId, priority }),
  });
  return res.ok;
}

/**
 * Push a task INTO TickTick.
 *
 * The integration was read-only: SAGE could list your TickTick tasks and tick
 * them off, but anything created here stayed here, so the two lists drifted
 * apart the moment you used either one. This closes that loop.
 *
 * Returns the TickTick id on success and null when TickTick is not connected —
 * never throws, because failing to mirror a task must not fail creating it.
 */
export async function createTickTask(input: {
  title: string;
  dueAt?: string | null;
  /** SAGE priority: 0 urgent … 3 low. TickTick uses 5 high … 0 none. */
  priority?: number;
  notes?: string;
}): Promise<{ id: string; projectId: string } | null> {
  const t = await token();
  if (!t) return null;

  // The two scales run in opposite directions, and getting this backwards
  // silently files everything urgent as trivial.
  const tickPriority = { 0: 5, 1: 3, 2: 1, 3: 0 }[input.priority ?? 2] ?? 1;

  try {
    const res = await proxyFetch(`${API}/task`, {
      method: "POST",
      headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
      body: JSON.stringify({
        title: input.title.slice(0, 300),
        priority: tickPriority,
        ...(input.notes ? { content: input.notes.slice(0, 2000) } : {}),
        ...(input.dueAt ? { dueDate: new Date(input.dueAt).toISOString().replace(/\.\d{3}Z$/, "+0000") } : {}),
      }),
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return null;
    /*
     * The project id is returned and was being discarded.
     *
     * Every later call — complete, update, delete — is addressed by
     * project AND task, so dropping it meant a task SAGE had just created
     * was one it could never touch again. That is the single omission
     * that made two-way sync impossible.
     */
    const created = (await res.json()) as { id?: string; projectId?: string };
    if (!created.id) return null;
    return { id: created.id, projectId: created.projectId ?? "inbox" };
  } catch {
    return null;
  }
}

/**
 * Change a task in place.
 *
 * `updateTickTaskPriority` existed and could only do priority, so a title
 * or a due date edited in SAGE had nowhere to go. TickTick's update is a
 * merge-POST: fields left out are left alone, which is exactly what a
 * sync wants — it should never overwrite something it was not asked to.
 */
export async function updateTickTask(
  projectId: string,
  taskId: string,
  patch: { title?: string; dueAt?: string | null; priority?: number },
): Promise<boolean> {
  const t = await token();
  if (!t) return false;
  try {
    const res = await proxyFetch(`${API}/task/${taskId}`, {
      method: "POST",
      headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
      body: JSON.stringify({
        id: taskId,
        projectId,
        ...(patch.title !== undefined ? { title: patch.title.slice(0, 300) } : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        /* An explicit null clears the date; undefined leaves it untouched.
           Collapsing those two is how "no due date" becomes "due now". */
        ...(patch.dueAt === null ? { dueDate: null } : {}),
        ...(patch.dueAt
          ? { dueDate: new Date(patch.dueAt).toISOString().replace(/\.\d{3}Z$/, "+0000") }
          : {}),
      }),
      signal: AbortSignal.timeout(9000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
