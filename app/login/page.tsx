"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, Loader2 } from "lucide-react";
import { APP_NAME, APP_TAGLINE } from "@/lib/config";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const router = useRouter();

  const submit = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(false);
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      router.push("/dashboard");
      router.refresh();
    } else {
      setError(true);
      setBusy(false);
    }
  };

  return (
    <div className="flex h-dvh items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 28 }}
        className="w-full max-w-sm px-6"
      >
        <div className="mx-auto mb-6 size-12 rounded-xl bg-accent/90 shadow-[0_0_40px_var(--accent-glow)]" />
        <h1 className="text-center text-xl font-semibold tracking-tight">{APP_NAME}</h1>
        <p className="mt-1 text-center text-sm text-subtle">{APP_TAGLINE}</p>

        <motion.div
          animate={error ? { x: [0, -8, 8, -5, 5, 0] } : {}}
          transition={{ duration: 0.35 }}
          className="mt-8 flex items-center gap-2 rounded-xl border border-border-glass bg-glass px-4 backdrop-blur-xl transition-colors focus-within:border-border-glass-strong"
        >
          <input
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(false);
            }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Access password"
            autoFocus
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle"
          />
          <button
            onClick={submit}
            disabled={busy || !password}
            aria-label="Sign in"
            className="flex size-8 items-center justify-center rounded-lg bg-accent text-white shadow-[0_0_16px_var(--accent-glow)] transition-opacity disabled:opacity-30"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
          </button>
        </motion.div>
        {error && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-3 text-center text-sm text-red-400"
          >
            Wrong password.
          </motion.p>
        )}
      </motion.div>
    </div>
  );
}
