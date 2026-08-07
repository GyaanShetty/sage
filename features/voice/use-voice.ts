"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
}

function getRecognition(): SpeechRecognitionLike | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

/**
 * Browser-native voice I/O (Web Speech API). STT via SpeechRecognition,
 * TTS via speechSynthesis. Upgraded later to streaming Whisper/TTS per the
 * architecture; the hook interface stays the same.
 */
export function useVoice({ onTranscript }: { onTranscript: (text: string) => void }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptRef = useRef("");

  useEffect(() => {
    setSupported(!!getRecognition() && "speechSynthesis" in window);
  }, []);

  const start = useCallback(() => {
    const recognition = getRecognition();
    if (!recognition) return;
    recognitionRef.current = recognition;
    transcriptRef.current = "";
    recognition.lang = navigator.language || "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let text = "";
      for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript;
      transcriptRef.current = text;
    };
    recognition.onend = () => {
      setListening(false);
      const text = transcriptRef.current.trim();
      if (text) onTranscript(text);
    };
    recognition.onerror = () => setListening(false);
    setListening(true);
    recognition.start();
  }, [onTranscript]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const speak = useCallback((text: string) => {
    if (!("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    synth.cancel();

    // Strip markdown noise before speaking. Nothing is truncated: this used to
    // cut at 1200 characters, so any long answer was simply not finished, and
    // the cut fell wherever it fell — usually mid-word.
    const clean = text
      .replace(/```[\s\S]*?```/g, " code block omitted ")
      .replace(/[*_#`>\[\]()]/g, "")
      .trim();
    if (!clean) return;

    // Chrome stalls a long utterance after ~15 seconds without firing an error.
    // Speaking a paragraph at a time, and poking pause/resume while it runs,
    // are the two halves of the workaround.
    const paragraphs = clean.split(/\n{2,}|\n/).map((p) => p.trim()).filter(Boolean);
    let keepalive: number | null = null;
    const stopKeepalive = () => { if (keepalive !== null) { clearInterval(keepalive); keepalive = null; } };

    const say = (i: number) => {
      if (i >= paragraphs.length) { stopKeepalive(); return; }
      const utterance = new SpeechSynthesisUtterance(paragraphs[i]);
      utterance.rate = 1.05;
      utterance.onend = () => { stopKeepalive(); say(i + 1); };
      utterance.onerror = () => { stopKeepalive(); say(i + 1); };
      synth.speak(utterance);
      stopKeepalive();
      keepalive = window.setInterval(() => {
        if (!synth.speaking) { stopKeepalive(); return; }
        synth.pause();
        synth.resume();
      }, 10_000) as unknown as number;
    };

    say(0);
  }, []);

  const stopSpeaking = useCallback(() => window.speechSynthesis?.cancel(), []);

  return { supported, listening, start, stop, speak, stopSpeaking };
}
