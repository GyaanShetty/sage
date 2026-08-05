"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Database, Download, KeyRound, Loader2, RefreshCw, ShieldCheck, Trash2, Upload, Zap } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { cn } from "@/lib/utils";

/**
 * Two questions that previously had no answer short of reading logs: how much
 * AI headroom is left today, and when the data was last copied somewhere that
 * survives this database.
 *
 * The backup half is allowed to shout when it is stale. Everything else in
 * SAGE degrades gracefully — a missed brief is a missed brief — but losing the
 * database is the one failure with nothing behind it.
 */

interface Key { index: number; tail: string; healthy: boolean; cooldownSeconds: number; inUse: boolean; strikes: number }
interface Day { day: string; calls: number; failures: number }
interface Backup { takenAt: string; rows: number; url: string | null; ageDays: number }
interface Vitals {
  keys: Key[];
  models: { tier: string; using: string }[];
  healthyKeys: number;
  usage: Day[];
  backup: Backup | null;
  backupConfigured: boolean;
}

const btn =
  "flex items-center gap-1.5 border border-border-glass px-3 py-1 text-xs text-muted transition-colors hover:border-border-glass-strong hover:text-foreground disabled:opacity-40";

export function Vitals() {
  const [v, setV] = useState<Vitals | null>(null);
  const [busy, setBusy] = useState<"backup" | "restore" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const j = await fetch("/api/vitals").then((r) => r.json()).catch(() => null);
    if (j?.ok) setV(j.data as Vitals);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const backupNow = async () => {
    setBusy("backup"); setNote(null);
    const j = await fetch("/api/backup", { method: "POST" }).then((r) => r.json()).catch(() => null);
    setBusy(null);
    setNote(j?.ok ? `Backed up ${Number(j.data.rows).toLocaleString()} rows.` : j?.error ?? "That backup failed.");
    void load();
  };

  const restore = async (file: File) => {
    setBusy("restore"); setNote(null);
    const body = new FormData();
    body.append("file", file);
    const j = await fetch("/api/backup", { method: "POST", body }).then((r) => r.json()).catch(() => null);
    setBusy(null);
    const total = j?.ok
      ? Object.values(j.data.restored as Record<string, number>).reduce((a, n) => a + n, 0)
      : 0;
    setNote(j?.ok ? `Restored ${total.toLocaleString()} rows.` : j?.error ?? "That restore failed.");
    void load();
  };

  if (!v) return null;

  const today = v.usage[0];
  const peak = Math.max(...v.usage.map((d) => d.calls), 1);
  const stale = !v.backup || v.backup.ageDays >= 8;

  return (
    <GlassPanel className="mt-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex items-center gap-2 text-sm font-medium"><Zap className="size-3.5" /> Vitals</p>
        <span className="text-xs text-subtle">
          {v.keys.length === 0
            ? "no AI keys configured"
            : `${v.healthyKeys} of ${v.keys.length} keys healthy`}
          {today && ` · ${today.calls.toLocaleString()} calls today`}
          {today && today.failures > 0 && ` · ${today.failures} failed`}
        </span>
        <button onClick={() => void load()} className={cn(btn, "ml-auto")}>
          <RefreshCw className="size-3" /> Refresh
        </button>
      </div>

      {/* ── AI headroom ──────────────────────────────────────────────────── */}
      {v.keys.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {v.keys.map((k) => (
            <span
              key={k.index}
              title={
                k.healthy
                  ? k.inUse
                    ? "In use — spent before the next one is taken up"
                    : "Healthy, held in reserve"
                  : `Refused on quota. Back in ${Math.ceil(k.cooldownSeconds / 60)} min.`
              }
              className={cn(
                "flex items-center gap-1 border px-2 py-0.5 font-mono text-[10px]",
                k.healthy ? "border-border-glass text-muted" : "border-border-glass text-subtle opacity-60",
                k.inUse && "border-[var(--live-dim)] text-[var(--live)]",
              )}
            >
              {k.tail}
              {k.inUse && <b className="font-normal">· in use</b>}
              {!k.healthy && <i className="not-italic">· {Math.ceil(k.cooldownSeconds / 60)}m</i>}
            </span>
          ))}
        </div>
      )}

      {v.usage.length > 1 && (
        <div className="mt-3 flex h-10 items-end gap-[3px]">
          {[...v.usage].reverse().map((d) => (
            <div
              key={d.day}
              title={`${d.day}: ${d.calls} calls${d.failures ? `, ${d.failures} failed` : ""}`}
              className="min-w-[3px] flex-1 bg-[var(--live)] opacity-70 transition-opacity hover:opacity-100"
              style={{ height: `${Math.max(4, (d.calls / peak) * 100)}%` }}
            />
          ))}
        </div>
      )}

      <p className="mt-2 text-[10px] text-subtle">
        Keys are spent one at a time — the marked one is in use, the rest are held back. A key
        on cooldown refused on quota and returns by itself. If SAGE goes quiet, this is where
        &ldquo;out of quota&rdquo; and &ldquo;broken&rdquo; stop looking the same.
      </p>

      <ManagedKeys onChanged={load} />

      {/* ── The data itself ──────────────────────────────────────────────── */}
      <div className="mt-4 border-t border-border-glass pt-3">
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex items-center gap-2 text-sm font-medium"><Database className="size-3.5" /> Backup</p>
          <span className={cn("text-xs", stale ? "text-amber-300" : "text-subtle")}>
            {v.backup
              ? v.backup.ageDays === 0
                ? `taken today · ${v.backup.rows.toLocaleString()} rows`
                : `${v.backup.ageDays}d ago · ${v.backup.rows.toLocaleString()} rows`
              : "never taken"}
          </span>
        </div>

        {stale && (
          <p className="mt-2 flex items-start gap-2 text-[11px] text-amber-300/90">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" />
            {v.backupConfigured
              ? "Nothing has been copied off this database recently. Everything in SAGE lives in one Supabase project with no point-in-time recovery — if it goes, it goes."
              : "BACKUP_REPO isn't set, so nothing is stored off-site. Point it at a private owner/repo and SAGE backs up weekly on its own. Until then, Download works with no setup at all."}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={backupNow} disabled={busy !== null} className={btn}>
            {busy === "backup" ? <Loader2 className="size-3 animate-spin" /> : <ShieldCheck className="size-3" />} Back up now
          </button>
          <a href="/api/backup?download=1" className={btn}>
            <Download className="size-3" /> Download
          </a>
          <input
            ref={fileRef} type="file" accept="application/json,.json" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void restore(f); }}
          />
          <button onClick={() => fileRef.current?.click()} disabled={busy !== null} className={btn}>
            {busy === "restore" ? <Loader2 className="size-3 animate-spin" /> : <Upload className="size-3" />} Restore
          </button>
          {v.backup?.url && (
            <a href={v.backup.url} target="_blank" rel="noreferrer" className="text-[11px] text-[var(--live)]">
              latest copy →
            </a>
          )}
        </div>

        {note && <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted"><Check className="size-3" /> {note}</p>}

        <p className="mt-2 text-[10px] text-subtle">
          A restore only adds and updates rows — it never deletes, so recovering last week
          cannot cost you this week.
        </p>
      </div>
    </GlassPanel>
  );
}

