"use client";

/**
 * The left rail.
 *
 * SAGE navigated by a radial wheel and a row of function keys — both fast
 * once learned and both invisible until you knew they were there. The rail
 * puts the eight places you actually live on the screen permanently, which is
 * what the reference does and what makes it read as a terminal rather than a
 * page.
 *
 * Eight destinations, not thirty. Everything else stays reachable through
 * the command palette; a rail that lists every page is a menu, and a menu is
 * the thing this replaces.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home, LineChart, Radar, Map, ListTodo, Bot, Database, SlidersHorizontal, CircleUser,
  type LucideIcon,
} from "lucide-react";
import { APP_NAME } from "@/lib/config";
import { sound } from "@/lib/sound";

interface Stop { href: string; label: string; icon: LucideIcon }

/*
 * The label is the page's own name, not a second one.
 *
 * These read INTEL, TASKS, DATA and SYSTEM when the pages they open are
 * called Sitrep, Workspace, Memory and Settings. Two names for one place is a
 * thing you have to learn instead of read, and it makes the rail and every
 * other route into the app disagree.
 */
const STOPS: Stop[] = [
  { href: "/dashboard", label: "COMMAND", icon: Home },
  { href: "/markets", label: "MARKETS", icon: LineChart },
  { href: "/sitrep", label: "SITREP", icon: Radar },
  { href: "/atlas", label: "MAPS", icon: Map },
  { href: "/workspace", label: "WORKSPACE", icon: ListTodo },
  { href: "/agents", label: "AGENT", icon: Bot },
  { href: "/memory", label: "MEMORY", icon: Database },
  { href: "/settings", label: "SETTINGS", icon: SlidersHorizontal },
];

export function NavRail() {
  const path = usePathname();

  return (
    <nav className="rail" aria-label="Primary">
      <Link href="/dashboard" className="rail-mark" aria-label="SAGE home">
        <span className="rail-ring" aria-hidden />
      </Link>

      <ul className="rail-list">
        {STOPS.map((s) => {
          const on = path === s.href || path.startsWith(`${s.href}/`);
          return (
            <li key={s.href}>
              <Link
                href={s.href}
                className={`rail-stop${on ? " on" : ""}`}
                aria-current={on ? "page" : undefined}
                /* The visible label is display:none below 900px, which hides
                   it from assistive tech too — leaving eight unlabelled
                   icons. The name belongs on the link either way. */
                aria-label={s.label}
                onPointerEnter={() => sound.hover()}
              >
                <s.icon className="rail-ico" strokeWidth={1.5} aria-hidden />
                <span className="rail-lbl">{s.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="rail-foot">
        <Link href="/settings" className="rail-stop" aria-label="Profile" onPointerEnter={() => sound.hover()}>
          <CircleUser className="rail-ico" strokeWidth={1.5} aria-hidden />
          <span className="rail-lbl">PROFILE</span>
        </Link>
        <span className="rail-ver">{APP_NAME}<br />v0.2</span>
      </div>
    </nav>
  );
}
