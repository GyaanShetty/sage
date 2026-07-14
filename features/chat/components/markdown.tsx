"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Assistant message renderer — styled for the pure-black glass theme. */
export const Markdown = memo(function Markdown({ children }: { children: string }) {
  return (
    <div
      className="[&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2
        [&_blockquote]:border-l-2 [&_blockquote]:border-border-glass-strong [&_blockquote]:pl-3 [&_blockquote]:text-muted
        [&_code]:rounded [&_code]:bg-glass-strong [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px]
        [&_h1]:mt-4 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:font-medium
        [&_hr]:my-4 [&_hr]:border-border-glass
        [&_li]:my-1 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5
        [&_p]:my-2 first:[&_p]:mt-0 last:[&_p]:mb-0
        [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border-glass [&_pre]:bg-glass [&_pre]:p-3
        [&_pre_code]:bg-transparent [&_pre_code]:p-0
        [&_table]:my-3 [&_table]:w-full [&_td]:border [&_td]:border-border-glass [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border-glass [&_th]:px-2 [&_th]:py-1 [&_th]:text-left"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
});
