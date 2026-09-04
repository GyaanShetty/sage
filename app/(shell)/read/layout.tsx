import type { Metadata } from "next";

/**
 * /read is a client component, and a client component cannot export metadata —
 * so its tab has read "SAGE · Mission Control" since it shipped. A layout is
 * the supported way to give a client page a title.
 */
export const metadata: Metadata = {
  title: "Read",
  description: "Anything you send to SAGE, cleaned up and readable.",
};

export default function ReadLayout({ children }: { children: React.ReactNode }) {
  return children;
}
