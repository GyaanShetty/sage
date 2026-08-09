"use client";

import { useCallback, useEffect, useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { Fingerprint, Loader2, Trash2, ShieldCheck } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";

interface KeyRow { label: string; at: string; lastUsedAt: string | null; ref: string }

/**
 * Register this device's biometric as a way in.
 *
 * The private key is generated inside the phone or laptop's secure element and
 * never leaves it — SAGE only ever stores the public half, which is useless to
 * anyone who steals it. And because the browser binds the credential to this
 * exact origin, a convincing copy of the login page cannot ask for it: the
 * phishing route simply is not available, which is more than a password can
 * say however long it is.
 */
export function Passkeys() {
  const [keys, setKeys] = useState<KeyRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    setSupported(typeof window !== "undefined" && !!window.PublicKeyCredential);
  }, []);

  const load = useCallback(async () => {
    try {
      const j = await fetch("/api/auth/passkey").then((r) => r.json());
      setKeys(j?.ok ? (j.data.keys as KeyRow[]) : []);
    } catch {
      setKeys([]);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const opt = await fetch("/api/auth/passkey/register").then((r) => r.json());
      if (!opt?.ok) { setMsg(opt?.error ?? "Couldn't start registration."); return; }

      const attestation = await startRegistration({ optionsJSON: opt.data });

      const label =
        /iPhone|iPad/i.test(navigator.userAgent) ? "iPhone"
          : /Macintosh/i.test(navigator.userAgent) ? "Mac"
            : /Android/i.test(navigator.userAgent) ? "Android"
              : "This device";

      const res = await fetch("/api/auth/passkey/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ response: attestation, label }),
      });
      const j = await res.json().catch(() => null);
      if (!j?.ok) { setMsg(j?.error ?? "That key could not be saved."); return; }
      setMsg("Registered. You can unlock with it from the login screen.");
      await load();
    } catch (e) {
      // Cancelling the OS prompt is a choice, not an error.
      if ((e as Error).name !== "NotAllowedError") setMsg((e as Error).message.slice(0, 160));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (ref: string) => {
    await fetch(`/api/auth/passkey?ref=${encodeURIComponent(ref)}`, { method: "DELETE" });
    await load();
  };

  return (
    <GlassPanel className="mt-3 p-5">
      <div className="flex items-center gap-3">
        <Fingerprint className="size-4 text-live" />
        <div className="min-w-0">
          <p className="text-sm font-medium">Passkeys</p>
          <p className="mt-0.5 text-xs text-subtle">
            Face ID, Touch ID or a hardware key. The private half never leaves the device, and a
            fake login page cannot ask for it — which a password cannot claim, however long it is.
          </p>
        </div>
      </div>

      {keys && keys.length > 0 && (
        <div className="mt-4 flex flex-col gap-1">
          {keys.map((k) => (
            <div key={k.ref} className="flex items-center gap-3 border-b border-border-glass py-2 text-[13px] last:border-0">
              <ShieldCheck className="size-3.5 text-live" />
              <span className="flex-1 truncate">{k.label}</span>
              <span className="font-mono text-[9px] text-subtle">
                {k.lastUsedAt
                  ? `used ${new Date(k.lastUsedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
                  : "never used"}
              </span>
              <button onClick={() => void remove(k.ref)} className="text-subtle hover:text-red-400" title="Remove">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {!supported ? (
        <p className="mt-4 text-xs text-subtle">This browser has no passkey support.</p>
      ) : (
        <button
          onClick={() => void add()}
          disabled={busy}
          className="mt-4 inline-flex items-center gap-2 rounded-md border border-live-dim px-3 py-2 font-mono text-[10px] tracking-[1.4px] text-live disabled:opacity-45"
        >
          {busy ? <Loader2 className="size-3 animate-spin" /> : <Fingerprint className="size-3" />}
          {keys && keys.length ? "ADD ANOTHER DEVICE" : "REGISTER THIS DEVICE"}
        </button>
      )}

      {msg && <p className="mt-3 text-xs text-muted">{msg}</p>}

      <p className="mt-3 text-[11px] leading-relaxed text-subtle">
        The password still works, and still signs every session token. Keep it: it is the way back
        in if this device is lost, and locking the only door behind one phone is how people lose
        access to their own data.
      </p>
    </GlassPanel>
  );
}
