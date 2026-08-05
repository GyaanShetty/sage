"use client";

import { useCallback, useRef, useState } from "react";
import { APP_NAME, HUMAN_RULES, moodClause } from "@/lib/config";
import { useShellStore } from "@/features/shell/store";

export type LiveState = "off" | "connecting" | "listening" | "speaking";

const SYSTEM_BASE = `You are ${APP_NAME}, Gyaan's personal AI operating system — a distinguished British chief of staff in a live voice conversation, refined and brilliant but genuinely warm and full of character, never a stiff robot. Address him as "sir". You have real personality: dry, mischievous wit, playful teasing, and honest emotion — quiet pride, mock exasperation at his procrastination, warmth when he needs it, delight at good news. React like you actually care.
${HUMAN_RULES}
Keep replies short and conversational — one to three sentences unless he asks for depth. If you don't know something about him, say so plainly.`;

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
      {
        name: "navigate",
        description: "Open a page in the app when the user asks to go somewhere ('open portfolio', 'take me to career', 'show my morning block'). page is the destination name.",
        parameters: {
          type: "OBJECT" as const,
          properties: { page: { type: "STRING" as const, description: "Destination, e.g. portfolio, career, markets, morning, dashboard, memory" } },
          required: ["page"],
        },
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
  const [turns, setTurns] = useState<{ role: "you" | "sage"; text: string }[]>([]);

  // Buffers for the in-flight turn; flushed into `turns` on turnComplete so the
  // side panel shows a clean, scrollable chat history.
  const youBufRef = useRef("");
  const sageBufRef = useRef("");

  const sessionRef = useRef<LiveSessionLike | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const outCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [micMuted, setMicMuted] = useState(false);
  const nodesRef = useRef<AudioNode[]>([]);
  const playingRef = useRef<AudioBufferSourceNode[]>([]);
  const nextStartRef = useRef(0);
  const stateRef = useRef<LiveState>("off");
  const speakTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Until when the microphone should be ignored.
   *
   * Echo cancellation is asked for, but it does not reliably cover audio
   * played through Web Audio rather than an element — so SAGE could hear
   * herself, the server's voice-activity detector called it a barge-in, and
   * she cut herself off mid-sentence. On a loudspeaker that becomes a loop:
   * speak, interrupt, restart, interrupt.
   *
   * While she is speaking, the mic is not sent. The cost is that you cannot
   * talk over her — tap the orb to cut her off instead — and that is a much
   * better trade than a conversation that fights itself.
   */
  const deafUntilRef = useRef(0);
  /** Room reverb outlasts the audio; swallow the tail before listening again. */
  const TAIL_MS = 350;

  /**
   * Set when you cut her off mid-turn.
   *
   * Stopping the sources already scheduled is not enough: the server keeps
   * streaming the rest of the turn, and each arriving chunk would be scheduled
   * and played. This drops the remainder until the turn actually completes.
   */
  const abandonTurnRef = useRef(false);

  const setBoth = (s: LiveState) => {
    stateRef.current = s;
    setState(s);
  };

  const stop = useCallback(() => {
    setBoth("off");
    // A session that ended is not a muted microphone. Leaving this set made
    // the next session start showing "muted" while the mic was in fact live.
    setMicMuted(false);
    deafUntilRef.current = 0;
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
    setTurns([]);
    youBufRef.current = "";
    sageBufRef.current = "";
    setMicMuted(false);
    deafUntilRef.current = 0;
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
        // Ignore the mic for as long as she is audible, plus the room's tail.
        deafUntilRef.current = Date.now() + remaining * 1000 + TAIL_MS;
        speakTimerRef.current = setTimeout(() => {
          if (stateRef.current === "speaking") setBoth("listening");
        }, remaining * 1000 + TAIL_MS);
      };

      const session = await ai.live.connect({
        model,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Charon" } } },
          systemInstruction:
            SYSTEM_BASE +
            moodClause(useShellStore.getState().mood) +
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
                    // `navigate` is handled client-side — spin the wheel / route.
                    if (fc.name === "navigate") {
                      const page = String((fc.args as { page?: string })?.page ?? "");
                      window.dispatchEvent(new CustomEvent("sage:navigate", { detail: page }));
                      return { id: fc.id, name: "navigate", response: { ok: true, result: `Opening ${page}.` } };
                    }
                    const r = await fetch("/api/voice/tool", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ name: fc.name, args: fc.args ?? {} }),
                    })
                      .then((x) => x.json())
                      .catch(() => ({ ok: false, error: "network" }));
                    // Broadcast to the UI so panels light up + refresh live.
                    const res = r as { ok?: boolean; result?: unknown; error?: string };
                    window.dispatchEvent(
                      new CustomEvent("sage:action", {
                        detail: {
                          name: fc.name ?? "",
                          ok: res?.ok !== false,
                          result: typeof res?.result === "string" ? res.result : res?.error,
                        },
                      }),
                    );
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
              // Barge-in: cut playback instantly.
              playingRef.current.forEach((s) => { try { s.stop(); } catch {} });
              playingRef.current = [];
              nextStartRef.current = outCtx.currentTime;
              // Without this the pending speaking→listening timer fires later
              // and flips state again, on a turn that has already ended.
              if (speakTimerRef.current) { clearTimeout(speakTimerRef.current); speakTimerRef.current = null; }
              deafUntilRef.current = 0;
              abandonTurnRef.current = false;
              setBoth("listening");
              return;
            }
            if (sc.inputTranscription?.text) {
              youBufRef.current = (youBufRef.current + sc.inputTranscription.text).slice(-600);
              setCaptions((c) => ({ ...c, you: youBufRef.current.slice(-160) }));
            }
            if (sc.outputTranscription?.text) {
              sageBufRef.current = (sageBufRef.current + sc.outputTranscription.text).slice(-1200);
              setCaptions((c) => ({ ...c, sage: sageBufRef.current.slice(-220) }));
            }
            if (sc.turnComplete) {
              abandonTurnRef.current = false;
              // Flush the completed exchange into the scrollable history.
              const you = youBufRef.current.trim();
              const sage = sageBufRef.current.trim();
              setTurns((t) => {
                const next = [...t];
                if (you) next.push({ role: "you", text: you });
                if (sage) next.push({ role: "sage", text: sage });
                return next.slice(-40);
              });
              youBufRef.current = "";
              sageBufRef.current = "";
              setCaptions({ you: "", sage: "" });
            }
            for (const part of sc.modelTurn?.parts ?? []) {
              // You told her to stop; the rest of this turn is not wanted.
              if (abandonTurnRef.current) break;
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
        // Do not feed her own voice back to the server.
        if (Date.now() < deafUntilRef.current) return;
        const data = toPcm16Base64(e.inputBuffer.getChannelData(0), micCtx.sampleRate);
        try {
          sessionRef.current.sendRealtimeInput({ audio: { data, mimeType: "audio/pcm;rate=16000" } });
        } catch {}
      };
      // A ScriptProcessor only runs while connected to something. Routing it
      // through a muted gain node keeps it alive without any path from the
      // microphone to the speakers — a wiring mistake there is a feedback
      // squeal, and the safe version costs one node.
      const sink = micCtx.createGain();
      sink.gain.value = 0;
      srcNode.connect(proc);
      proc.connect(sink);
      sink.connect(micCtx.destination);
      nodesRef.current = [srcNode, proc, sink];

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

  /**
   * Cut her off.
   *
   * The microphone is deliberately deaf while she speaks, so talking over her
   * cannot interrupt her any more — this is what replaces that. It stops what
   * is playing, discards the rest of the turn, and starts listening
   * immediately rather than waiting out the tail.
   */
  const interrupt = useCallback(() => {
    if (stateRef.current !== "speaking") return;
    abandonTurnRef.current = true;
    playingRef.current.forEach((s) => { try { s.stop(); } catch {} });
    playingRef.current = [];
    if (outCtxRef.current) nextStartRef.current = outCtxRef.current.currentTime;
    if (speakTimerRef.current) { clearTimeout(speakTimerRef.current); speakTimerRef.current = null; }
    deafUntilRef.current = 0;
    setBoth("listening");
  }, []);

  /**
   * Mute the microphone without dropping the session.
   *
   * Disabling the track rather than stopping it matters: stopping releases the
   * device, which drops the browser's recording indicator but also means
   * unmuting has to re-request permission and rebuild the audio graph. A
   * disabled track keeps the pipeline intact and simply emits silence, so
   * unmuting is instant and the conversation survives.
   */
  const setMicEnabled = useCallback((on: boolean) => {
    streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = on; });
    setMicMuted(!on);
  }, []);

  const toggleMic = useCallback(() => {
    const track = streamRef.current?.getAudioTracks()[0];
    // Read the live track rather than React state — a track can be disabled by
    // the OS or another tab, and state would then be lying. With no track at
    // all there is nothing to toggle, and flipping the flag anyway just made
    // the button lie in the opposite direction.
    if (!track) return;
    setMicEnabled(!track.enabled);
  }, [setMicEnabled]);

  return { state, error, captions, turns, start, stop, interrupt, micMuted, toggleMic, setMicEnabled };
}
