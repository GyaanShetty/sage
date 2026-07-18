"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Ear, Mic, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useVoiceAssistant, type AssistantState } from "../engine";

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
      {/* outer rings */}
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
      {/* core */}
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
  const open = assistant.state !== "off";

  // Allow other surfaces (e.g. the dashboard Core) to engage voice mode.
  useEffect(() => {
    const handler = () => assistant.engage();
    window.addEventListener("sage:engage-voice", handler);
    return () => window.removeEventListener("sage:engage-voice", handler);
  }, [assistant]);

  // Broadcast state so the Core (and future surfaces) can react.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("sage:voice-state", { detail: assistant.state }));
  }, [assistant.state]);

  if (!assistant.supported) return null;

  return (
    <>
      {/* floating activator */}
      {!open && (
        <motion.button
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          whileHover={{ scale: 1.08 }}
          onClick={() => assistant.engage()}
          title="Talk to SAGE"
          className="fixed bottom-6 right-6 z-40 flex size-12 items-center justify-center rounded-full bg-accent text-white shadow-[0_0_30px_var(--accent-glow)]"
        >
          <Mic className="size-5" />
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
              onClick={assistant.disable}
              className="absolute right-6 top-6 rounded-full border border-border-glass p-2.5 text-muted transition-colors hover:text-foreground"
              aria-label="Close voice mode"
            >
              <X className="size-5" />
            </button>

            <Orb state={assistant.state} />

            <motion.p
              key={assistant.state}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-8 h-5 text-sm tracking-wide text-muted"
            >
              {STATE_LABEL[assistant.state]}
            </motion.p>

            <div className="mt-6 flex max-w-xl flex-col gap-2 px-6 text-center">
              {transcript.slice(-2).map((line, i) => (
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
              ))}
            </div>

            <button
              onClick={() => (assistant.state === "sleeping" ? assistant.engage() : assistant.enable())}
              className="absolute bottom-8 flex items-center gap-2 rounded-full border border-border-glass bg-glass px-4 py-2 text-xs text-muted transition-colors hover:text-foreground"
            >
              <Ear className="size-3.5" />
              {assistant.state === "sleeping" ? "Tap to talk now" : "Wake-word mode"}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
