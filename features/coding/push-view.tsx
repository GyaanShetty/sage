"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Check, ChevronRight, FolderPlus, GitBranch, Boxes, Loader2,
  Plus, Terminal, Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import "./push.css";

/**
 * Filing a solution without leaving SAGE.
 *
 * A DSA repo is a good habit and a miserable ritual: solve it, open an editor,
 * remember the folder convention, guess the extension, write a commit message,
 * push. Six steps between having the answer and having it filed, which is why
 * so many of these repos stop in February.
 *
 * The destination is chosen once and remembered, so the second solution
 * onwards costs one button. Everything else on this page exists to make the
 * first one quick: repos listed rather than typed, folders browsed rather than
 * recalled, the file name derived from the problem title, and a header comment
 * written for you.
 */

interface Repo { full_name: string; private: boolean; language: string | null; pushed_at: string }
interface Language { key: string; label: string; ext: string }
interface PushRecord { repo: string; path: string; url: string; language: string; title: string; at: string }
interface Entry { path: string; type: "file" | "dir" }

const STARTER: Record<string, string> = {
  python3: "class Solution:\n    def solve(self):\n        pass\n",
  cpp: "class Solution {\npublic:\n    \n};\n",
  java: "class Solution {\n    \n}\n",
  javascript: "var solve = function () {\n};\n",
  typescript: "function solve(): void {\n}\n",
  golang: "func solve() {\n}\n",
  rust: "impl Solution {\n}\n",
};

/** Mirrors fileNameFor on the server, so the preview cannot disagree with it. */
function fileNameFor(title: string, ext: string): string {
  const t = title.trim();
  const numbered = /^(\d+)[.\s-]+(.*)$/.exec(t);
  const slug = (s: string) =>
    s.trim().toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 60).replace(/^-|-$/g, "");
  const base = numbered ? `${numbered[1].padStart(4, "0")}-${slug(numbered[2])}` : slug(t);
  return `${base || "solution"}.${ext}`;
}

