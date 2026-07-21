import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "@/infrastructure/llm";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { TZ } from "@/lib/config";

export const maxDuration = 60;

interface Card {
  q: string;
  a: string;
  topic: string;
}

// One generation per day — Gemini free tier friendly.
let cache: { day: string; cards: Card[] } | null = null;

function todayKey(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

export async function GET() {
  const day = todayKey();
  if (cache?.day === day && cache.cards.length) {
    return NextResponse.json({ ok: true, data: cache.cards });
  }

  const model = getModel("fast");
  if (!model) return NextResponse.json({ ok: true, data: [] });

  const { data: chunks } = await db
    .from("Chunk")
    .select("content, Source(title)")
    .eq("userId", DEFAULT_USER_ID)
    .limit(60);
  if (!chunks?.length) return NextResponse.json({ ok: true, data: [] });

  // Shuffle and sample so each day quizzes different material.
  const sample = [...chunks].sort(() => Math.random() - 0.5).slice(0, 8);
  const material = sample
    .map((c) => {
      const src = (c.Source as unknown as { title?: string } | null)?.title ?? "notes";
      return `[${src}] ${String(c.content).slice(0, 700)}`;
    })
    .join("\n---\n");

  try {
    const { object } = await generateObject({
      model,
      schema: z.object({
        cards: z.array(
          z.object({
            q: z.string().describe("A short, testing question about the material"),
            a: z.string().describe("A concise answer, 1-3 sentences"),
            topic: z.string().describe("2-4 word topic label"),
          }),
        ),
      }),
      prompt: `Create 4 to 6 flashcards that test genuine understanding of this material the user saved to their knowledge base. Ask about the substance (concepts, claims, numbers), never about the document itself.\n\n${material}`,
    });
    const cards = object.cards.slice(0, 6);
    cache = { day, cards };
    return NextResponse.json({ ok: true, data: cards });
  } catch (err) {
    console.error("[flashcards]", err);
    return NextResponse.json({ ok: true, data: [] });
  }
}
