"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { X, Search, CornerDownLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { sound } from "@/lib/sound";
import "./launcher.css";

/**
 * The launcher.
 *
 * This was a rotary wheel, and the wheel was genuinely good at twelve pages:
 * one gesture, everything visible at once, a nice piece of theatre. At
 * twenty-six it stopped working — the labels collided into an unreadable band
 * through the middle, and spinning to a target whose label you can no longer
 * read is not a shortcut, it is a hunt.
 *
 * Removing the labels fixed the collision and made the real problem worse:
 * twenty-six unlabelled dots is a memory test. So the shape changes rather
 * than the styling. A grouped, labelled grid stays legible at twenty-six,
 * survives the next ten pages, and reads the same on a phone as on a desktop.
 *
 * The keyboard is the fast path and the grid is the discoverable one: typing
 * filters immediately with no field to aim at first, arrows move, Enter opens.
 * Everything the wheel responded to — the voice events, the gesture bus — it
 * still responds to.
 */

import { PAGES, GROUP_ORDER, ALIASES, type Item } from "./pages";

/** A thing, rather than a page — a task, a note, a memory, a holding. */
interface Hit { kind: string; id: string; title: string; subtitle?: string; href: string; at?: string | null }

const ALL: Item[] = PAGES;
const GROUPS = GROUP_ORDER.map((name) => ({ name, items: PAGES.filter((p) => p.group === name) }));

function score(item: Item, q: string): number {
  const label = item.label.toLowerCase();
  const slug = item.href.slice(1).toLowerCase();
  if (label === q || slug === q) return 100;
  if (label.startsWith(q) || slug.startsWith(q)) return 80;
  if (label.includes(q) || slug.includes(q)) return 60;
  if (item.hint?.toLowerCase().includes(q)) return 40;
  // Aliases last: a real name should always beat a synonym.
  for (const [word, href] of Object.entries(ALIASES)) {
    if (href === item.href && word.startsWith(q)) return 30;
  }
  return 0;
}

