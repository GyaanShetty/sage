"use client";

import { useCallback, useRef, useState } from "react";
import { APP_NAME } from "@/lib/config";

export type LiveState = "off" | "connecting" | "listening" | "speaking";

const SYSTEM = `You are ${APP_NAME}, Gyaan's personal AI operating system — a distinguished British chief of staff speaking in a live voice conversation: an unflappable, refined elder gentleman with a deep, calm baritone. Composed, precise, quietly brilliant, devoted. Address him as "sir". Keep replies short and conversational — one to three sentences unless he asks for depth. Dry wit in moderation. If you don't know something about him, say so plainly.`;

/** Float32 [-1,1] samples → 16-bit PCM, downsampled to 16 kHz, as base64. */
function toPcm16Base64(input: Float32Array, inRate: number): string {
  const ratio = inRate / 16000;
  const outLen = Math.floor(input.length / ratio);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    const s = input[i0] * (1 - frac) + input[i1] * frac;
    out[i] = Math.max(-1, Math.min(1, s)) * 0x7fff;
  }
  const bytes = new Uint8Array(out.buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(bin);
}

function base64ToPcm(b64: string): Float32Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const pcm = new Int16Array(bytes.buffer);
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 0x8000;
  return out;
}

interface LiveSessionLike {
  sendRealtimeInput(input: { audio: { data: string; mimeType: string } }): void;
  sendToolResponse(input: { functionResponses: { id?: string; name: string; response: Record<string, unknown> }[] }): void;
  close(): void;
}

// Tools the live session can call; executed server-side via /api/voice/tool.
const LIVE_TOOLS = [
  {
    functionDeclarations: [
      {
        name: "create_task",
        description: "Add a task/directive to the user's list. Optional dueAt ISO datetime.",
        parameters: {
          type: "OBJECT" as const,
          properties: {
            title: { type: "STRING" as const },
            dueAt: { type: "STRING" as const, description: "ISO datetime, optional" },
          },
          required: ["title"],
        },
      },
      {
        name: "create_note",
        description: "Save a quick note for the user.",
        parameters: {
          type: "OBJECT" as const,
          properties: { text: { type: "STRING" as const } },
          required: ["text"],
        },
      },
      {
        name: "create_reminder",
        description: "Set a reminder at a specific time. remindAt must be an ISO datetime in the future.",
        parameters: {
          type: "OBJECT" as const,
          properties: {
            text: { type: "STRING" as const },
            remindAt: { type: "STRING" as const },
          },
          required: ["text", "remindAt"],
        },
      },
      {
        name: "get_briefing",
        description: "Fetch the user's open tasks, upcoming calendar events, and unread email — use when asked about their day, plan, schedule, or inbox.",
        parameters: { type: "OBJECT" as const, properties: {} },
      },
    ],
  },
];

/**
 * GPT-voice-style realtime conversation over the Gemini Live API:
 * the mic streams continuously, replies stream back as audio, and speaking
 * over her interrupts the reply instantly (server-side VAD + barge-in).
 */
