"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type AssistantState = "off" | "sleeping" | "listening" | "thinking" | "speaking";

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
      }) => void)
    | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
}

function createRecognition(): RecognitionLike | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => RecognitionLike;
    webkitSpeechRecognition?: new () => RecognitionLike;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

const WAKE_RE = /\b(hey\s+)?sage\b.*\b(wake|up|hello|hi)\b|\bwake\s+up\b.*\bsage\b|\bhey\s+sage\b/i;
const SLEEP_RE = /\b(go\s+to\s+sleep|goodbye|good\s*night|stand\s+down|that('?s| is)\s+all)\b/i;

/** Fallback browser voice: prefer a natural female English voice. */
function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  return (
    voices.find((v) => /^en/i.test(v.lang) && /female|samantha|zira|victoria|karen|moira|tessa|serena/i.test(v.name)) ??
    voices.find((v) => v.name === "Google UK English Female") ??
    voices.find((v) => /^en/i.test(v.lang)) ??
    null
  );
}

/**
 * JARVIS-style voice assistant loop:
 * off → (enable) → sleeping: passive wake-word listening ("Sage, wake up")
 * → listening: capture an utterance → thinking: ask SAGE → speaking: reply aloud
 * → listening again (continuous conversation) … until sleep phrase or silence.
 */
export function useVoiceAssistant({ onUtterance }: { onUtterance: (text: string) => Promise<string> }) {
  const [state, setState] = useState<AssistantState>("off");
  const [supported, setSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastHeard, setLastHeard] = useState("");
  const [lastReply, setLastReply] = useState("");
  const stateRef = useRef<AssistantState>("off");
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const emptyRoundsRef = useRef(0);

  const setBoth = (s: AssistantState) => {
    stateRef.current = s;
    setState(s);
  };

  useEffect(() => {
    setSupported(!!createRecognition() && "speechSynthesis" in window);
    window.speechSynthesis?.getVoices(); // warm the voice list
  }, []);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const speak = useCallback(async (text: string) => {
    const clean = text
      .replace(/```[\s\S]*?```/g, " I've put the code on screen. ")
      .replace(/[*_#`>\[\]()|]/g, "")
      .slice(0, 1400);

    // Prefer neural TTS (Gemini); fall back to browser synthesis.
    try {
      const res = await fetch("/api/voice/speak", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: clean }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        await new Promise<void>((resolve) => {
          const audio = new Audio(url);
          audioRef.current = audio;
          audio.onended = () => resolve();
          audio.onerror = () => resolve();
          audio.play().catch(() => resolve());
        });
        URL.revokeObjectURL(url);
        return;
      }
    } catch {}

    await new Promise<void>((resolve) => {
      const synth = window.speechSynthesis;
      if (!synth) return resolve();
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(clean);
      const voice = pickVoice();
      if (voice) utterance.voice = voice;
      utterance.rate = 1.0;
      utterance.pitch = 0.92;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      synth.speak(utterance);
    });
  }, []);

  /** One recognition session; resolves with the final transcript ("" on nothing). */
  const listenOnce = useCallback((timeoutMs: number) => {
    return new Promise<string>((resolve) => {
      const recognition = createRecognition();
      if (!recognition) return resolve("");
      recognitionRef.current = recognition;
      let transcript = "";
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(transcript.trim());
      };
      const timer = setTimeout(() => {
        try {
          recognition.stop();
        } catch {}
      }, timeoutMs);
      recognition.lang = navigator.language || "en-US";
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.onresult = (event) => {
        let text = "";
        for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript;
        transcript = text;
      };
      recognition.onend = finish;
      recognition.onerror = (event) => {
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          setError("MICROPHONE BLOCKED — allow mic access for this site in your browser");
        } else if (event.error === "network") {
          setError("SPEECH SERVICE UNREACHABLE — try Chrome, or check connection");
        }
        finish();
      };
      try {
        recognition.start();
      } catch {
        finish();
      }
    });
  }, []);

  const conversationLoop = useCallback(async () => {
    emptyRoundsRef.current = 0;
    while (stateRef.current !== "off") {
      setBoth("listening");
      const heard = await listenOnce(10_000);
      if ((stateRef.current as AssistantState) === "off") return;

      if (!heard) {
        emptyRoundsRef.current += 1;
        if (emptyRoundsRef.current >= 2) break; // silence → back to sleep
        continue;
      }
      emptyRoundsRef.current = 0;
      setLastHeard(heard);

      if (SLEEP_RE.test(heard)) {
        setBoth("speaking");
        await speak("Very good. I'll be here when you need me.");
        break;
      }

      setBoth("thinking");
      let reply: string;
      try {
        reply = await onUtterance(heard);
      } catch {
        reply = "I hit a snag processing that. Shall we try again?";
      }
      if ((stateRef.current as AssistantState) === "off") return;
      setLastReply(reply);
      setBoth("speaking");
      await speak(reply || "Done.");
    }
    if (stateRef.current !== "off") wakeLoop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listenOnce, speak, onUtterance]);

  const wakeLoop = useCallback(async () => {
    setBoth("sleeping");
    while (stateRef.current === "sleeping") {
      const heard = await listenOnce(15_000);
      if (stateRef.current !== "sleeping") return;
      if (heard && WAKE_RE.test(heard)) {
        setBoth("speaking");
        await speak("At your service.");
        await conversationLoop();
        return;
      }
    }
  }, [listenOnce, speak, conversationLoop]);

  const enable = useCallback(() => {
    if (stateRef.current !== "off") return;
    wakeLoop();
  }, [wakeLoop]);

  /** Skip the wake word: jump straight into conversation. */
  const engage = useCallback(async () => {
    if (stateRef.current !== "off") return;
    setError(null);
    // Force the mic permission prompt up front so failures are visible.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      setError("MICROPHONE BLOCKED — allow mic access for this site in your browser");
      setBoth("listening"); // open the overlay so the error is visible
      setTimeout(() => { if (stateRef.current === "listening") setBoth("off"); }, 4000);
      return;
    }
    // ChatGPT-style: no spoken preamble — start listening instantly for a
    // tight one-to-one exchange. A short chime cue instead of a TTS round-trip.
    conversationLoop();
  }, [conversationLoop]);

  const disable = useCallback(() => {
    setBoth("off");
    try {
      recognitionRef.current?.abort();
    } catch {}
    audioRef.current?.pause();
    window.speechSynthesis?.cancel();
  }, []);

  useEffect(() => () => disable(), [disable]);

  return { state, supported, error, lastHeard, lastReply, enable, engage, disable };
}
