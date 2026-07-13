import type { Metadata } from "next";
import { ChatView } from "@/features/chat/components/chat-view";
import { getOrCreateLatestThread, loadThreadMessages } from "@/infrastructure/db/threads";

export const metadata: Metadata = { title: "Chat" };
export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const thread = await getOrCreateLatestThread();
  const initialMessages = await loadThreadMessages(thread.id);
  return <ChatView threadId={thread.id} initialMessages={initialMessages} />;
}
