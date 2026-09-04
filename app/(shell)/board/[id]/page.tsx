import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBoard } from "@/core/board/store";
import { BoardCanvas } from "@/features/board/board-canvas";

export const metadata: Metadata = { title: "Board" };
export const dynamic = "force-dynamic";

export default async function BoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await getBoard(id);
  if (!doc) notFound();
  return <BoardCanvas initial={doc} />;
}
