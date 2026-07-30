"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Command } from "cmdk";
import { paletteIn } from "@/lib/motion";
import { useShellStore } from "@/features/shell/store";
import { PALETTE_ACTIONS, type PaletteAction } from "../actions";
import {
  CheckSquare, FileText, Brain, Wallet, Briefcase, Dumbbell, Receipt, Loader2,
} from "lucide-react";

interface SearchHit {
  kind: "task" | "note" | "memory" | "holding" | "career" | "workout" | "expense";
  id: string; title: string; subtitle?: string; href: string;
}
const KIND_ICON = {
  task: CheckSquare, note: FileText, memory: Brain, holding: Wallet,
  career: Briefcase, workout: Dumbbell, expense: Receipt,
} as const;

export function CommandPalette() {
  const open = useShellStore((s) => s.paletteOpen);
  const setOpen = useShellStore((s) => s.setPaletteOpen);
  const router = useRouter();
  const [query, setQuery] = useState("");
  // unified search across tasks, notes, memory, holdings, career, health, spend
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const q = query.trim();
    if (q.length < 2) { setHits([]); setSearching(false); return; }
    setSearching(true);
    timer.current = setTimeout(async () => {
      const mine = ++seq.current;
      const j = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
        .then((r) => r.json()).catch(() => null);
      // ignore a slow response that lost the race to a newer keystroke
      if (mine !== seq.current) return;
      setHits(j?.data ?? []);
      setSearching(false);
    }, 180);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [query]);

  const openHit = useCallback((h: SearchHit) => {
    setOpen(false);
    setQuery("");
    setHits([]);
    router.push(h.href);
  }, [router, setOpen]);


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

  const setWakeWord = useShellStore((s) => s.setWakeWord);
  const setGestureNav = useShellStore((s) => s.setGestureNav);

  const run = (action: PaletteAction) => {
    setOpen(false);
    if (action.id === "ask" && query.trim()) {
      router.push(`/chat?ask=${encodeURIComponent(query.trim())}`);
    } else if (action.command === "voice") {
      window.dispatchEvent(new CustomEvent("sage:engage-voice"));
    } else if (action.command === "toggle-wake") {
      setWakeWord(!useShellStore.getState().wakeWord);
    } else if (action.command === "toggle-gesture") {
      setGestureNav(!useShellStore.getState().gestureNav);
    } else if (action.command === "morning-brief") {
      window.dispatchEvent(new CustomEvent("sage:replay-brief"));
    } else if (action.command === "ambient-now") {
      window.dispatchEvent(new CustomEvent("sage:ambient-now"));
    } else if (action.href) {
      router.push(action.href);
    } else if (action.command) {
      // Slash flows pre-fill chat until their dedicated UIs land.
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
                  {searching
                    ? <span className="inline-flex items-center gap-2"><Loader2 className="size-3.5 animate-spin" /> searching your data…</span>
                    : "No results."}
                </Command.Empty>
                {hits.length > 0 && (
                  <Command.Group
                    heading={searching ? "Searching…" : "Your data"}
                    className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-subtle"
                  >
                    {hits.map((h) => {
                      const Icon = KIND_ICON[h.kind];
                      return (
                        <Command.Item
                          key={`${h.kind}-${h.id}`}
                          value={`${h.title} ${h.subtitle ?? ""} ${h.kind}`}
                          onSelect={() => openHit(h)}
                          className="flex h-11 cursor-pointer items-center gap-3 rounded-lg px-3 text-sm text-muted data-[selected=true]:bg-glass-strong data-[selected=true]:text-foreground"
                        >
                          <Icon className="size-4 shrink-0" strokeWidth={1.75} />
                          <span className="truncate">{h.title}</span>
                          {h.subtitle && (
                            <span className="ml-auto shrink-0 max-w-[45%] truncate text-xs text-subtle">{h.subtitle}</span>
                          )}
                        </Command.Item>
                      );
                    })}
                  </Command.Group>
                )}
                {(["Actions", "Navigate", "System"] as const).map((group) => (
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