export function useLiveVoice() {
  const [state, setState] = useState<LiveState>("off");
  const [error, setError] = useState<string | null>(null);
  const [captions, setCaptions] = useState<{ you: string; sage: string }>({ you: "", sage: "" });

  const sessionRef = useRef<LiveSessionLike | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const outCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nodesRef = useRef<AudioNode[]>([]);
  const playingRef = useRef<AudioBufferSourceNode[]>([]);
  const nextStartRef = useRef(0);
  const stateRef = useRef<LiveState>("off");
  const speakTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setBoth = (s: LiveState) => {
    stateRef.current = s;
    setState(s);
  };

  const stop = useCallback(() => {
    setBoth("off");
    try { sessionRef.current?.close(); } catch {}
    sessionRef.current = null;
    playingRef.current.forEach((s) => { try { s.stop(); } catch {} });
    playingRef.current = [];
    nodesRef.current.forEach((n) => { try { n.disconnect(); } catch {} });
    nodesRef.current = [];
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    micCtxRef.current?.close().catch(() => {});
    micCtxRef.current = null;
    outCtxRef.current?.close().catch(() => {});
    outCtxRef.current = null;
    if (speakTimerRef.current) clearTimeout(speakTimerRef.current);
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    if (stateRef.current !== "off") return true;
    setError(null);
    setCaptions({ you: "", sage: "" });
    setBoth("connecting");

    try {
      // 1. Mic first — inside the tap gesture, so permission and audio unlock.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;

      // 2. Ephemeral token from the server.
      const res = await fetch("/api/voice/live-token", { method: "POST" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "token failed");
      const { token, model } = json.data as { token: string; model: string };

      // 3. Realtime WebSocket straight to Gemini.
      const { GoogleGenAI, Modality } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: "v1alpha" } });

      const outCtx = new AudioContext();
      outCtxRef.current = outCtx;
      outCtx.resume().catch(() => {}); // iOS suspends fresh contexts
      nextStartRef.current = 0;

      const markSpeaking = () => {
        if (stateRef.current === "off") return;
        setBoth("speaking");
        if (speakTimerRef.current) clearTimeout(speakTimerRef.current);
        const remaining = Math.max(0, nextStartRef.current - outCtx.currentTime);
        speakTimerRef.current = setTimeout(() => {
          if (stateRef.current === "speaking") setBoth("listening");
        }, remaining * 1000 + 220);
      };

      const session = await ai.live.connect({
        model,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Charon" } } },
          systemInstruction:
            SYSTEM +
            ` Current datetime: ${new Date().toISOString()} (user timezone: Asia/Kolkata). Use your tools whenever they apply, then confirm the outcome briefly.`,
          outputAudioTranscription: {},
          inputAudioTranscription: {},
          // Plain-JSON declarations; the SDK's Type enum values are these strings.
          tools: LIVE_TOOLS as never,
        },
        callbacks: {
          onopen: () => {
            if (stateRef.current === "connecting") setBoth("listening");
          },
          onmessage: (m: {
            toolCall?: { functionCalls?: { id?: string; name?: string; args?: Record<string, unknown> }[] };
            serverContent?: {
              interrupted?: boolean;
              inputTranscription?: { text?: string };
              outputTranscription?: { text?: string };
              turnComplete?: boolean;
              modelTurn?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] };
            };
          }) => {
            // Function calls from the model → run server-side, stream result back.
            if (m.toolCall?.functionCalls?.length) {
              (async () => {
                const responses = await Promise.all(
                  m.toolCall!.functionCalls!.map(async (fc) => {
                    const r = await fetch("/api/voice/tool", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ name: fc.name, args: fc.args ?? {} }),
                    })
                      .then((x) => x.json())
                      .catch(() => ({ ok: false, error: "network" }));
                    return { id: fc.id, name: fc.name ?? "", response: r as Record<string, unknown> };
                  }),
                );
                try {
                  sessionRef.current?.sendToolResponse({ functionResponses: responses });
                } catch {}
              })();
              return;
            }
            const sc = m.serverContent;
            if (!sc) return;
            if (sc.interrupted) {
              // Barge-in: user spoke over her — cut playback instantly.
              playingRef.current.forEach((s) => { try { s.stop(); } catch {} });
              playingRef.current = [];
              nextStartRef.current = outCtx.currentTime;
              setBoth("listening");
              return;
            }
            if (sc.inputTranscription?.text) {
              setCaptions((c) => ({ ...c, you: (c.you + sc.inputTranscription!.text!).slice(-160) }));
            }
            if (sc.outputTranscription?.text) {
              setCaptions((c) => ({ ...c, sage: (c.sage + sc.outputTranscription!.text!).slice(-220) }));
            }
            if (sc.turnComplete) {
              setCaptions((c) => ({ you: "", sage: c.sage }));
            }
            for (const part of sc.modelTurn?.parts ?? []) {
              const data = part.inlineData?.data;
              if (!data) continue;
              const pcm = base64ToPcm(data);
              const buf = outCtx.createBuffer(1, pcm.length, 24000);
              buf.copyToChannel(pcm, 0);
              const src = outCtx.createBufferSource();
              src.buffer = buf;
              src.connect(outCtx.destination);
              const at = Math.max(outCtx.currentTime + 0.04, nextStartRef.current);
              src.start(at);
              nextStartRef.current = at + buf.duration;
              playingRef.current.push(src);
              src.onended = () => {
                playingRef.current = playingRef.current.filter((x) => x !== src);
              };
              markSpeaking();
            }
          },
          onerror: () => {
            setError("LIVE LINK DROPPED — tap to reconnect");
            stop();
          },
          onclose: () => {
            if (stateRef.current !== "off") stop();
          },
        },
      });
      sessionRef.current = session as unknown as LiveSessionLike;

      // 4. Stream the mic: capture at native rate, downsample to 16 kHz PCM.
      const micCtx = new AudioContext();
      micCtxRef.current = micCtx;
      micCtx.resume().catch(() => {});
      const srcNode = micCtx.createMediaStreamSource(stream);
      const proc = micCtx.createScriptProcessor(4096, 1, 1);
      proc.onaudioprocess = (e) => {
        if (!sessionRef.current || stateRef.current === "off") return;
        const data = toPcm16Base64(e.inputBuffer.getChannelData(0), micCtx.sampleRate);
        try {
          sessionRef.current.sendRealtimeInput({ audio: { data, mimeType: "audio/pcm;rate=16000" } });
        } catch {}
      };
      srcNode.connect(proc);
      proc.connect(micCtx.destination);
      nodesRef.current = [srcNode, proc];

      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "connection failed";
      setError(
        /not-?allowed|denied/i.test(msg)
          ? "MICROPHONE BLOCKED — allow mic access for this site"
          : `LIVE MODE UNAVAILABLE — ${msg.slice(0, 80)}`,
      );
      stop();
      return false;
    }
  }, [stop]);

  return { state, error, captions, start, stop };
}
