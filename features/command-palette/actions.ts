import {
  LayoutDashboard,
  MessageSquare,
  CandlestickChart,
  FolderKanban,
  BookOpen,
  Boxes,
  Network,
  Bot,
  Zap,
  Brain,
  Settings,
  Search,
  FileText,
  Mail,
  AlarmClock,
  Sparkles,
  Mic,
  Moon,
  Shapes,
  Hand,
  Sunrise,
  Briefcase,
  Wallet,
  GraduationCap,
  ScrollText,
  LogOut,
  type LucideIcon,
} from "lucide-react";

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  group: "Actions" | "Navigate" | "System";
  /** Extra words that should match this action in search. */
  keywords?: string;
  /** Route to push, or a command id handled by the palette. */
  href?: string;
  command?: string;
}

/**
 * Action index. `href` navigates; `command` runs a client-side handler in the
 * palette (voice, ambient, wake word) or pre-fills chat for the slash flows.
 */
export const PALETTE_ACTIONS: PaletteAction[] = [
  { id: "ask", label: "Ask SAGE…", hint: "free-form", icon: Sparkles, group: "Actions", href: "/chat" },
  { id: "voice", label: "Talk to SAGE", hint: "live voice", icon: Mic, group: "Actions", command: "voice" },
  { id: "brief", label: "Play morning brief", hint: "re-read it aloud", icon: Sunrise, group: "Actions", command: "morning-brief", keywords: "debrief briefing daily today news read aloud listen" },
  { id: "research", label: "/research", hint: "deep-dive a topic", icon: Search, group: "Actions", command: "research" },
  { id: "summarize", label: "/summarize", hint: "summarize a source", icon: FileText, group: "Actions", command: "summarize" },
  { id: "email", label: "/email", hint: "draft an email", icon: Mail, group: "Actions", command: "email" },
  { id: "reminder", label: "/reminder", hint: "set a reminder", icon: AlarmClock, group: "Actions", command: "reminder" },
  { id: "create-project", label: "/create project", icon: FolderKanban, group: "Actions", command: "create-project" },

  { id: "nav-dashboard", label: "Dashboard", icon: LayoutDashboard, group: "Navigate", href: "/dashboard" },
  { id: "nav-morning", label: "Morning Block", icon: Sunrise, group: "Navigate", href: "/morning" },
  { id: "nav-chat", label: "Chat", icon: MessageSquare, group: "Navigate", href: "/chat" },
  { id: "nav-markets", label: "Markets", icon: CandlestickChart, group: "Navigate", href: "/markets" },
  { id: "nav-career", label: "Career", icon: Briefcase, group: "Navigate", href: "/career" },
  { id: "nav-portfolio", label: "Portfolio", icon: Wallet, group: "Navigate", href: "/portfolio" },
  { id: "nav-workspace", label: "Workspace", icon: FolderKanban, group: "Navigate", href: "/workspace" },
  { id: "nav-knowledge", label: "Knowledge", icon: BookOpen, group: "Navigate", href: "/knowledge" },
  { id: "nav-lab", label: "Holo-Lab", icon: Boxes, group: "Navigate", href: "/lab" },
  { id: "nav-forge", label: "Forge", icon: Shapes, group: "Navigate", href: "/forge" },
  { id: "nav-graph", label: "Mind Graph", icon: Network, group: "Navigate", href: "/graph" },
  { id: "nav-agents", label: "Research Agent", icon: Bot, group: "Navigate", href: "/agents" },
  { id: "nav-automations", label: "Automations", icon: Zap, group: "Navigate", href: "/automations" },
  { id: "nav-report", label: "The Report", hint: "cross-domain review", icon: ScrollText, group: "Navigate", href: "/report", keywords: "weekly life summary patterns insights review" },
  { id: "nav-education", label: "Education", hint: "skill ledger", icon: GraduationCap, group: "Navigate", href: "/education", keywords: "skills dsa dbms learning study track level" },
  { id: "nav-review", label: "Review", icon: GraduationCap, group: "Navigate", href: "/review" },
  { id: "nav-memory", label: "Memory", icon: Brain, group: "Navigate", href: "/memory" },
  { id: "nav-settings", label: "Settings", icon: Settings, group: "Navigate", href: "/settings" },

  { id: "sys-wake", label: "Toggle wake word", hint: '"Hey Sage"', icon: Mic, group: "System", command: "toggle-wake" },
  { id: "sys-ambient", label: "Enter ambient mode", hint: "standby screen", icon: Moon, group: "System", command: "ambient-now" },
  { id: "sys-gesture", label: "Toggle gesture control", hint: "hands-free nav", icon: Hand, group: "System", command: "toggle-gesture" },
  { id: "sys-logout", label: "Log out", hint: "end this session", icon: LogOut, group: "System", command: "logout", keywords: "sign out signout lock exit leave" },
];
