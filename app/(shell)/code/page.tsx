import type { Metadata } from "next";
import { CodeLab } from "@/features/coding/code-lab";

export const metadata: Metadata = { title: "Code" };
export const dynamic = "force-dynamic";

export default async function CodePage({ searchParams }: { searchParams: Promise<{ slug?: string }> }) {
  const { slug } = await searchParams;
  return <CodeLab {...(slug ? { slug } : {})} />;
}
