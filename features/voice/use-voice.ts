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
    window.speechSynthesis.cancel();
    // Strip markdown noise before speaking
    const clean = text
      .replace(/```[\s\S]*?```/g, " code block omitted ")
      .replace(/[*_#`>\[\]()]/g, "")
      .slice(0, 1200);
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.rate = 1.05;
    window.speechSynthesis.speak(utterance);
  }, []);

  const stopSpeaking = useCallback(() => window.speechSynthesis?.cancel(), []);

  return { supported, listening, start, stop, speak, stopSpeaking };
}
