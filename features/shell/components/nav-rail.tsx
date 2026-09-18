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

const STOPS: Stop[] = [
  { href: "/dashboard", label: "HOME", icon: Home },
  { href: "/markets", label: "MARKETS", icon: LineChart },
  { href: "/sitrep", label: "INTEL", icon: Radar },
  { href: "/atlas", label: "MAPS", icon: Map },
  { href: "/workspace", label: "TASKS", icon: ListTodo },
  { href: "/agents", label: "AGENTS", icon: Bot },
  { href: "/memory", label: "DATA", icon: Database },
  { href: "/settings", label: "SYSTEM", icon: SlidersHorizontal },
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
        <Link href="/settings" className="rail-stop" onPointerEnter={() => sound.hover()}>
          <CircleUser className="rail-ico" strokeWidth={1.5} aria-hidden />
          <span className="rail-lbl">PROFILE</span>
        </Link>
        <span className="rail-ver">{APP_NAME}<br />v0.2</span>
      </div>
    </nav>
  );
}
