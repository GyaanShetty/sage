import type { Metadata } from "next";
import { AtlasPage } from "@/features/atlas/atlas-page";
// The map and pane classes live in these. A Next CSS import is global once a
// loaded route pulls it in, so a page that renders them without importing
// them is styled only when you arrive from somewhere that already did — and
// bare on a hard load.
import "@/features/dashboard/wall.css";
import "@/features/dashboard/command.css";

export const metadata: Metadata = {
  title: "Maps",
  description: "The map, full size, with the places SAGE tracks.",
};

export default function Page() {
  return <AtlasPage />;
}
