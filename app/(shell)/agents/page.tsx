import type { Metadata } from "next";
import { AgentView } from "@/features/agents/agent-view";

export const metadata: Metadata = {
  title: "Research Agent",
  description: "Research agents: ask a question, get a sourced answer.",
};

export default function AgentsPage() {
  return <AgentView />;
}
