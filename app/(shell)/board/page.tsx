import type { Metadata } from "next";
import { listBoards } from "@/core/board/store";
import { BoardIndex } from "@/features/board/board-index";

export const metadata: Metadata = { title: "Boards" };
export const dynamic = "force-dynamic";

export default async function BoardsPage() {
  return <BoardIndex initial={await listBoards()} />;
}
