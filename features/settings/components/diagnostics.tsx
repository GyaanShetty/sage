"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Database, Loader2, Sparkles, Trash2 } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";

/**
 * What SAGE knows about its own failures.
 *
 * The self-building ask ends here on purpose: errors are captured, grouped and
 * diagnosed automatically, and the proposed fix is shown to you rather than
 * applied. A patch loop with no reviewer cannot tell a fix from a plausible
 * regression, and this repo deploys straight to production.
 */

interface Triage {
  diagnosis: string;
  likelyFiles: string[];
  fix: string;
  confidence: "high" | "medium" | "low";
  severity: "breaks-feature" | "degrades" | "cosmetic" | "noise";
}
interface Row {
  fingerprint: string;
  message: string;
  where: string;
  side: string;
  count: number;
  lastSeen: string;
  triage: Triage | null;
}

const SEVERITY: Record<Triage["severity"], string> = {
  "breaks-feature": "text-red-300",
  degrades: "text-amber-300",
  cosmetic: "text-subtle",
  noise: "text-subtle",
};

interface Storage {
  breakdown: { type: string; rows: number; retention: string }[];
  totalRows: number;
  prunable: number;
}

/**
 * What is filling the database.
 *
 * Almost everything in SAGE lands in one generic Event table and nothing ever
 * deleted from it. On a 500MB free tier that matters, and the rows that grow
 * fastest are the least valuable — dedupe markers, cached briefs, "already
 * pushed today" flags. Retention is per-type and conservative; your own
 * records are never touched.
 */
function StorageCard() {
  const [s, setS] = useState<Storage | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const j = await fetch("/api/ops?storage=1").then((r) => r.json()).catch(() => null);
    setS(j?.ok ? (j.data as Storage) : null);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const prune = async () => {
    setBusy(true);
    await fetch("/api/ops", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "prune" }),
    }).catch(() => null);
    setBusy(false);
    await load();
  };

  if (!s) return null;

  return (
    <div className="mt-4 border-t border-border-glass pt-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Database className="size-3.5" /> Storage
        </p>
        <span className="text-xs text-subtle">
          {s.totalRows.toLocaleString()} rows
          {s.prunable > 0 && ` · ${s.prunable.toLocaleString()} past retention`}
        </span>
        {s.prunable > 0 && (
          <button
            onClick={prune}
            disabled={busy}
            className="ml-auto flex items-center gap-1.5 border border-border-glass px-3 py-1 text-xs text-muted transition-colors hover:border-border-glass-strong hover:text-foreground disabled:opacity-40"
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />} Clean up
          </button>
        )}
      </div>

      <div className="mt-2 flex flex-col gap-0.5">
        {s.breakdown.slice(0, 8).map((row) => (
          <div key={row.type} className="flex items-baseline gap-3 text-[11px]">
            <span className="min-w-0 flex-1 truncate font-mono text-subtle">{row.type}</span>
            <span className="font-mono text-muted">{row.rows.toLocaleString()}</span>
            <span className="w-10 text-right font-mono text-[9px] uppercase text-subtle">{row.retention}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-subtle">
        &ldquo;kept&rdquo; means never deleted — your holdings, workouts, applications and notes.
        The rest is bookkeeping and regenerable content, cleared automatically each night.
      </p>
    </div>
  );
}

export function Diagnostics() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const j = await fetch("/api/ops").then((r) => r.json()).catch(() => null);
    setRows(j?.ok ? (j.data as Row[]) : []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const triage = async () => {
    setBusy(true);
    await fetch("/api/ops", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "triage" }),
    }).catch(() => null);
    setBusy(false);
    await load();
  };

  const resolve = async (fp: string) => {
    setRows((r) => r?.filter((x) => x.fingerprint !== fp) ?? null);
    await fetch(`/api/ops?fingerprint=${encodeURIComponent(fp)}`, { method: "DELETE" }).catch(() => null);
  };

  const untriaged = (rows ?? []).some((r) => !r.triage);

  return (
    <GlassPanel className="mt-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <AlertTriangle className="size-3.5" /> Diagnostics
        </p>
        <span className="text-xs text-subtle">
          {rows === null ? "…" : rows.length === 0 ? "Nothing broken that SAGE has seen." : `${rows.length} open`}
        </span>
        {untriaged && (
          <button
            onClick={triage}
            disabled={busy}
            className="ml-auto flex items-center gap-1.5 border border-border-glass px-3 py-1 text-xs text-muted transition-colors hover:border-border-glass-strong hover:text-foreground disabled:opacity-40"
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />} Diagnose
          </button>
        )}
      </div>

      {rows?.map((r) => (
        <div key={r.fingerprint} className="mt-3 border-t border-border-glass pt-3">
          <div className="flex items-start gap-3">
            <button
              onClick={() => setOpen(open === r.fingerprint ? null : r.fingerprint)}
              className="min-w-0 flex-1 text-left"
            >
              <p className="truncate text-xs text-muted">{r.message}</p>
              <p className="mt-0.5 font-mono text-[10px] text-subtle">
                {r.side} · {r.where} · {r.count}×
                {r.triage && (
                  <span className={SEVERITY[r.triage.severity]}> · {r.triage.severity} ({r.triage.confidence})</span>
                )}
              </p>
            </button>
            <button
              onClick={() => resolve(r.fingerprint)}
              title="Mark resolved — it comes back if the error does"
              className="text-subtle transition-colors hover:text-live"
            >
              <Check className="size-3.5" />
            </button>
          </div>

          {open === r.fingerprint && r.triage && (
            <div className="mt-2 border-l border-border-glass pl-3 text-xs text-subtle">
              <p className="text-muted">{r.triage.diagnosis}</p>
              <p className="mt-2">{r.triage.fix}</p>
              {r.triage.likelyFiles.length > 0 && (
                <p className="mt-2 font-mono text-[10px]">{r.triage.likelyFiles.join(" · ")}</p>
              )}
            </div>
          )}
          {open === r.fingerprint && !r.triage && (
            <p className="mt-2 pl-3 text-xs text-subtle">Not diagnosed yet.</p>
          )}
        </div>
      ))}

      <StorageCard />
    </GlassPanel>
  );
}