export function PushView() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [langs, setLangs] = useState<Language[]>([]);
  const [login, setLogin] = useState<string | null>(null);
  const [pushes, setPushes] = useState<PushRecord[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [repo, setRepo] = useState("");
  const [folder, setFolder] = useState("");
  const [language, setLanguage] = useState("python3");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [complexity, setComplexity] = useState("");
  const [code, setCode] = useState("");
  const [manualName, setManualName] = useState("");

  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; url?: string } | null>(null);
  const [conflict, setConflict] = useState(false);
  const [newRepo, setNewRepo] = useState("");
  const [creating, setCreating] = useState(false);

  const ext = useMemo(() => langs.find((l) => l.key === language)?.ext ?? "txt", [langs, language]);
  const fileName = manualName.trim() || (title.trim() ? fileNameFor(title, ext) : `solution.${ext}`);
  const fullPath = [folder.replace(/^\/+|\/+$/g, ""), fileName].filter(Boolean).join("/");

  const load = useCallback(async () => {
    const j = await fetch("/api/push").then((r) => r.json()).catch(() => null);
    if (!j?.ok) { setLoadError(j?.error ?? "Couldn't reach GitHub."); return; }
    setLoadError(null);
    setRepos(j.data.repos); setLangs(j.data.languages); setLogin(j.data.login); setPushes(j.data.pushes);
    if (j.data.prefs) {
      setRepo((r) => r || j.data.prefs.repo);
      setFolder((f) => f || j.data.prefs.folder);
      setLanguage(j.data.prefs.language ?? "python3");
    } else if (j.data.repos[0]) {
      setRepo((r) => r || j.data.repos[0].full_name);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // A solution handed over from the Code Lab. Read once and cleared, so a
  // later visit to this page does not resurrect a problem already pushed.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("sage:push-draft");
      if (!raw) return;
      sessionStorage.removeItem("sage:push-draft");
      const d = JSON.parse(raw) as { title?: string; url?: string; code?: string; language?: string };
      if (d.title) setTitle(d.title);
      if (d.url) setUrl(d.url);
      if (d.code) setCode(d.code);
      if (d.language) setLanguage(d.language);
    } catch {
      // Nothing handed over, or unreadable. The page works from scratch.
    }
  }, []);

  // Starter code only when nothing has been typed — switching language must
  // never eat work in progress.
  useEffect(() => {
    setCode((c) => (c.trim() ? c : STARTER[language] ?? ""));
  }, [language]);

  const browse = async (path: string) => {
    if (!repo) return;
    setBrowsing(true);
    const j = await fetch(`/api/push?repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(path)}`)
      .then((r) => r.json()).catch(() => null);
    setBrowsing(false);
    setEntries(j?.ok ? j.data.entries.filter((e: Entry) => e.type === "dir") : []);
  };

  const push = async (overwrite = false) => {
    if (!repo || !code.trim() || busy) return;
    setBusy(true); setResult(null); setConflict(false);

    const res = await fetch("/api/push", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repo, folder, fileName, code, language, overwrite,
        header: {
          ...(title.trim() ? { title: title.trim() } : {}),
          ...(url.trim() ? { url: url.trim() } : {}),
          ...(complexity.trim() ? { complexity: complexity.trim() } : {}),
        },
        message: title.trim() ? `Add ${title.trim()}` : `Add ${fileName}`,
      }),
    });
    const j = await res.json().catch(() => null);
    setBusy(false);

    if (j?.ok) {
      setResult({ ok: true, text: `Pushed ${j.data.path}`, url: j.data.url });
      setPushes((p) => [{ repo, path: j.data.path, url: j.data.url, language, title: title || fileName, at: new Date().toISOString() }, ...p]);
      // Cleared for the next problem; the destination deliberately stays.
      setTitle(""); setUrl(""); setComplexity(""); setCode(""); setManualName("");
    } else {
      setResult({ ok: false, text: j?.error ?? "That push failed." });
      if (res.status === 409) setConflict(true);
    }
  };

  const create = async () => {
    if (!newRepo.trim() || creating) return;
    setCreating(true);
    const j = await fetch("/api/push", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "create-repo", name: newRepo.trim(), private: true }),
    }).then((r) => r.json()).catch(() => null);
    setCreating(false);
    if (j?.ok) { setRepos(j.data.repos); setRepo(j.data.repo); setNewRepo(""); setResult({ ok: true, text: `Created ${j.data.repo}` }); }
    else setResult({ ok: false, text: j?.error ?? "Couldn't create that repo." });
  };

  return (
    <div className="pu-wrap">
      <div className="cc-head">
        <div className="sectitle" style={{ marginBottom: 0 }}>
          <span className="sn"><Terminal className="size-3.5" /></span>
          <h2>Push</h2><span className="line" />
          {login && <span className="tag">@{login}</span>}
        </div>
      </div>

      {loadError && (
        <div className="pu-card">
          <p className="pu-err"><AlertTriangle className="inline size-3.5" /> {loadError}</p>
          <button onClick={load} className="pu-link">Retry →</button>
        </div>
      )}

      {!loadError && (
        <>
          {/* ── destination ─────────────────────────────────────────────── */}
          <div className="pu-card">
            <div className="pu-cardhead"><Boxes className="size-3.5" /><h3>DESTINATION</h3>
              <span className="pu-avg">remembered between pushes</span>
            </div>

            <div className="pu-row">
              <label className="pu-field pu-grow">
                <span>Repository</span>
                <select value={repo} onChange={(e) => { setRepo(e.target.value); setEntries(null); }}>
                  {repos.length === 0 && <option value="">No repos found</option>}
                  {repos.map((r) => (
                    <option key={r.full_name} value={r.full_name}>
                      {r.full_name}{r.private ? " · private" : ""}
                    </option>
                  ))}
                </select>
              </label>

              <label className="pu-field pu-grow">
                <span>Folder — nested is fine, created if missing</span>
                <input
                  value={folder} onChange={(e) => setFolder(e.target.value)}
                  placeholder="arrays/two-pointers"
                />
              </label>

              <button onClick={() => { setEntries(null); void browse(folder); }} disabled={!repo || browsing} className="pu-btn">
                {browsing ? <Loader2 className="size-3 animate-spin" /> : <FolderPlus className="size-3" />} Browse
              </button>
            </div>

            {entries && (
              <div className="pu-browse">
                {folder && (
                  <button
                    className="pu-crumb"
                    onClick={() => {
                      const up = folder.split("/").slice(0, -1).join("/");
                      setFolder(up); void browse(up);
                    }}
                  >
                    ← up
                  </button>
                )}
                {entries.length === 0 && <span className="pu-dim">No sub-folders here.</span>}
                {entries.map((e) => (
                  <button key={e.path} className="pu-crumb" onClick={() => { setFolder(e.path); void browse(e.path); }}>
                    <ChevronRight className="size-3" /> {e.path.split("/").pop()}
                  </button>
                ))}
              </div>
            )}

            <div className="pu-row pu-newrepo">
              <input
                value={newRepo} onChange={(e) => setNewRepo(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void create()}
                placeholder="…or create a new private repo — name it here"
              />
              <button onClick={() => void create()} disabled={!newRepo.trim() || creating} className="pu-btn">
                {creating ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />} Create
              </button>
            </div>
          </div>

          {/* ── the solution ────────────────────────────────────────────── */}
          <div className="pu-card">
            <div className="pu-cardhead"><GitBranch className="size-3.5" /><h3>SOLUTION</h3>
              <span className="pu-avg pu-path">{repo ? `${repo}/${fullPath}` : fullPath}</span>
            </div>

            <div className="pu-row">
              <label className="pu-field pu-grow">
                <span>Problem — the file name comes from this</span>
                <input
                  value={title} onChange={(e) => setTitle(e.target.value)}
                  placeholder="1. Two Sum"
                />
              </label>
              <label className="pu-field">
                <span>Language</span>
                <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                  {langs.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
                </select>
              </label>
            </div>

            <div className="pu-row">
              <label className="pu-field pu-grow">
                <span>Link (optional)</span>
                <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://leetcode.com/problems/two-sum/" />
              </label>
              <label className="pu-field">
                <span>Complexity (optional)</span>
                <input value={complexity} onChange={(e) => setComplexity(e.target.value)} placeholder="O(n) time, O(n) space" />
              </label>
              <label className="pu-field">
                <span>File name</span>
                <input value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder={fileName} />
              </label>
            </div>

            <textarea
              value={code} onChange={(e) => setCode(e.target.value)}
              spellCheck={false}
              placeholder="Paste or write the solution…"
              className="pu-code"
              rows={16}
              onKeyDown={(e) => {
                // Tab indents rather than leaving the editor — the default
                // behaviour makes a code box unusable.
                if (e.key === "Tab") {
                  e.preventDefault();
                  const el = e.currentTarget;
                  const { selectionStart: s, selectionEnd: t } = el;
                  const next = `${code.slice(0, s)}    ${code.slice(t)}`;
                  setCode(next);
                  requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 4; });
                }
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void push();
              }}
            />

            <div className="pu-actions">
              <button onClick={() => void push()} disabled={busy || !repo || !code.trim()} className="cc-btn cc-scan">
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />} Push to GitHub
              </button>
              <span className="pu-dim">⌘/Ctrl + Enter</span>
              {result && (
                <span className={cn("pu-result", result.ok ? "ok" : "bad")}>
                  {result.ok ? <Check className="size-3" /> : <AlertTriangle className="size-3" />}
                  {result.text}
                  {result.url && <a href={result.url} target="_blank" rel="noreferrer" className="pu-link">view →</a>}
                </span>
              )}
            </div>

            {conflict && (
              <p className="pu-conflict">
                A file is already at that path. Overwriting it replaces what is there —
                the old version stays in the repo&apos;s history, but the file will be yours.
                <button onClick={() => void push(true)} className="pu-link">Overwrite it →</button>
              </p>
            )}
          </div>

          {/* ── history ─────────────────────────────────────────────────── */}
          {pushes.length > 0 && (
            <div className="pu-card">
              <div className="pu-cardhead"><Check className="size-3.5" /><h3>PUSHED</h3><span className="pu-avg">{pushes.length}</span></div>
              <div className="pu-list">
                {pushes.slice(0, 15).map((p, i) => (
                  <a key={`${p.path}-${i}`} href={p.url} target="_blank" rel="noreferrer" className="pu-item">
                    <span className="pu-itemtitle">{p.title}</span>
                    <span className="pu-itempath">{p.repo}/{p.path}</span>
                    <span className="pu-itemdate">
                      {new Date(p.at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
