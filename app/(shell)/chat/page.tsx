import type { Metadata } from "next";
import { ComingSoon } from "@/components/ui/coming-soon";

export const metadata: Metadata = { title: "Chat" };

export default function ChatPage() {
  return <ComingSoon title="Chat" phase="Phase 1" />;
}
