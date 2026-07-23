import type { Metadata } from "next";
import { AgentView } from "@/features/agents/agent-view";

export const metadata: Metadata = { title: "Research Agent" };

export default function AgentsPage() {
  return <AgentView />;
}