interface ManagedKey { id: string; provider: string; tail: string; label: string | null; readable: boolean }

/**
 * Adding a key without opening the Vercel dashboard.
 *
 * The old answer to "the AI stopped working" was: edit an environment
 * variable, trigger a redeploy, wait for it. Keys added here are picked up on
 * the next model call. They are encrypted at rest under a secret that is not
 * in the database, which matters more now that a copy of that database leaves
 * for GitHub every night.
 *
 * Keys are never readable back — only their last four. A page that could show
 * you a key would turn one leaked session into a leaked Google account.
 */
function ManagedKeys({ onChanged }: { onChanged: () => void }) {
  const [keys, setKeys] = useState<ManagedKey[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [value, setValue] = useState("");
  const [provider, setProvider] = useState("google");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const j = await fetch("/api/keys").then((r) => r.json()).catch(() => null);
    if (j?.ok) { setKeys(j.data.keys); setAvailable(j.data.storageAvailable); }
  }, []);
  useEffect(() => { if (open) void load(); }, [open, load]);

  const add = async () => {
    if (!value.trim() || busy) return;
    setBusy(true); setNote(null);
    const j = await fetch("/api/keys", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, key: value.trim() }),
    }).then((r) => r.json()).catch(() => null);
    setBusy(false);
    if (j?.ok) {
      setKeys(j.data.keys); setValue("");
      setNote(`Added …${j.data.tail}. It's live now — no redeploy.`);
      onChanged();
    } else setNote(j?.error ?? "That key wouldn't save.");
  };

  const remove = async (id: string) => {
    const j = await fetch(`/api/keys?id=${id}`, { method: "DELETE" }).then((r) => r.json()).catch(() => null);
    if (j?.ok) { setKeys(j.data.keys); onChanged(); }
  };

  return (
    <div className="mt-3">
      <button onClick={() => setOpen((s) => !s)} className="flex items-center gap-1.5 text-[11px] text-[var(--live)]">
        <KeyRound className="size-3" /> {open ? "Hide key management" : "Add or replace a key"}
      </button>

      {open && (
        <div className="mt-2 border-l-2 border-border-glass pl-3">
          {!available && (
            <p className="mb-2 flex items-start gap-2 text-[11px] text-amber-300/90">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              Set <code className="font-mono">KEY_SECRET</code> in the environment first. SAGE
              won&apos;t store a key it can&apos;t encrypt, and that secret has to live outside
              the database it protects.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <select
              value={provider} onChange={(e) => setProvider(e.target.value)}
              className="border border-border-glass bg-glass px-2 py-1.5 text-[12px] text-foreground outline-none"
            >
              <option value="google">Gemini</option>
              <option value="tavily">Tavily</option>
              <option value="hevy">Hevy</option>
              <option value="alphavantage">Alpha Vantage</option>
            </select>
            <input
              type="password" value={value} onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void add()}
              placeholder="Paste the key"
              autoComplete="off" spellCheck={false}
              className="min-w-0 flex-1 border border-border-glass bg-glass px-3 py-1.5 font-mono text-[12px] text-foreground outline-none focus:border-[var(--live-dim)]"
            />
            <button onClick={() => void add()} disabled={busy || !value.trim() || !available} className={btn}>
              {busy ? <Loader2 className="size-3 animate-spin" /> : <KeyRound className="size-3" />} Add
            </button>
          </div>

          {note && <p className="mt-2 text-[11px] text-muted">{note}</p>}

          {keys && keys.length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              {keys.map((k) => (
                <div key={k.id} className="flex items-center gap-3 text-[11px]">
                  <span className="font-mono text-subtle">{k.provider}</span>
                  <span className="font-mono text-muted">…{k.tail}</span>
                  {!k.readable && (
                    <span className="text-amber-300" title="KEY_SECRET has changed since this was stored, so it can no longer be decrypted.">
                      unreadable
                    </span>
                  )}
                  <button onClick={() => void remove(k.id)} className="ml-auto text-subtle hover:text-foreground" title="Remove">
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <p className="mt-2 text-[10px] text-subtle">
            Stored encrypted and never shown again — only the last four. Environment variables
            still work and are used first; this is for replacing a spent key without a deploy.
          </p>
        </div>
      )}
    </div>
  );
}
