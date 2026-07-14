"use client";

import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Check, Loader2 } from "lucide-react";

export function NoteEditor({
  noteId,
  initialTitle,
  initialContent,
}: {
  noteId: string;
  initialTitle: string;
  initialContent: JSONContent;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = (patch: { title?: string; content?: JSONContent }) => {
    if (timer.current) clearTimeout(timer.current);
    setSaving("saving");
    timer.current = setTimeout(async () => {
      await fetch(`/api/note/${noteId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      setSaving("saved");
      setTimeout(() => setSaving("idle"), 1200);
    }, 700);
  };

  const editor = useEditor({
    extensions: [StarterKit],
    content: initialContent,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "prose-invert min-h-[50vh] outline-none text-[15px] leading-relaxed " +
          "[&_h1]:text-xl [&_h1]:font-semibold [&_h1]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-3 " +
          "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 " +
          "[&_blockquote]:border-l-2 [&_blockquote]:border-border-glass-strong [&_blockquote]:pl-3 [&_blockquote]:text-muted " +
          "[&_code]:rounded [&_code]:bg-glass-strong [&_code]:px-1 [&_code]:font-mono [&_code]:text-[13px] " +
          "[&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border-glass [&_pre]:bg-glass [&_pre]:p-3 [&_p]:my-1.5",
      },
    },
    onUpdate: ({ editor }) => save({ content: editor.getJSON() }),
  });

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <div>
      <div className="flex items-center gap-3">
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            save({ title: e.target.value });
          }}
          placeholder="Untitled"
          className="flex-1 bg-transparent text-xl font-semibold tracking-tight outline-none placeholder:text-subtle"
        />
        <span className="text-subtle">
          {saving === "saving" && <Loader2 className="size-4 animate-spin" />}
          {saving === "saved" && <Check className="size-4 text-accent" />}
        </span>
      </div>
      <div className="mt-4">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
