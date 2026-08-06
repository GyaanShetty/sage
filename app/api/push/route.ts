import { NextResponse } from "next/server";
import {
  listWritableRepos, createRepo, listRepoPath, githubLogin, checkToken,
} from "@/infrastructure/integrations/github";
import {
  pushCode, recentPushes, getPushPrefs, setPushPrefs, LANGUAGES, type PushInput,
} from "@/core/coding/push";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

/**
 * Everything the push page needs, and the push itself.
 *
 * GET            — repos, remembered prefs, recent pushes, languages.
 * GET ?path=     — one directory of a repo, for browsing to a folder.
 * POST           — push a file.
 * POST create    — make a repo first.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const repo = url.searchParams.get("repo");
  const path = url.searchParams.get("path");

  if (repo && path !== null) {
    const entries = await listRepoPath(repo, path);
    if (entries === null) return NextResponse.json({ ok: false, error: "Couldn't read that folder." }, { status: 404 });
    return NextResponse.json({ ok: true, data: { entries } });
  }

  if (!process.env.GITHUB_TOKEN) {
    return NextResponse.json(
      { ok: false, error: "No GITHUB_TOKEN set. Add a token with repo scope and SAGE can push for you." },
      { status: 400 },
    );
  }

  const [repos, login, prefs, pushes, token] = await Promise.all([
    listWritableRepos().catch(() => []),
    githubLogin().catch(() => null),
    getPushPrefs().catch(() => null),
    recentPushes().catch(() => []),
    // Checked up front: finding out the token is read-only at the moment you
    // press Push means the solution is sitting in a textarea with nowhere to go.
    checkToken().catch(() => null),
  ]);

  return NextResponse.json({ ok: true, data: { repos, login, prefs, pushes, token, languages: LANGUAGES } });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as
    & Partial<PushInput>
    & { action?: "create-repo"; name?: string; private?: boolean; remember?: boolean };

  if (body.action === "create-repo") {
    if (!body.name?.trim()) return NextResponse.json({ ok: false, error: "name required" }, { status: 400 });
    const made = await createRepo(body.name.trim(), { priv: body.private !== false });
    if (!made.ok) return NextResponse.json({ ok: false, error: made.error }, { status: 400 });
    return NextResponse.json({ ok: true, data: { repo: made.repo, repos: await listWritableRepos().catch(() => []) } });
  }

  if (!body.repo || !body.fileName || !body.code) {
    return NextResponse.json({ ok: false, error: "repo, fileName and code are required" }, { status: 400 });
  }

  const result = await pushCode({
    repo: body.repo,
    folder: body.folder ?? "",
    fileName: body.fileName,
    code: body.code,
    language: body.language ?? "python3",
    header: body.header,
    message: body.message,
    overwrite: body.overwrite,
  });

  // Remembered only on success — there is no point learning a destination that
  // did not work.
  if (result.ok && body.remember !== false) {
    await setPushPrefs({
      repo: body.repo,
      folder: body.folder ?? "",
      language: body.language ?? "python3",
    }).catch(() => undefined);
  }

  const status = result.ok ? 200 : result.exists ? 409 : 400;
  return NextResponse.json({ ok: result.ok, data: result, ...(result.ok ? {} : { error: result.error }) }, { status });
}
