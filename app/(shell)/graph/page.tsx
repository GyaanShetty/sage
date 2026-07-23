import type { Metadata } from "next";
import { KnowledgeGraph } from "@/features/graph/knowledge-graph";

export const metadata: Metadata = { title: "Mind Graph" };

export default function GraphPage() {
  return <KnowledgeGraph />;
}
