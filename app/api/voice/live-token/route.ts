import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

export const maxDuration = 30;

const LIVE_MODEL = process.env.SAGE_LIVE_MODEL ?? "gemini-2.5-flash-native-audio-preview-09-2025";

/**
 * Mints a short-lived ephemeral token so the browser can open a realtime
 * Live API WebSocket directly to Gemini (full-duplex voice with barge-in)
 * without ever seeing the real API key.
 */
export async function POST() {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: false, error: "No API key configured" }, { status: 500 });

  try {
    const client = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } });
    const token = await client.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        newSessionExpireTime: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
      },
    });
    return NextResponse.json({ ok: true, data: { token: token.name, model: LIVE_MODEL } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "token mint failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
