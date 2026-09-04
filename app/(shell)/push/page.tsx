import type { Metadata } from "next";
import { PushView } from "@/features/coding/push-view";

export const metadata: Metadata = {
  title: "Push",
  description: "Notifications SAGE has sent, and what triggered them.",
};
export const dynamic = "force-dynamic";

export default function PushPage() {
  return <PushView />;
}
