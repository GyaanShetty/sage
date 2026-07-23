"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Ear, Mic, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useVoiceAssistant, type AssistantState } from "../engine";
import { useLiveVoice } from "../live";
import { sound } from "@/lib/sound";

const STATE_LABEL: Record<AssistantState, string> = {
  off: "",
  sleeping: 'Say "Sage, wake up"',
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "",
};

function Orb({ state }: { state: AssistantState }) {
  const active = state === "listening";
  const thinking = state === "thinking";
  const speaking = state === "speaking";
  return (
    <div className="relative flex size-40 items-center justify-center">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="absolute rounded-full border border-accent/30"
          style={{ width: 90 + i * 34, height: 90 + i * 34 }}
          animate={
            active
              ? { scale: [1, 1.12, 1], opacity: [0.5, 0.15, 0.5] }
              : speaking
                ? { scale: [1, 1.06, 1], opacity: [0.4, 0.2, 0.4] }
                : { scale: 1, opacity: 0.15 }
          }
          transition={{ duration: 1.6 + i * 0.3, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
      <motion.div
        className="size-20 rounded-full bg-accent shadow-[0_0_80px_var(--accent-glow)]"
        animate={
          thinking
            ? { scale: [1, 0.9, 1], rotate: [0, 180, 360] }
            : active
              ? { scale: [1, 1.15, 1] }
              : speaking
                ? { scale: [1, 1.08, 0.96, 1.1, 1] }
                : { scale: [1, 1.03, 1] }
        }
        transition={{ duration: thinking ? 1.2 : speaking ? 0.7 : 1.8, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

export function VoiceOverlay() {
  const [transcript, setTranscript] = useState<{ role: "you" | "sage"; text: string }[]>([]);
  const [mode, setMode] = useState<"live" | "classic">("live");

  const onUtterance = useCallback(async (text: string) => {
    setTranscript((t) => [...t.slice(-4), { role: "you", text }]);
    const res = await fetch("/api/voice", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const json = await res.json();
    const reply: string = json?.data?.text ?? "Something went wrong.";
    setTranscript((t) => [...t.slice(-4), { role: "sage", text: reply }]);
    return reply;
  }, []);

  const assistant = useVoiceAssistant({ onUtterance });
  const live = useLiveVoice();

  const open = live.state !== "off" || assistant.state !== "off";
  const liveActive = live.state !== "off";

  // Live first (GPT-style full duplex); classic pipeline as fallback.
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
    const s = liveActive
      ? live.state === "connecting"
        ? "thinking"
        : live.state
      : assistant.state;
    window.dispatchEvent(new CustomEvent("sage:voice-state", { detail: s }));
  }, [live.state, assistant.state, liveActive]);

  const orbState: AssistantState = liveActive
    ? live.state === "connecting"
      ? "thinking"
      : (live.state as AssistantState)
    : assistant.state;

  const error = liveActive || mode === "live" ? live.error ?? assistant.error : assistant.error;

  return (
    <>
      {!open && (
        <motion.button
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          whileHover={{ scale: 1.08 }}
          onClick={engage}
          title="Talk to SAGE"
          className="fixed bottom-20 right-4 z-40 flex size-12 items-center justify-center rounded-full border border-[var(--live-dim)] bg-[var(--panel-hi)] text-[var(--live)] backdrop-blur-xl [animation:micHalo_3s_ease-in-out_infinite] md:bottom-6 md:right-6"
        >
          <Mic className="size-5" strokeWidth={1.75} />
        </motion.button>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 backdrop-blur-2xl"
          >
            <button
              onClick={closeAll}
              className="absolute right-6 top-6 rounded-full border border-border-glass p-2.5 text-muted transition-colors hover:text-foreground"
              aria-label="Close voice mode"
            >
              <X className="size-5" />
            </button>

            {liveActive && (
              <span className="lbl live absolute left-6 top-7 flex items-center gap-2 !opacity-90">
                <span className="live-dot size-1.5 animate-pulse rounded-full" />
                REALTIME LINK
              </span>
            )}

            <Orb state={orbState} />

            <motion.p
              key={orbState}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-8 h-5 text-sm tracking-wide text-muted"
            >
              {liveActive
                ? live.state === "connecting"
                  ? "Opening link…"
                  : live.state === "listening"
                    ? "Listening — just talk, interrupt any time"
                    : ""
                : STATE_LABEL[assistant.state]}
            </motion.p>
            {error && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="lbl mt-2 max-w-sm text-center !text-red-400"
              >
                {error}
              </motion.p>
            )}

            <div className="mt-6 flex max-w-xl flex-col gap-2 px-6 text-center">
              {liveActive ? (
                <>
                  {live.captions.you && (
                    <p className="text-[15px] leading-relaxed text-subtle">&ldquo;{live.captions.you}&rdquo;</p>
                  )}
                  {live.captions.sage && (
                    <p className="text-[15px] leading-relaxed text-foreground">{live.captions.sage}</p>
                  )}
                </>
              ) : (
                transcript.slice(-2).map((line, i) => (
                  <motion.p
                    key={`${line.text}-${i}`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn(
                      "text-[15px] leading-relaxed",
                      line.role === "you" ? "text-subtle" : "text-foreground",
                    )}
                  >
                    {line.role === "you" ? `"${line.text}"` : line.text}
                  </motion.p>
                ))
              )}
            </div>

            {!liveActive && (
              <button
                onClick={() => (assistant.state === "sleeping" ? assistant.engage() : assistant.enable())}
                className="absolute bottom-8 flex items-center gap-2 rounded-full border border-border-glass bg-glass px-4 py-2 text-xs text-muted transition-colors hover:text-foreground"
              >
                <Ear className="size-3.5" />
                {assistant.state === "sleeping" ? "Tap to talk now" : "Wake-word mode"}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
