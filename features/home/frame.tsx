"use client";

/**
 * The frame every page that is not Home sits in.
 *
 * One way back, one title, and the content. The old build gave each page its
 * own idea of a header — some had a numbered pane bar, some a section title
 * with a rule, some nothing at all — so moving between them felt like moving
 * between applications.
 */

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { APP_NAME } from "@/lib/config";

export function Frame({ title, action, children }: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="page">
      <header className="top">
        <Link href="/dashboard" className="back" aria-label={`Back to ${APP_NAME}`}>
          <ArrowLeft className="size-4" />
        </Link>
        <span className="mark top-mark">{APP_NAME}</span>
        <span className="top-title">{title}</span>
        {action && <span style={{ marginLeft: "auto" }}>{action}</span>}
      </header>
      {children}
    </div>
  );
}
