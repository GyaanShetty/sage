import { streamText } from "ai";
import { getModel } from "@/infrastructure/llm";
import { HUMAN_RULES } from "@/lib/config";
import { getThread, listMessages, addMessage, fileBytes, readability } from "@/core/research/workspace";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Room for the documents in one prompt, before the conversation is added. */
const TEXT_BUDGET = 60_000;
/** Images are expensive; a handful is a question, twenty is a bill. */
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/**
 * Answer a question about the files in a workspace.
 *
 * Text and PDFs go in as extracted text — done once at upload, not per
 * question. Images go in as images, because describing a whiteboard photo in
 * words first would throw away exactly what was worth uploading.
 *
 * Streamed, because a grounded answer over a long document takes long enough
 * that a spinner would be the whole experience.
 */
export async function POST(req: Request) {
  const { threadId, question } = (await req.json().catch(() => ({}))) as
    { threadId?: string; question?: string };

  if (!threadId || !question?.trim()) {
    return Response.json({ ok: false, error: "threadId and question required" }, { status: 400 });
  }

  const thread = await getThread(threadId);
  if (!thread) return Response.json({ ok: false, error: "No such thread." }, { status: 404 });

  const model = getModel("smart") ?? getModel("fast");
  if (!model) return Response.json({ ok: false, error: "No model available right now." }, { status: 503 });

  await addMessage(threadId, "user", question.trim());
  const history = await listMessages(threadId);

  // ── the documents ────────────────────────────────────────────────────
  const readable = thread.attachments.filter((a) => a.text?.trim());
  let budget = TEXT_BUDGET;
  const docs: string[] = [];
  for (const a of readable) {
    if (budget <= 0) break;
    const slice = (a.text as string).slice(0, Math.min(budget, 25_000));
    budget -= slice.length;
    docs.push(`--- ${a.name} ---\n${slice}`);
  }

  // Files that exist but could not be read are named anyway. Silently omitting
  // them makes SAGE look like it ignored a file he uploaded on purpose.
  const unreadable = thread.attachments
    .filter((a) => !a.text?.trim() && readability(a.mime, a.name) !== "image")
    .map((a) => `${a.name} (${a.note ?? "not readable"})`);

  // ── the images ───────────────────────────────────────────────────────
  const images: { type: "image"; image: Buffer }[] = [];
  for (const a of thread.attachments) {
    if (images.length >= MAX_IMAGES) break;
    if (readability(a.mime, a.name) !== "image") continue;
    if (a.size > MAX_IMAGE_BYTES) continue;
    const bytes = await fileBytes(a.path).catch(() => null);
    if (bytes) images.push({ type: "image", image: bytes });
  }

  const system =
    `You are SAGE, Gyaan's chief of staff, working through his own documents with him. ${HUMAN_RULES} ` +
    "Answer from the material given, and quote or cite the file name when you use it. " +
    "If the answer is not in the files, say so and then answer from general knowledge, marked as such — " +
    "the distinction between 'your notes say' and 'in general' is the entire value here. " +
    "Never invent a figure that is not in the documents.";

  const context = [
    docs.length ? `Documents in this workspace:\n\n${docs.join("\n\n")}` : "No readable documents attached.",
    unreadable.length ? `\nAlso attached but unreadable: ${unreadable.join("; ")}.` : "",
    images.length ? `\n${images.length} image(s) are attached and shown to you directly.` : "",
  ].join("\n");

  const result = streamText({
    model,
    system,
    messages: [
      { role: "user", content: context },
      ...history.slice(-12, -1).map((m) => ({ role: m.role, content: m.content })),
      {
        role: "user",
        content: images.length
          ? [{ type: "text" as const, text: question.trim() }, ...images]
          : question.trim(),
      },
    ],
    onFinish: async ({ text }) => {
      // Persisted after the stream so the thread survives a reload; a failed
      // stream deliberately saves nothing rather than half an answer.
      if (text.trim()) await addMessage(threadId, "assistant", text).catch(() => undefined);
    },
  });

  return result.toTextStreamResponse();
}