export function Launcher() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  /**
   * Content results.
   *
   * A launcher that only finds pages makes you remember which page a thing is
   * on — which for a note written four months ago is exactly the thing you
   * cannot do. The search across tasks, notes, memories, holdings,
   * applications, workouts and expenses already existed and had no home; this
   * is it.
   */
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  const openRef = useRef(open);
  openRef.current = open;

  /** Matches, best first. Empty query keeps the grouped order. */
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ALL;
    return ALL
      .map((item) => ({ item, s: score(item, q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.item);
  }, [query]);

  const filtering = query.trim().length > 0;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const matchesRef = useRef(matches);
  matchesRef.current = matches;

  const go = useCallback((href: string) => {
    sound.blip?.();
    setOpen(false);
    setQuery("");
    setCursor(0);
    setHits([]);
    if (!pathname.startsWith(href)) router.push(href);
  }, [pathname, router]);

  // A new query means a new list; the cursor must not point into the old one.
  useEffect(() => { setCursor(0); }, [query]);

  /**
   * Content search, debounced.
   *
   * Two characters is the floor the API itself uses, and 180ms is long enough
   * that typing a word is one request rather than five — this runs on every
   * keystroke of a box that is open constantly.
   */
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setHits([]); setSearching(false); return; }

    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      const j = await fetch(`/api/search?q=${encodeURIComponent(q)}`).then((r) => r.json()).catch(() => null);
      if (cancelled) return;
      setHits(j?.ok ? (j.data as Hit[]).slice(0, 8) : []);
      setSearching(false);
    }, 180);

    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  useEffect(() => {
    if (open) {
      setCursor(Math.max(0, ALL.findIndex((i) => pathname.startsWith(i.href))));
      // Focused on open so typing works immediately, which is the entire point
      // of a launcher.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const list = matchesRef.current;
      if (e.key === "Escape") {
        // Clear a query before closing: a typo should not cost the launcher.
        if (query) { setQuery(""); return; }
        setOpen(false);
      } else if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
        e.preventDefault();
        setCursor((c) => (c + 1) % list.length);
      } else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
        e.preventDefault();
        setCursor((c) => (c - 1 + list.length) % list.length);
      } else if (e.key === "ArrowRight") {
        setCursor((c) => Math.min(list.length - 1, c + 1));
      } else if (e.key === "ArrowLeft") {
        setCursor((c) => Math.max(0, c - 1));
      } else if (e.key === "Enter") {
        const target = list[cursorRef.current];
        if (target) go(target.href);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, query, go]);

  /**
   * The bus the old wheel answered to.
   *
   * Voice navigation, the gesture layer and anything else that opens the
   * launcher all speak through these events, so they are kept exactly as they
   * were — replacing the interface must not silently remove a way in.
   */
  useEffect(() => {
    const onOpen = () => { sound.swoosh?.(); setOpen(true); };
    const onClose = () => setOpen(false);

    const onNav = (e: Event) => {
      const q = String((e as CustomEvent).detail ?? "").trim().toLowerCase();
      if (!q) return;
      const best = ALL
        .map((item) => ({ item, s: score(item, q) }))
        .sort((a, b) => b.s - a.s)[0];
      if (!best || best.s === 0) return;
      setOpen(true);
      // Shown briefly so the jump is visible rather than teleporting.
      setQuery(q);
      window.setTimeout(() => go(best.item.href), 420);
    };

    const onRotate = (e: Event) => {
      const steps = (e as CustomEvent<{ steps?: number }>).detail?.steps ?? 0;
      setCursor((c) => {
        const n = matchesRef.current.length;
        return ((c + steps) % n + n) % n;
      });
    };
    const onSelect = () => {
      if (!openRef.current) return;
      const target = matchesRef.current[cursorRef.current];
      if (target) go(target.href);
    };

    window.addEventListener("sage:open-wheel", onOpen);
    window.addEventListener("sage:nav-open", onOpen);
    window.addEventListener("sage:nav-close", onClose);
    window.addEventListener("sage:nav-rotate", onRotate);
    window.addEventListener("sage:nav-select", onSelect);
    window.addEventListener("sage:navigate", onNav as EventListener);
    return () => {
      window.removeEventListener("sage:open-wheel", onOpen);
      window.removeEventListener("sage:nav-open", onOpen);
      window.removeEventListener("sage:nav-close", onClose);
      window.removeEventListener("sage:nav-rotate", onRotate);
      window.removeEventListener("sage:nav-select", onSelect);
      window.removeEventListener("sage:navigate", onNav as EventListener);
    };
  }, [go]);

  // ⌘K / Ctrl-K from anywhere, the shortcut everyone already knows.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((s) => !s);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const indexOf = (item: Item) => matches.indexOf(item);

  const Tile = ({ item }: { item: Item }) => {
    const i = indexOf(item);
    const active = i === cursor;
    const here = pathname.startsWith(item.href);
    const Icon = item.icon;
    return (
      <button
        key={item.href}
        onClick={() => go(item.href)}
        onMouseEnter={() => setCursor(i)}
        className={cn("lx-tile", active && "active", here && "here")}
      >
        <Icon className="size-[18px]" strokeWidth={1.6} />
        <span className="lx-label">{item.label}</span>
        {item.hint && <span className="lx-hint">{item.hint}</span>}
      </button>
    );
  };

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] overflow-y-auto bg-background/85 backdrop-blur-2xl"
            onClick={() => setOpen(false)}
          >
            <motion.div
              initial={{ y: -12, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -8, opacity: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 30 }}
              className="lx-shell"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="lx-search">
                <Search className="size-4 shrink-0 text-subtle" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Go to…"
                  spellCheck={false}
                  autoComplete="off"
                />
                <span className="lx-count">
                  {filtering ? `${matches.length} of ${ALL.length}` : `${ALL.length} pages`}
                </span>
                <button onClick={() => setOpen(false)} className="lx-close" aria-label="Close">
                  <X className="size-4" />
                </button>
              </div>

              {/* Filtered: one flat list, best match first — groups would only
                  scatter three results across six headings. */}
              {filtering ? (
                matches.length === 0 ? (
                  hits.length === 0 && !searching
                    ? <p className="lx-empty">Nothing matches &ldquo;{query}&rdquo;.</p>
                    : null
                ) : (
                  <div className="lx-grid">{matches.map((item) => <Tile key={item.href} item={item} />)}</div>
                )
              ) : (
                GROUPS.map((g) => (
                  <div key={g.name} className="lx-group">
                    <span className="lx-groupname">{g.name}</span>
                    <div className="lx-grid">{g.items.map((item) => <Tile key={item.href} item={item} />)}</div>
                  </div>
                ))
              )}

              {/* Things, under pages. Pages first because they are the
                  predictable half — a launcher that reorders itself around
                  search results becomes impossible to use by muscle memory. */}
              {filtering && (hits.length > 0 || searching) && (
                <div className="lx-group">
                  <span className="lx-groupname">
                    IN YOUR DATA {searching && <i className="lx-searching">searching…</i>}
                  </span>
                  <div className="lx-hits">
                    {hits.map((h) => (
                      <button key={`${h.kind}-${h.id}`} onClick={() => go(h.href)} className="lx-hit">
                        <span className="lx-hitkind">{h.kind}</span>
                        <span className="lx-hittext">
                          <b>{h.title}</b>
                          {h.subtitle && <i>{h.subtitle}</i>}
                        </span>
                        {h.at && (
                          <span className="lx-hitwhen">
                            {new Date(h.at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <p className="lx-foot">
                <b>type</b> to filter · <b>↑↓</b> move · <b><CornerDownLeft className="inline size-3" /></b> open · <b>esc</b> close
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
