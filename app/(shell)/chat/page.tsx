import type { Metadata } from "next";
import { Suspense } from "react";
import { ChatPage } from "@/features/chat/chat-page";
import { startFreshThread } from "@/infrastructure/db/threads";

export const metadata: Metadata = { title: "Chat", description: "Ask SAGE anything." };
export const dynamic = "force-dynamic";

export default async function Page() {
  /*
   * A real thread, made on the server, not a UUID invented in the browser.
   *
   * My first pass generated the id client-side, which looked equivalent and
   * was not: nothing ever wrote the thread row, so every message hung off an
   * id with no parent. startFreshThread also reuses an already-empty thread
   * rather than creating another, so opening chat five times leaves one blank
   * thread behind instead of five.
   *
   * Fresh rather than resumed is deliberate and safe only because recall reads
   * the Memory table by relevance rather than reading the transcript back —
   * if that ever moved, starting clean would become real amnesia.
   */
  const thread = await startFreshThread();

  // useSearchParams needs a boundary, or the route opts out of static
  // rendering with a build-time error.
  return (
    <Suspense>
      <ChatPage threadId={thread.id} />
    </Suspense>
  );
}
