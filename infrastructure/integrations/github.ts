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
