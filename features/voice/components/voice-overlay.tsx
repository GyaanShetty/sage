"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Mic, Send, Volume2, VolumeX, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useVoiceAssistant } from "../engine";
import { useLiveVoice } from "../live";
import { sound } from "@/lib/sound";
import { APP_NAME } from "@/lib/config";

type Msg = { role: "you" | "sage"; text: string };

/** Reactive listening/speaking waveform — a compact row of bars that breathe
 *  with the session state. Pure CSS animation, near-zero cost. */
function Wave({ active, speaking }: { active: boolean; speaking: boolean }) {
  const bars = 28;
  return (
    <div className="flex h-8 items-center justify-center gap-[3px]" aria-hidden>
      {Array.from({ length: bars }).map((_, i) => {
        const mid = Math.abs(i - bars / 2) / (bars / 2); // 0 center → 1 edges
        const base = 3 + (1 - mid) * 10;
        return (
          <motion.span
            key={i}
            className="w-[2px] rounded-full"
            style={{ background: speaking ? "var(--live)" : active ? "var(--live-dim)" : "var(--border-glass-strong)" }}
            animate={
              active || speaking
                ? { height: [base, base + (speaking ? 16 : 9) * (1 - mid * 0.6), base] }
                : { height: base }
            }
            transition={{ duration: 0.7 + mid * 0.5, repeat: Infinity, ease: "easeInOut", delay: i * 0.03 }}
          />
        );
      })}
    </div>
  );
}

