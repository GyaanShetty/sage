import type { Metadata } from "next";
import { MailView } from "@/features/mail/mail-view";

export const metadata: Metadata = { title: "Mail" };
export const dynamic = "force-dynamic";

export default function MailPage() {
  return <MailView />;
}
