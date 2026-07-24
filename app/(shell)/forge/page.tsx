import type { Metadata } from "next";
import dynamic from "next/dynamic";

export const metadata: Metadata = { title: "Forge" };

// three.js is client-only.
const Forge = dynamic(() => import("@/features/forge/forge").then((m) => m.Forge));

export default function ForgePage() {
  return <Forge />;
}
