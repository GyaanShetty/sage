import type { Metadata } from "next";
import { ChatView } from "@/features/chat/components/chat-view";
import { ThreadList } from "@/features/chat/components/thread-list";
import {
  createThread,
  startFreshThread,
  getThread,
  listThreads,
  loadThreadMessages,
} from "@/infrastructure/db/threads";

export const metadata: Metadata = {
  title: "Chat",
  description: "Talk to SAGE with everything it knows about you already loaded.",
};
export const dynamic = "force-dynamic";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string; ask?: string }>;
}) {
  const { t, ask } = await searchParams;
  // Palette "Ask" always lands in a fresh thread; `?t=` opens a specific past thread; anything else starts clean. See
  // startFreshThread — the memory is in the Memory table, not the scrollback.
  const thread = ask
    ? await createThread()
    : ((t ? await getThread(t) : null) ?? (await startFreshThread()));
  const [threads, initialMessages] = await Promise.all([
    listThreads(),
    loadThreadMessages(thread.id),
  ]);
  return (
    <div className="flex h-full">
      <ThreadList threads={threads} activeId={thread.id} />
      <div className="min-w-0 flex-1">
        <ChatView
          key={thread.id}
          threadId={thread.id}
          initialMessages={initialMessages}
          initialAsk={ask}
        />
      </div>
    </div>
  );
}
