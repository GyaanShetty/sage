import type { Metadata } from "next";
import { MailView } from "@/features/mail/mail-view";

export const metadata: Metadata = {
  title: "Mail",
  description: "Gmail and Outlook, read and summarised by SAGE.",
};
export const dynamic = "force-dynamic";

export default function MailPage() {
  return <MailView />;
}
