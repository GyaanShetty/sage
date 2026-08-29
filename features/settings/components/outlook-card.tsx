"use client";

import { useCallback, useEffect, useState } from "react";
import { Mail, Loader2 } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";

/**
 * Outlook.
 *
 * The states are kept distinct on purpose. "Not connected", "connected", and
 * "credentials missing" are three different problems with three different
 * fixes, and collapsing them into one greyed-out button is what makes an
 * integration feel broken rather than unconfigured. When a credential is
 * missing this says *which* one.
 *
 * The registered redirect URI is shown too. A mismatch fails with AADSTS50011,
 * which names nothing useful — seeing the exact string SAGE will send turns a
 * hunt through the Azure portal into a two-second comparison.
 */

interface Status {
  hasId: boolean;
  hasSecret: boolean;
  connected: boolean;
  identity: string | null;
  redirectUri: string;
}

export function OutlookCard() {
  const [s, setS] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const j = await fetch("/api/outlook").then((r) => r.json()).catch(() => null);
    if (j?.ok) setS(j.data);
  }, []);
  useEffect(() => { void load(); }, [load]);

  // The callback redirects back with ?outlook=… — success or Microsoft's own
  // error text, which is always more useful than a message we could invent.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("outlook");
    if (!p) return;
    setNote(p === "connected" ? "Connected." : p);
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  const connect = async () => {
    setBusy(true); setNote(null);
    const j = await fetch("/api/outlook", { method: "POST" }).then((r) => r.json()).catch(() => null);
    setBusy(false);
    if (j?.ok && j.data?.url) window.location.href = j.data.url;
    else setNote(j?.error ?? "Couldn't start sign-in.");
  };

  const disconnect = async () => {
    await fetch("/api/integrations/disconnect", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "outlook" }),
    }).catch(() => {});
    setNote("Disconnected.");
    void load();
  };

  const missing = s && (!s.hasId || !s.hasSecret);

  return (
    <GlassPanel className="mt-3 flex items-center gap-4 p-5">
      <Mail className="size-5 text-muted" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Outlook</p>
        <p className="text-xs text-subtle">
          {s?.connected && s.identity
            ? `Connected as ${s.identity}. Internship mail, forms and deadlines reach the morning brief and Career.`
            : missing
              ? `Add the ${!s?.hasId && !s?.hasSecret ? "client ID and client secret" : !s?.hasId ? "client ID" : "client secret"} under “Add or replace a key” below.`
              : "Reads your mail (read-only) so internship links, forms and deadlines stop getting lost."}
        </p>
        {s && !s.connected && !missing && (
          <p className="mt-1 font-mono text-[10px] text-subtle">
            Redirect URI must be registered in Azure: {s.redirectUri}
          </p>
        )}
        {note && <p className="mt-1 text-[11px] text-muted">{note}</p>}
      </div>

      {s?.connected ? (
        <button onClick={() => void disconnect()} className="border border-[var(--rule)] px-3 py-1.5 text-xs text-muted hover:text-foreground">
          Disconnect
        </button>
      ) : (
        <button
          onClick={() => void connect()}
          disabled={busy || !!missing}
          className="flex items-center gap-1.5 bg-accent px-3.5 py-1.5 text-xs font-medium text-background disabled:opacity-40"
        >
          {busy && <Loader2 className="size-3 animate-spin" />} Connect
        </button>
      )}
    </GlassPanel>
  );
}
