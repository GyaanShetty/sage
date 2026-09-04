import type { Metadata } from "next";
import { KnowledgeGraph } from "@/features/graph/knowledge-graph";

export const metadata: Metadata = {
  title: "Mind Graph",
  description: "Everything SAGE knows, as a graph you can walk.",
};

export default function GraphPage() {
  return <KnowledgeGraph />;
}
