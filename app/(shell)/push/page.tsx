import type { Metadata } from "next";
import { PushView } from "@/features/coding/push-view";

export const metadata: Metadata = { title: "Push" };
export const dynamic = "force-dynamic";

export default function PushPage() {
  return <PushView />;
}
