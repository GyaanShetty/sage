import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "@/infrastructure/llm";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

export const maxDuration = 60;

const schema = z.object({
  title: z.string(),
  overview: z.string().describe("2-3 sentence plain-language overview"),
  parts: z
    .array(
      z.object({
        name: z.string(),
        role: z.string().describe("what this part does, 1-2 sentences"),
        importance: z.number().min(1).max(3).describe("3 = core/central, 1 = peripheral"),
        connectsTo: z.array(z.string()).describe("names of parts this directly connects to or interacts with"),
      }),
    )
    .min(5)
    .max(14),
  howItWorks: z.string().describe("a short narrative of how the whole thing operates, step by step"),
  modelQuery: z.string().describe("2-4 word search phrase to find a realistic 3D model of this on a model library, e.g. 'V8 car engine' or 'human heart anatomy'"),
});

/** Generate a structured breakdown of any system/object for the 3D Holo-Lab. */
export async function POST(req: Request) {
  const { topic } = (await req.json()) as { topic?: string };
  if (!topic?.trim()) return NextResponse.json({ ok: false, error: "topic required" }, { status: 400 });

  const model = getModel("smart");
  if (!model) return NextResponse.json({ ok: false, error: "No model configured" }, { status: 400 });

  try {
    const { object } = await generateObject({
      model,
      schema,
      prompt: `Break down "${topic}" into its key components so someone can learn it visually, part by part, like an engineer studying an exploded diagram. Give the main parts/subsystems (5-14), each with a clear name, what it does, an importance (3 core, 1 peripheral), and which other named parts it connects to or interacts with. Then a step-by-step "how it works". Be accurate and specific to "${topic}".`,
    });
    // Log for the lab history (best-effort).
    db.from("Event").insert({ id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: "lab.generated", payload: { topic, title: object.title } }).then(() => {}, () => {});
    return NextResponse.json({ ok: true, data: object });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "generation failed";
    const quota = /quota|429|exhausted/i.test(msg);
    return NextResponse.json({ ok: false, error: quota ? "Daily AI quota reached — try again after it resets." : msg }, { status: 500 });
  }
}
