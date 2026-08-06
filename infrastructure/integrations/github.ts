import { proxyFetch } from "@/infrastructure/http/fetch";

const API = "https://api.github.com";

function headers() {
  return {
    authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "SAGE",
  };
}

async function gh<T>(path: string): Promise<T | null> {
  if (!process.env.GITHUB_TOKEN) return null;
  try {
    const res = await proxyFetch(`${API}${path}`, { headers: headers(), signal: AbortSignal.timeout(9000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export interface Repo { name: string; full_name: string; pushed_at: string; language: string | null; private: boolean }
export interface PrItem { title: string; repo: string; number: number; url: string; updated: string; draft: boolean }

export interface GithubSnapshot {
  login: string | null;
  repos: Repo[];
  openPrs: PrItem[];
  reviewRequests: PrItem[];
}

interface SearchResp {
  items: { title: string; number: number; html_url: string; updated_at: string; draft?: boolean; repository_url: string }[];
}

function mapSearch(r: SearchResp | null): PrItem[] {
  return (r?.items ?? []).slice(0, 6).map((i) => ({
    title: i.title,
    number: i.number,
    url: i.html_url,
    updated: i.updated_at,
    draft: !!i.draft,
    repo: i.repository_url.split("/repos/")[1] ?? "",
  }));
}

/** Full GitHub snapshot for the dashboard. */
export async function getGithub(): Promise<GithubSnapshot | null> {
  if (!process.env.GITHUB_TOKEN) return null;
  const user = await gh<{ login: string }>("/user");
  const login = user?.login ?? null;
  const [repos, openPrs, reviews] = await Promise.all([
    gh<Repo[]>("/user/repos?sort=pushed&per_page=6&affiliation=owner,collaborator"),
    gh<SearchResp>("/search/issues?q=is:pr+is:open+author:@me&sort=updated&per_page=6"),
    gh<SearchResp>("/search/issues?q=is:pr+is:open+review-requested:@me&sort=updated&per_page=6"),
  ]);
  return {
    login,
    repos: (repos ?? []).map((r) => ({ name: r.name, full_name: r.full_name, pushed_at: r.pushed_at, language: r.language, private: r.private })),
    openPrs: mapSearch(openPrs),
    reviewRequests: mapSearch(reviews),
  };
}

/** Compact text summary for the agent tool. */
export async function githubSummary(): Promise<string | null> {
  const snap = await getGithub();
  if (!snap) return null;
  const parts: string[] = [];
  if (snap.reviewRequests.length) parts.push(`${snap.reviewRequests.length} PRs awaiting your review: ${snap.reviewRequests.map((p) => p.title).join("; ")}`);
  if (snap.openPrs.length) parts.push(`${snap.openPrs.length} of your PRs open: ${snap.openPrs.map((p) => `${p.repo}#${p.number}`).join(", ")}`);
  if (snap.repos.length) parts.push(`recent repos: ${snap.repos.slice(0, 4).map((r) => r.name).join(", ")}`);
  return parts.join(". ") || "No open PRs or review requests.";
}

/**
 * Write a file to a repo, creating or updating it.
 *
 * Used by the backup: the point of a backup is that it survives the thing it
 * is backing up, so it has to leave the Supabase project entirely. A private
 * GitHub repo is free, versioned, and somewhere Gyaan can already reach.
 *
 * The existing sha is looked up first because the Contents API rejects an
 * update that does not name the blob it is replacing.
 */
export async function putRepoFile(
  repo: string,           // "owner/name"
  path: string,
  content: string,
  message: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!process.env.GITHUB_TOKEN) return { ok: false, error: "No GITHUB_TOKEN set." };

  const base = `${API}/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
  let sha: string | undefined;
  try {
    const head = await proxyFetch(base, { headers: headers(), signal: AbortSignal.timeout(9000) });
    if (head.ok) sha = ((await head.json()) as { sha?: string }).sha;
  } catch {
    // A missing file is the normal case for a new day's backup, not an error.
  }

  try {
    const res = await proxyFetch(base, {
      method: "PUT",
      headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify({
        message,
        content: Buffer.from(content, "utf8").toString("base64"),
        ...(sha ? { sha } : {}),
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return { ok: false, error: `GitHub ${res.status}: ${(await res.text()).slice(0, 200)}` };
    const j = (await res.json()) as { content?: { html_url?: string } };
    return { ok: true, url: j.content?.html_url ?? `https://github.com/${repo}/blob/main/${path}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Whether the repo exists and is private — a backup must never land in public. */
export async function repoVisibility(repo: string): Promise<"private" | "public" | null> {
  const r = await gh<{ private: boolean }>(`/repos/${repo}`);
  return r ? (r.private ? "private" : "public") : null;
}

// ── Pushing code from SAGE ───────────────────────────────────────────────────

/**
 * Repos he can push to.
 *
 * Sorted by most recently pushed rather than alphabetically: the repo you want
 * is nearly always the one you touched last, and a DSA repo gets touched daily.
 */
export async function listWritableRepos(limit = 60): Promise<Repo[]> {
  const repos = await gh<(Repo & { permissions?: { push?: boolean } })[]>(
    `/user/repos?sort=pushed&per_page=${Math.min(100, limit)}&affiliation=owner,collaborator`,
  );
  return (repos ?? [])
    .filter((r) => r.permissions?.push !== false)
    .map((r) => ({ name: r.name, full_name: r.full_name, pushed_at: r.pushed_at, language: r.language, private: r.private }));
}

/** Create a repo under the authenticated user. */
export async function createRepo(
  name: string,
  { priv = true, description }: { priv?: boolean; description?: string } = {},
): Promise<{ ok: true; repo: string } | { ok: false; error: string }> {
  if (!process.env.GITHUB_TOKEN) return { ok: false, error: "No GITHUB_TOKEN set." };
  try {
    const res = await proxyFetch(`${API}/user/repos`, {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify({
        name,
        private: priv,
        ...(description ? { description } : {}),
        // Without a first commit the repo has no default branch, and the
        // Contents API cannot write into a branch that does not exist yet.
        auto_init: true,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const body = await res.text();
      if (res.status === 422) return { ok: false, error: `GitHub rejected that name — ${name} may already exist.` };
      return { ok: false, error: `GitHub ${res.status}: ${body.slice(0, 160)}` };
    }
    const j = (await res.json()) as { full_name: string };
    return { ok: true, repo: j.full_name };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export interface TreeEntry { path: string; type: "file" | "dir" }

/**
 * List one directory of a repo.
 *
 * Used to browse to a folder rather than type a path from memory. Git has no
 * empty directories, so a folder exists exactly when something is in it —
 * which is why creating one is the same operation as pushing a file into it.
 */
export async function listRepoPath(repo: string, path = ""): Promise<TreeEntry[] | null> {
  const clean = path.replace(/^\/+|\/+$/g, "");
  const entries = await gh<{ name: string; path: string; type: string }[]>(
    `/repos/${repo}/contents/${clean.split("/").filter(Boolean).map(encodeURIComponent).join("/")}`,
  );
  if (!entries) return null;
  // A single file returns an object rather than an array.
  if (!Array.isArray(entries)) return [];
  return entries
    .map((e) => ({ path: e.path, type: e.type === "dir" ? ("dir" as const) : ("file" as const) }))
    .sort((a, b) => (a.type === b.type ? a.path.localeCompare(b.path) : a.type === "dir" ? -1 : 1));
}

/** Does this path already hold a file? Answered before overwriting one. */
export async function repoFileExists(repo: string, path: string): Promise<boolean> {
  const r = await gh<{ sha?: string }>(
    `/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}`,
  );
  return !!r?.sha;
}

/** The signed-in account, so the UI can show whose repos these are. */
export async function githubLogin(): Promise<string | null> {
  return (await gh<{ login: string }>("/user"))?.login ?? null;
}
