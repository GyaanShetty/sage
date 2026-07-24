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
  type LucideIcon,
} from "lucide-react";

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  group: "Actions" | "Navigate" | "System";
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
  { id: "research", label: "/research", hint: "deep-dive a topic", icon: Search, group: "Actions", command: "research" },
  { id: "summarize", label: "/summarize", hint: "summarize a source", icon: FileText, group: "Actions", command: "summarize" },
  { id: "email", label: "/email", hint: "draft an email", icon: Mail, group: "Actions", command: "email" },
  { id: "reminder", label: "/reminder", hint: "set a reminder", icon: AlarmClock, group: "Actions", command: "reminder" },
  { id: "create-project", label: "/create project", icon: FolderKanban, group: "Actions", command: "create-project" },

  { id: "nav-dashboard", label: "Dashboard", icon: LayoutDashboard, group: "Navigate", href: "/dashboard" },
  { id: "nav-chat", label: "Chat", icon: MessageSquare, group: "Navigate", href: "/chat" },
  { id: "nav-markets", label: "Markets", icon: CandlestickChart, group: "Navigate", href: "/markets" },
  { id: "nav-workspace", label: "Workspace", icon: FolderKanban, group: "Navigate", href: "/workspace" },
  { id: "nav-knowledge", label: "Knowledge", icon: BookOpen, group: "Navigate", href: "/knowledge" },
  { id: "nav-lab", label: "Holo-Lab", icon: Boxes, group: "Navigate", href: "/lab" },
  { id: "nav-graph", label: "Mind Graph", icon: Network, group: "Navigate", href: "/graph" },
  { id: "nav-agents", label: "Research Agent", icon: Bot, group: "Navigate", href: "/agents" },
  { id: "nav-automations", label: "Automations", icon: Zap, group: "Navigate", href: "/automations" },
  { id: "nav-memory", label: "Memory", icon: Brain, group: "Navigate", href: "/memory" },
  { id: "nav-settings", label: "Settings", icon: Settings, group: "Navigate", href: "/settings" },

  { id: "sys-wake", label: "Toggle wake word", hint: '"Hey Sage"', icon: Mic, group: "System", command: "toggle-wake" },
  { id: "sys-ambient", label: "Enter ambient mode", hint: "standby screen", icon: Moon, group: "System", command: "ambient-now" },
];
