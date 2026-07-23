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
