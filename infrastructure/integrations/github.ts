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
    if (!res.ok) return { ok: false, error: await writeError(res, repo) };
    const j = (await res.json()) as { content?: { html_url?: string } };
    return { ok: true, url: j.content?.html_url ?? `https://github.com/${repo}/blob/main/${path}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Turn a failed write into something actionable.
 *
 * "Resource not accessible by personal access token" is GitHub telling you the
 * token can read but not write, and it is worth saying so plainly: the raw
 * message sends people looking for a bug in the app, when the fix is thirty
 * seconds in token settings. Classic tokens report their scopes in a response
 * header, so when they are present the answer can be exact.
 */
async function writeError(res: Response, repo: string): Promise<string> {
  const body = await res.text().catch(() => "");

  if (res.status === 403 || res.status === 404) {
    const scopes = res.headers.get("x-oauth-scopes");

    // The header exists only on classic tokens. Its absence means fine-grained,
    // where permissions are per-repository rather than per-scope.
    if (scopes === null) {
      return `GitHub refused the write to ${repo}. This looks like a fine-grained token without write access: open the token's settings, give it "Contents: Read and write", and make sure ${repo} is in its repository list.`;
    }
    if (!/\brepo\b|public_repo/.test(scopes)) {
      return `GitHub refused the write to ${repo}. The token's scopes are "${scopes}" — none of which allow writing files. A classic token needs the "repo" scope.`;
    }
    return `GitHub refused the write to ${repo} (${res.status}) even though the token has "${scopes}". Check you have push access to that repo, and that it is not archived.`;
  }

  if (res.status === 401) return "GitHub rejected the token entirely — it may have expired or been revoked.";
  if (res.status === 409) return `A conflicting change landed in ${repo} first. Try again.`;
  return `GitHub ${res.status}: ${body.slice(0, 200)}`;
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
      if (res.status === 422) return { ok: false, error: `GitHub rejected that name — ${name} may already exist.` };
      if (res.status === 403 || res.status === 404) {
        const scopes = res.headers.get("x-oauth-scopes");
        return {
          ok: false,
          error: scopes === null
            ? "That token cannot create repositories. Fine-grained tokens need the account-level \"Administration: Read and write\" permission; a classic token needs \"repo\"."
            : `The token's scopes are "${scopes}", which don't allow creating repositories. A classic token needs "repo".`,
        };
      }
      return { ok: false, error: `GitHub ${res.status}: ${(await res.text()).slice(0, 160)}` };
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

export interface TokenCheck {
  ok: boolean;
  login: string | null;
  /** Classic-token scopes, when GitHub reports them. Null for fine-grained. */
  scopes: string | null;
  kind: "classic" | "fine-grained" | "unknown";
  canWrite: boolean | null;
  note: string;
}

/**
 * What this token can actually do.
 *
 * Worth answering before he writes a solution rather than after: discovering
 * the token is read-only at the moment you press Push means the code is
 * sitting in a textarea with nowhere to go.
 *
 * Write access cannot be tested without writing something, so this reports
 * what GitHub says about the token and stops short of claiming certainty it
 * does not have.
 */
export async function checkToken(): Promise<TokenCheck> {
  const base: TokenCheck = { ok: false, login: null, scopes: null, kind: "unknown", canWrite: null, note: "" };
  if (!process.env.GITHUB_TOKEN) {
    return { ...base, note: "No GITHUB_TOKEN set." };
  }

  try {
    const res = await proxyFetch(`${API}/user`, { headers: headers(), signal: AbortSignal.timeout(9000) });
    if (!res.ok) {
      return { ...base, note: res.status === 401 ? "GitHub rejected the token — expired or revoked." : `GitHub ${res.status}.` };
    }

    const login = ((await res.json()) as { login?: string }).login ?? null;
    const scopes = res.headers.get("x-oauth-scopes");

    // Only classic tokens carry this header; fine-grained ones grant
    // per-repository permissions that no endpoint enumerates.
    if (scopes === null) {
      return {
        ok: true, login, scopes: null, kind: "fine-grained", canWrite: null,
        note: "Fine-grained token. It needs \"Contents: Read and write\" on the repositories you push to — GitHub doesn't expose which ones it has, so a failed push is the only way to find out.",
      };
    }

    const canWrite = /\brepo\b|public_repo/.test(scopes);
    return {
      ok: true, login, scopes, kind: "classic", canWrite,
      note: canWrite
        ? "Classic token with write access."
        : `Classic token, scopes "${scopes || "none"}" — read-only. Add the "repo" scope to push.`,
    };
  } catch (e) {
    return { ...base, note: (e as Error).message };
  }
}
