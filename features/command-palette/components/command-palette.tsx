"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Command } from "cmdk";
import { paletteIn } from "@/lib/motion";
import { useShellStore } from "@/features/shell/store";
import { PALETTE_ACTIONS, type PaletteAction } from "../actions";

export function CommandPalette() {
  const open = useShellStore((s) => s.paletteOpen);
  const setOpen = useShellStore((s) => s.setPaletteOpen);
  const router = useRouter();
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(!useShellStore.getState().paletteOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  const run = (action: PaletteAction) => {
    setOpen(false);
    if (action.id === "ask" && query.trim()) {
      router.push(`/chat?ask=${encodeURIComponent(query.trim())}`);
    } else if (action.href) {
      router.push(action.href);
    } else if (action.command) {
      // `command` actions pre-fill chat until their dedicated flows land
      router.push(`/chat?ask=${encodeURIComponent("/" + action.command + " ")}`);
    }
    setQuery("");
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[18vh] backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <motion.div
            variants={paletteIn}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="w-full max-w-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <Command
              label="Command palette"
              className="overflow-hidden rounded-xl border border-border-glass-strong bg-zinc-950/90 shadow-2xl backdrop-blur-2xl"
            >
              <Command.Input
                autoFocus
                value={query}
                onValueChange={setQuery}
                placeholder="Type a command or ask anything…"
                className="h-14 w-full border-b border-border-glass bg-transparent px-5 text-[15px] text-foreground outline-none placeholder:text-subtle"
              />
              <Command.List className="max-h-80 overflow-y-auto p-2">
                <Command.Empty className="py-8 text-center text-sm text-subtle">
                  No results.
                </Command.Empty>
                {(["Actions", "Navigate"] as const).map((group) => (
                  <Command.Group
                    key={group}
                    heading={group}
                    className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-subtle"
                  >
                    {PALETTE_ACTIONS.filter((a) => a.group === group).map((action) => (
                      <Command.Item
                        key={action.id}
                        value={action.label}
                        onSelect={() => run(action)}
                        className="flex h-10 cursor-pointer items-center gap-3 rounded-lg px-3 text-sm text-muted data-[selected=true]:bg-glass-strong data-[selected=true]:text-foreground"
                      >
                        <action.icon className="size-4 shrink-0" strokeWidth={1.75} />
                        <span>{action.label}</span>
                        {action.hint && (
                          <span className="ml-auto text-xs text-subtle">{action.hint}</span>
                        )}
                      </Command.Item>
                    ))}
                  </Command.Group>
                ))}
              </Command.List>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
