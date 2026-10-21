"use client";

/**
 * What SAGE wants to do.
 *
 * This is the whole of v2 in one pane. Everything else on the wall answers
 * a question and stops; this one proposes work and then does it. The design
 * rules it follows are the ones that decide whether an assistant gets
 * trusted or turned off:
 *
 *  · Every row says WHY, not just what. A proposal you can only accept on
 *    faith is one you will eventually stop reading.
 *  · Approve and dismiss are the same size. An interface that makes "yes"
 *    easy and "no" fiddly is not asking, it is nagging.
 *  · What it has already done is visible in the same pane, with an undo —
 *    the record is how trust is earned, so it does not get its own screen
 *    nobody opens.
 *  · Anything that leaves the machine says so and can never be automatic;
 *    the toggle for those kinds is not rendered at all, and the route
 *    refuses it too.
 */

import { useCallback, useState } from "react";
import Link from "next/link";
import { Pane, Empty } from "@/components/pane";
import { useLive } from "@/lib/live";
import { asArray } from "@/lib/as-array";
import { sound } from "@/lib/sound";
import { Check, X, Undo2, Loader2, ShieldAlert } from "lucide-react";

interface Proposal {
  id: string; kind: string; title: string; why: string;
  status: "proposed" | "done" | "dismissed" | "failed";
  createdAt: string; decidedAt?: string; error?: string; auto?: boolean;
  result?: { label: string; href?: string };
}
interface KindInfo { label: string; reversible: boolean; outward: boolean; autoEligible: boolean }
interface Data {
  open: Proposal[]; recent: Proposal[];
  settings: { auto: Record<string, boolean> };
  kinds: Record<string, KindInfo>;
}

const ago = (iso?: string) => {
  if (!iso) return "";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (!Number.isFinite(m)) return "";
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
};

export function Docket({ n }: { n?: number }) {
  const [d, setD] = useState<Data | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const pull = useCallback(
    () => fetch("/api/agency").then((r) => r.json())
      .then((j) => { if (j?.ok) setD(j.data as Data); })
      .catch(() => {}),
    [],
  );
  useLive(pull, { everyMs: 120_000 });

  const act = async (id: string, action: "approve" | "dismiss" | "undo") => {
    setBusy(id); setNote(null);
    try {
      const j = await fetch("/api/agency", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, id }),
      }).then((r) => r.json());
      // A failure here is shown, not swallowed. "It didn't work and I am not
      // telling you" is the single fastest way to lose the trust this pane
      // exists to build.
      if (!j?.ok) setNote(j?.error ?? "That did not work.");
      else sound.blip();
      await pull();
    } catch {
      setNote("That did not work.");
    } finally {
      setBusy(null);
    }
  };

  const toggleAuto = async (kind: string, on: boolean) => {
    await fetch("/api/agency", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "auto", kind, on }),
    }).catch(() => {});
    sound.detent();
    await pull();
  };

  const scan = async () => {
    setBusy("scan"); setNote(null);
    await fetch("/api/agency", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "scan" }),
    }).catch(() => {});
    await pull();
    setBusy(null);
  };

  const open = asArray<Proposal>(d?.open);
  const recent = asArray<Proposal>(d?.recent);
  const kinds = d?.kinds ?? {};

  return (
    <Pane
      n={n}
      title="What SAGE wants to do"
      status={
        <button className="dk-scan" onClick={() => void scan()} disabled={busy === "scan"}>
          {busy === "scan" ? "LOOKING…" : open.length ? `${open.length} WAITING` : "LOOK NOW"}
        </button>
      }
      live={open.length > 0}
      alert={open.length > 0 ? "signal" : undefined}
    >
      {note && <div className="dk-note">{note}</div>}

      {!d && <div className="tile-wait">READING THE DOCKET…</div>}

      {d && !open.length && !recent.length && (
        <Empty reason="Nothing to propose yet. SAGE looks every half hour — or press LOOK NOW." />
      )}

      {open.map((p) => {
        const k = kinds[p.kind];
        return (
          <div className="dk-row" key={p.id}>
            <div className="dk-main">
              <div className="dk-t">
                {p.title}
                {k?.outward && (
                  <span className="dk-out" title="Leaves this machine — always approved by hand">
                    <ShieldAlert className="size-3" /> OUTWARD
                  </span>
                )}
              </div>
              {/* The reason is not small print. It is the thing being judged. */}
              <div className="dk-why">{p.why}</div>
            </div>
            <div className="dk-acts">
              <button
                className="dk-yes" disabled={busy === p.id}
                onClick={() => void act(p.id, "approve")} aria-label={`Do it: ${p.title}`}
              >
                {busy === p.id ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
              </button>
              <button
                className="dk-no" disabled={busy === p.id}
                onClick={() => void act(p.id, "dismiss")} aria-label={`No: ${p.title}`}
              >
                <X className="size-3" />
              </button>
            </div>
          </div>
        );
      })}

      {recent.length > 0 && (
        <div className="dk-done">
          <div className="dk-h">Already done</div>
          {recent.map((p) => (
            <div className={`dk-drow is-${p.status}`} key={p.id}>
              <span className="dk-dt">
                {p.result?.href
                  ? <Link href={p.result.href}>{p.result?.label ?? p.title}</Link>
                  : (p.result?.label ?? p.title)}
                {p.auto && <i className="dk-auto" title="Ran under standing permission">AUTO</i>}
                {p.status === "failed" && <i className="dk-fail">{p.error ?? "failed"}</i>}
                {p.status === "dismissed" && <i className="dk-dis">no</i>}
              </span>
              <span className="dk-when num">{ago(p.decidedAt ?? p.createdAt)}</span>
              {p.status === "done" && kinds[p.kind]?.reversible && (
                <button className="dk-undo" onClick={() => void act(p.id, "undo")} disabled={busy === p.id}>
                  <Undo2 className="size-3" /> UNDO
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {d && (
        <div className="dk-perms">
          <div className="dk-h">Standing permission</div>
          {/*
            Only the kinds that could ever be automatic are listed. An
            outward kind with a greyed-out switch invites "why not?", and the
            answer — never, by design — is better expressed by the switch not
            existing.
          */}
          {Object.entries(kinds).filter(([, k]) => k.autoEligible).map(([kind, k]) => (
            <label className="dk-perm" key={kind}>
              <input
                type="checkbox"
                checked={d.settings.auto[kind] === true}
                onChange={(e) => void toggleAuto(kind, e.target.checked)}
              />
              <span>{k.label} without asking</span>
            </label>
          ))}
        </div>
      )}
    </Pane>
  );
}
