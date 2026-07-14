import type { Metadata } from "next";
import { ChatView } from "@/features/chat/components/chat-view";
import { ThreadList } from "@/features/chat/components/thread-list";
import {
  getOrCreateLatestThread,
  getThread,
  listThreads,
  loadThreadMessages,
} from "@/infrastructure/db/threads";

export const metadata: Metadata = { title: "Chat" };
export const dynamic = "force-dynamic";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;
  const thread = (t ? await getThread(t) : null) ?? (await getOrCreateLatestThread());
  const [threads, initialMessages] = await Promise.all([
    listThreads(),
    loadThreadMessages(thread.id),
  ]);
  return (
    <div className="flex h-full">
      <ThreadList threads={threads} activeId={thread.id} />
      <div className="min-w-0 flex-1">
        <ChatView key={thread.id} threadId={thread.id} initialMessages={initialMessages} />
      </div>
    </div>
  );
}
