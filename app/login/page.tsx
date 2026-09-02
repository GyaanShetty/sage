"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { startAuthentication } from "@simplewebauthn/browser";
import { APP_NAME, APP_TAGLINE } from "@/lib/config";
import "./login.css";
import { SageMark } from "@/components/ui/sage-mark";

/** Filler for the side columns — meaningless on purpose, it is texture. */
const GLYPHS = "01▏▎▍▌▋▊▉█░▒▓╱╲╳┄┈─═╬╫╪⌁⌂⌘⏣◈◇◆▪▫";

function noiseColumn(rows: number, seed: number): string[] {
  // Deterministic: a random column would differ between the server render and
  // the client one, and React would shout about the mismatch.
  const out: string[] = [];
  let x = seed;
  for (let r = 0; r < rows; r++) {
    let line = "";
    for (let c = 0; c < 22; c++) {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      line += (x >> 16) % 7 === 0 ? GLYPHS[(x >> 8) % GLYPHS.length] : " ";
    }
    out.push(line);
  }
  return out;
}

const BOOT_LINES = [
  "SAGE KERNEL ................ ONLINE",
  "MEMORY CORE ................ MOUNTED",
  "VOICE SUBSYSTEM ............ ARMED",
  "PIPELINE MONITOR ........... WATCHING",
  "AUTONOMOUS DIRECTIVES ...... IDLE",
  "PERIMETER .................. SEALED",
];

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(0);
  const [clock, setClock] = useState<string>("--:--:--");
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Boot lines tick in one at a time; the clock is client-only to avoid a
  // hydration mismatch on a value that is different by definition.
  useEffect(() => {
    const t = setInterval(() => setShown((n) => (n < BOOT_LINES.length ? n + 1 : n)), 260);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString("en-GB", { hour12: false }));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  const submit = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.push("/dashboard");
        router.refresh();
        return;
      }
      // Surface the server's reason — the throttle says how long to wait, and
      // "wrong password" when you are actually rate-limited is a lie.
      const j = await res.json().catch(() => null);
      setError(j?.error ?? "Wrong password.");
    } catch {
      setError("Couldn't reach the server.");
    }
    setBusy(false);
    inputRef.current?.select();
  };

  /**
   * Sign in with the device instead of the password.
   *
   * Only offered once a passkey exists — the options endpoint 404s otherwise,
   * and a Face ID button that always fails is worse than no button. The
   * browser does the hard part: it will only sign for the origin the
   * credential was registered to, so a lookalike page cannot ask for this.
   */
  const [hasPasskey, setHasPasskey] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.PublicKeyCredential) return;
    fetch("/api/auth/passkey/login")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setHasPasskey(!!j?.ok))
      .catch(() => undefined);
  }, []);

  const signInWithDevice = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const optRes = await fetch("/api/auth/passkey/login");
      const opt = await optRes.json();
      if (!opt?.ok) { setError(opt?.error ?? "No passkey available."); setBusy(false); return; }

      const assertion = await startAuthentication({ optionsJSON: opt.data });

      const res = await fetch("/api/auth/passkey/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ response: assertion }),
      });
      const j = await res.json().catch(() => null);
      if (res.ok && j?.ok) {
        router.push("/dashboard");
        router.refresh();
        return;
      }
      setError(j?.error ?? "That did not verify.");
    } catch (e) {
      // A cancelled prompt is not a failure worth shouting about.
      const msg = (e as Error).name === "NotAllowedError" ? null : (e as Error).message;
      if (msg) setError(msg.slice(0, 140));
    }
    setBusy(false);
  };

  const left = noiseColumn(26, 7);
  const right = noiseColumn(26, 991);

  return (
    <div className="lg-root">
      <div className="lg-scan" aria-hidden />
      <div className="lg-vignette" aria-hidden />

      <pre className="lg-noise lg-noise-l" aria-hidden>{left.join("\n")}</pre>
      <pre className="lg-noise lg-noise-r" aria-hidden>{right.join("\n")}</pre>

      {/* Entrance is CSS, not JS. A motion component that fails to animate
          leaves the panel at opacity 0 — which is exactly what happened, and
          it made the only way into the app invisible. Decoration must never
          be able to hide the door. */}
      <div className="lg-panel">
        <div className="lg-corner tl" /><div className="lg-corner tr" />
        <div className="lg-corner bl" /><div className="lg-corner br" />

        <SageMark size={64} online className="lg-mark" />
        <h1 className="brand-wordmark">{APP_NAME}</h1>

        <div className="lg-rule">
          <span /><em>{APP_TAGLINE}</em><span />
        </div>

        <div className="lg-boot">
          {BOOT_LINES.map((line, i) => (
            <div
              key={line}
              className="lg-bootline"
              style={{ opacity: i < shown ? 1 : 0 }}
            >
              <span>{line.split(" ")[0]} {line.split(" ").slice(1, -1).join(" ")}</span>
              <b>{line.split(" ").pop()}</b>
            </div>
          ))}
        </div>

        <div className={`lg-field${error ? " err" : ""}`} key={error ?? "ok"}>
          <span className="lg-prompt">▶</span>
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(null); }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="ACCESS KEY"
            autoFocus
            autoComplete="current-password"
            aria-label="Access password"
            className="lg-input"
          />
          <button onClick={submit} disabled={busy || !password} className="lg-go">
            {busy ? "…" : "ENTER"}
          </button>
        </div>

        {hasPasskey && (
          <button onClick={signInWithDevice} disabled={busy} className="lg-passkey">
            ⛨ UNLOCK WITH FACE ID / TOUCH ID
          </button>
        )}

        {error && <p className="lg-err">{error}</p>}

        <div className="lg-foot">
          <span>SESSION · 30D · HTTPONLY</span>
          <span className="lg-dot" />
          <span suppressHydrationWarning>{clock}</span>
          <span className="lg-dot" />
          <span>PERIMETER SEALED</span>
        </div>
      </div>
    </div>
  );
}
