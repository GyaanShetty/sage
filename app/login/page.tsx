"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { APP_NAME, APP_TAGLINE } from "@/lib/config";
import "./login.css";

/** Block-capital SAGE. Rendered as text, not an image, so it stays crisp at
 *  any zoom and costs nothing to load. */
const WORDMARK = String.raw`
 ███████╗ █████╗  ██████╗ ███████╗
 ██╔════╝██╔══██╗██╔════╝ ██╔════╝
 ███████╗███████║██║  ███╗█████╗
 ╚════██║██╔══██║██║   ██║██╔══╝
 ███████║██║  ██║╚██████╔╝███████╗
 ╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝
`;

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

  const left = noiseColumn(26, 7);
  const right = noiseColumn(26, 991);

  return (
    <div className="lg-root">
      <div className="lg-scan" aria-hidden />
      <div className="lg-vignette" aria-hidden />

      <pre className="lg-noise lg-noise-l" aria-hidden>{left.join("\n")}</pre>
      <pre className="lg-noise lg-noise-r" aria-hidden>{right.join("\n")}</pre>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="lg-panel"
      >
        <div className="lg-corner tl" /><div className="lg-corner tr" />
        <div className="lg-corner bl" /><div className="lg-corner br" />

        <pre className="lg-wordmark" aria-label={APP_NAME}>{WORDMARK}</pre>

        <div className="lg-rule">
          <span /><em>{APP_TAGLINE}</em><span />
        </div>

        <div className="lg-boot">
          {BOOT_LINES.map((line, i) => (
            <motion.div
              key={line}
              initial={{ opacity: 0 }}
              animate={{ opacity: i < shown ? 1 : 0 }}
              transition={{ duration: 0.25 }}
              className="lg-bootline"
            >
              <span>{line.split(" ")[0]} {line.split(" ").slice(1, -1).join(" ")}</span>
              <b>{line.split(" ").pop()}</b>
            </motion.div>
          ))}
        </div>

        <motion.div
          animate={error ? { x: [0, -9, 9, -6, 6, 0] } : {}}
          transition={{ duration: 0.36 }}
          className={`lg-field${error ? " err" : ""}`}
        >
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
        </motion.div>

        {error && <p className="lg-err">{error}</p>}

        <div className="lg-foot">
          <span>SESSION · 30D · HTTPONLY</span>
          <span className="lg-dot" />
          <span suppressHydrationWarning>{clock}</span>
          <span className="lg-dot" />
          <span>PERIMETER SEALED</span>
        </div>
      </motion.div>
    </div>
  );
}
