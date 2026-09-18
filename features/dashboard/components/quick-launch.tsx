"use client";

/**
 * Quick launch: the places you go, as a grid you can hit without reading.
 *
 * Icons over labels rather than a list, because this is the panel you use
 * with a glance and a click — the same nine destinations in a column would be
 * indistinguishable from every other list on the wall.
 */

import Link from "next/link";
import {
  TerminalSquare, NotebookPen, Search, Map, CalendarDays, FolderKanban,
  Bot, Settings, Mail, type LucideIcon,
} from "lucide-react";
import { Pane } from "@/components/pane";
import { sound } from "@/lib/sound";

const STOPS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/terminal", label: "Terminal", icon: TerminalSquare },
  { href: "/notes", label: "Notebook", icon: NotebookPen },
  { href: "/counsel", label: "Research", icon: Search },
  { href: "/atlas", label: "Maps", icon: Map },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/workspace", label: "Files", icon: FolderKanban },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/mail", label: "Mail", icon: Mail },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function QuickLaunch({ n }: { n?: number }) {
  return (
    <Pane n={n} title="Quick Launch" status={`${STOPS.length}`}>
      <div className="qkl">
        {STOPS.map((s) => (
          <Link key={s.href} href={s.href} className="qkl-cell" onPointerEnter={() => sound.hover()}>
            <s.icon className="qkl-ico" strokeWidth={1.4} aria-hidden />
            <span>{s.label}</span>
          </Link>
        ))}
      </div>
    </Pane>
  );
}
