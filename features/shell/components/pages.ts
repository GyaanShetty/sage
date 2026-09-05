import {
  Gauge,
  LayoutDashboard, Sunrise, MessageSquare, CandlestickChart, Briefcase, Wallet,
  FolderKanban, BookOpen, GraduationCap, Zap, Brain, Network, Bot, PenLine, LayoutGrid,
  Settings, Activity, ScrollText, BookMarked, Mail, Code2,
  Scale, GitBranch, Radio, FileSearch, CalendarDays, FileText, Mic, Lightbulb, Timer, type LucideIcon,
} from "lucide-react";

/**
 * The one list of pages.
 *
 * The wheel and the search launcher are two views of the same thing, and when
 * each kept its own copy the two drifted — a page added to one was missing
 * from the other, which is how /read ended up reachable from neither.
 */
export interface Item { href: string; label: string; icon: LucideIcon; hint?: string; group: string }

export const PAGES: Item[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, hint: "command", group: "NOW" },
  { href: "/ops", label: "Ops", icon: Gauge, hint: "page two", group: "NOW" },
  { href: "/sitrep", label: "Sitrep", icon: Radio, hint: "live status", group: "NOW" },
  { href: "/morning", label: "Morning", icon: Sunrise, hint: "the block", group: "NOW" },
  { href: "/calendar", label: "Calendar", icon: CalendarDays, hint: "week · month", group: "NOW" },
  { href: "/chat", label: "Chat", icon: MessageSquare, group: "NOW" },
  { href: "/capture", label: "Capture", icon: Mic, hint: "talk · screenshot", group: "NOW" },
  { href: "/agents", label: "Agent", icon: Bot, hint: "runs", group: "NOW" },

  { href: "/workspace", label: "Workspace", icon: FolderKanban, hint: "tasks", group: "WORK" },
  { href: "/career", label: "Career", icon: Briefcase, hint: "applications", group: "WORK" },
  { href: "/mail", label: "Mail", icon: Mail, group: "WORK" },
  { href: "/code", label: "Code", icon: Code2, hint: "lab", group: "WORK" },
  { href: "/push", label: "Push", icon: GitBranch, hint: "to github", group: "WORK" },
  { href: "/automations", label: "Automations", icon: Zap, group: "WORK" },

  { href: "/portfolio", label: "Portfolio", icon: Wallet, hint: "budget", group: "MONEY" },
  { href: "/markets", label: "Markets", icon: CandlestickChart, group: "MONEY" },

  { href: "/decisions", label: "Decisions", icon: Scale, hint: "calibration", group: "JUDGEMENT" },
  { href: "/counsel", label: "Counsel", icon: FileSearch, hint: "dossier · what-if", group: "JUDGEMENT" },
  { href: "/review", label: "Review", icon: BookMarked, hint: "weekly", group: "JUDGEMENT" },
  { href: "/report", label: "Report", icon: ScrollText, hint: "life", group: "JUDGEMENT" },

  { href: "/knowledge", label: "Knowledge", icon: BookOpen, hint: "sources · papers", group: "MIND" },
  { href: "/read", label: "Read", icon: FileText, hint: "research", group: "MIND" },
  { href: "/education", label: "Education", icon: GraduationCap, hint: "study", group: "MIND" },
  { href: "/explain", label: "Explain", icon: Lightbulb, hint: "feynman loop", group: "MIND" },
  { href: "/exam", label: "Exams", icon: Timer, hint: "countdown · practice", group: "MIND" },
  { href: "/memory", label: "Memory", icon: Brain, group: "MIND" },
  { href: "/graph", label: "Mind Graph", icon: Network, group: "MIND" },
  { href: "/board", label: "Boards", icon: PenLine, hint: "draw · note · attach", group: "MIND" },
  { href: "/deck", label: "Deck", icon: LayoutGrid, hint: "the mark, and an ask bar", group: "MIND" },
  { href: "/health", label: "Health", icon: Activity, group: "MIND" },

  { href: "/settings", label: "Settings", icon: Settings, group: "MIND" },
];

// MAKE went with the Holo-Lab and the Forge; Settings moved to MIND rather
// than leaving a heading over a single item.
export const GROUP_ORDER = ["NOW", "WORK", "MONEY", "JUDGEMENT", "MIND"] as const;

/** Words people use that are not the page's name. */
export const ALIASES: Record<string, string> = {
  task: "/workspace", todo: "/workspace", work: "/workspace",
  money: "/portfolio", stock: "/markets", crypto: "/markets", invest: "/portfolio",
  budget: "/portfolio", expense: "/portfolio", spend: "/portfolio",
  job: "/career", intern: "/career", application: "/career",
  note: "/knowledge", doc: "/knowledge", paper: "/knowledge", learn: "/education",
  sleep: "/health", steps: "/health", workout: "/health", gym: "/health", body: "/health",
  home: "/dashboard", main: "/dashboard", status: "/sitrep", situation: "/sitrep",
  decision: "/decisions", call: "/decisions", bet: "/decisions", calibration: "/decisions",
  dossier: "/counsel", about: "/counsel", simulate: "/counsel",
  git: "/push", github: "/push", commit: "/push", dsa: "/push", solution: "/push",
  schedule: "/calendar", month: "/calendar", diary: "/calendar", timetable: "/calendar",
  inbox: "/mail", email: "/mail", research: "/read", brief: "/read",
  capture: "/capture", dictate: "/capture", voice: "/capture", screenshot: "/capture",
  ramble: "/capture", jot: "/capture",
  explain: "/explain", feynman: "/explain", understand: "/explain", teach: "/explain",
  exam: "/exam", test: "/exam", revision: "/exam", syllabus: "/exam", countdown: "/exam",
};