/** Small header orb — a living status dot with concentric rings. */
function MiniOrb({ active, speaking, thinking }: { active: boolean; speaking: boolean; thinking: boolean }) {
  return (
    <div className="relative flex size-9 items-center justify-center">
      {[0, 1].map((i) => (
        <motion.span
          key={i}
          className="absolute rounded-full border border-[var(--live-dim)]"
          style={{ width: 18 + i * 12, height: 18 + i * 12 }}
          animate={active || speaking ? { scale: [1, 1.18, 1], opacity: [0.5, 0.1, 0.5] } : { scale: 1, opacity: 0.18 }}
          transition={{ duration: 1.6 + i * 0.4, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
      <motion.span
        className="size-3 rounded-full bg-[var(--live)]"
        style={{ boxShadow: "0 0 18px var(--live-glow)" }}
        animate={thinking ? { scale: [1, 0.7, 1] } : speaking ? { scale: [1, 1.35, 0.9, 1.2, 1] } : { scale: [1, 1.12, 1] }}
        transition={{ duration: thinking ? 1 : speaking ? 0.6 : 2, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

/** Speak a reply aloud with SAGE's voice (neural TTS, browser fallback). */
async function speakReply(text: string) {
  if (!sound.isOn() || !text) return;
  try {
    const res = await fetch("/api/voice/speak", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (res.ok) {
      const url = URL.createObjectURL(await res.blob());
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
      return;
    }
  } catch {
    /* fall through to browser synth */
  }
  const synth = window.speechSynthesis;
  if (!synth) return;
  const u = new SpeechSynthesisUtterance(text.replace(/[*_#`>[\]()]/g, ""));
  const v =
    synth.getVoices().find((x) => /en-GB/i.test(x.lang) && /male|daniel|george|arthur/i.test(x.name)) ??
    synth.getVoices().find((x) => /en-GB/i.test(x.lang)) ??
    null;
  if (v) u.voice = v;
  u.rate = 0.96;
  u.pitch = 0.8;
  synth.speak(u);
}

export function VoiceOverlay() {
  const [transcript, setTranscript] = useState<Msg[]>([]);
  const [mode, setMode] = useState<"live" | "classic">("live");
  const [muted, setMuted] = useState(false);
  const [typed, setTyped] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const onUtterance = useCallback(async (text: string) => {
    setTranscript((t) => [...t.slice(-30), { role: "you", text }]);
    const res = await fetch("/api/voice", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const json = await res.json();
    const reply: string = json?.data?.text ?? "Something went wrong.";
    setTranscript((t) => [...t.slice(-30), { role: "sage", text: reply }]);
    return reply;
  }, []);

  // Typed turn: works whether or not the mic is live. SAGE always speaks the
  // reply aloud (unless muted), so text and voice feel identical.
  const sendTyped = useCallback(async () => {
    const q = typed.trim();
    if (!q || sending) return;
    setTyped("");
    setSending(true);
    try {
      const reply = await onUtterance(q);
      await speakReply(reply);
    } finally {
      setSending(false);
    }
  }, [typed, sending, onUtterance]);

  const assistant = useVoiceAssistant({ onUtterance });
  const live = useLiveVoice();

  const open = live.state !== "off" || assistant.state !== "off";
  const liveActive = live.state !== "off";
  const speaking = liveActive ? live.state === "speaking" : assistant.state === "speaking";
  const listening = liveActive ? live.state === "listening" : assistant.state === "listening";
  const thinking = liveActive ? live.state === "connecting" : assistant.state === "thinking";

  const engage = useCallback(async () => {
    if (live.state !== "off" || assistant.state !== "off") return;
    sound.swoosh();
    setMode("live");
    const ok = await live.start();
    if (!ok) {
      setMode("classic");
      assistant.engage();
    }
  }, [live, assistant]);

  const closeAll = useCallback(() => {
    live.stop();
    assistant.disable();
  }, [live, assistant]);

  useEffect(() => {
    const handler = () => engage();
    window.addEventListener("sage:engage-voice", handler);
    return () => window.removeEventListener("sage:engage-voice", handler);
  }, [engage]);

  useEffect(() => {
    const s = liveActive ? (live.state === "connecting" ? "thinking" : live.state) : assistant.state;
    window.dispatchEvent(new CustomEvent("sage:voice-state", { detail: s }));
  }, [live.state, assistant.state, liveActive]);

  // Unified message list: spoken history + typed turns + the in-flight live
  // caption as a ghost line. In live mode `transcript` only holds typed turns.
  const messages = useMemo<(Msg & { pending?: boolean })[]>(() => {
    if (liveActive) {
      const out: (Msg & { pending?: boolean })[] = [...live.turns, ...transcript];
      if (live.captions.you) out.push({ role: "you", text: live.captions.you, pending: true });
      if (live.captions.sage) out.push({ role: "sage", text: live.captions.sage, pending: true });
      return out;
    }
    return transcript;
  }, [liveActive, live.turns, live.captions, transcript]);

  // Auto-scroll to the newest line.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, live.captions.you, live.captions.sage]);

  const toggleMute = () => {
    const on = sound.toggle();
    setMuted(!on);
  };

  const error = liveActive || mode === "live" ? live.error ?? assistant.error : assistant.error;

  const statusText = thinking
    ? "Opening secure link…"
    : speaking
      ? `${APP_NAME} is speaking`
      : listening
        ? "Listening — just talk, interrupt any time"
        : "Standing by";

  return (
    <>
      {!open && (
        <motion.button
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.94 }}
          onClick={engage}
          title="Talk to SAGE"
          className="fixed bottom-20 right-4 z-40 flex size-12 items-center justify-center rounded-full border border-[var(--live-dim)] bg-[var(--panel-hi)] text-[var(--live)] backdrop-blur-xl [animation:micHalo_3s_ease-in-out_infinite] md:bottom-6 md:right-6"
        >
          <Mic className="size-5" strokeWidth={1.75} />
        </motion.button>
      )}

      <AnimatePresence>
        {open && (
          <>
            {/* No scrim — the panel is non-modal so the dashboard stays fully
                visible and usable while the conversation runs. */}
            <motion.aside
              initial={{ opacity: 0, x: 40, y: 0 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, x: 40 }}
              transition={{ type: "spring", stiffness: 320, damping: 32 }}
              className={cn(
                "fixed z-50 flex flex-col overflow-hidden border border-border-glass-strong bg-[var(--panel-hi)]/95 shadow-2xl backdrop-blur-2xl",
                // desktop: docked to the right, tall panel — main area stays live
                "md:right-4 md:top-16 md:bottom-6 md:w-[400px] md:rounded-2xl",
                // mobile: compact bottom sheet above the tab bar, leaving the top
                // of the dashboard visible and tappable
                "inset-x-2 bottom-[76px] top-auto max-h-[52vh] rounded-2xl",
              )}
            >
              {/* Header */}
              <div className="flex items-center gap-3 border-b border-border-glass px-4 py-3">
                <MiniOrb active={listening} speaking={speaking} thinking={thinking} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium tracking-wide">{APP_NAME}</span>
                    {liveActive && (
                      <span className="lbl live flex items-center gap-1 !text-[8px] !opacity-90">
                        <span className="live-dot size-1 animate-pulse rounded-full" /> REALTIME
                      </span>
                    )}
                  </div>
                  <p className="truncate text-[11px] text-subtle">{statusText}</p>
                </div>
                <button
                  onClick={toggleMute}
                  title={muted ? "Unmute SAGE" : "Mute SAGE"}
                  className="rounded-lg p-2 text-muted transition-colors hover:text-foreground"
                >
                  {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
                </button>
                <button
                  onClick={closeAll}
                  aria-label="End voice"
                  className="rounded-lg p-2 text-muted transition-colors hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>

              {/* Transcript */}
              <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
                {messages.length === 0 && !error && (
                  <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                    <MiniOrb active speaking={false} thinking={thinking} />
                    <p className="max-w-[220px] text-sm text-muted">
                      {thinking ? "Connecting…" : `Say hello — I'm listening, sir. Ask me anything, or give an order.`}
                    </p>
                  </div>
                )}

                {messages.map((m, i) => (
                  <motion.div
                    key={`${i}-${m.role}`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: m.pending ? 0.7 : 1, y: 0 }}
                    className={cn("flex", m.role === "you" ? "justify-end" : "justify-start")}
                  >
                    <div
                      className={cn(
                        "max-w-[82%] rounded-2xl px-3.5 py-2 text-[14px] leading-relaxed",
                        m.role === "you"
                          ? "rounded-br-sm bg-glass-strong text-foreground"
                          : "rounded-bl-sm border border-border-glass bg-transparent text-muted",
                      )}
                    >
                      {m.text}
                      {m.pending && <span className="ml-0.5 inline-block animate-pulse">▍</span>}
                    </div>
                  </motion.div>
                ))}

                {error && (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-3.5 py-2.5 text-[13px] text-red-300">
                    {error}
                    <button onClick={engage} className="mt-1 block text-xs underline underline-offset-2 hover:text-red-200">
                      Reconnect
                    </button>
                  </div>
                )}
              </div>

              {/* Footer: live waveform + type-instead-of-speak box */}
              <div className="border-t border-border-glass px-4 py-3">
                <Wave active={listening} speaking={speaking} />
                <form
                  onSubmit={(e) => { e.preventDefault(); sendTyped(); }}
                  className="mt-2 flex items-center gap-2 rounded-xl border border-border-glass bg-glass px-3 py-1.5 focus-within:border-[var(--live-dim)]"
                >
                  <input
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    placeholder="Type instead — SAGE still speaks…"
                    aria-label="Type to SAGE"
                    className="flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-subtle"
                  />
                  <button
                    type="submit"
                    disabled={sending || !typed.trim()}
                    aria-label="Send"
                    className="text-muted transition-colors hover:text-[var(--live)] disabled:opacity-30"
                  >
                    {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  </button>
                </form>
                <p className="mt-1.5 text-center text-[10px] tracking-wide text-subtle">
                  {liveActive ? "Full-duplex · speak, or type — SAGE replies aloud" : "Speak or type — SAGE replies aloud"}
                </p>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
