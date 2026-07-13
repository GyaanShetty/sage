import {
  LayoutDashboard,
  MessageSquare,
  FolderKanban,
  BookOpen,
  Zap,
  Brain,
  Settings,
  Search,
  FileText,
  Mail,
  AlarmClock,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  group: "Actions" | "Navigate";
  /** Route to push, or a command id handled by the palette. */
  href?: string;
  command?: string;
}

/**
 * Static action index for Phase 0. Actions marked with `command` will be
 * wired to the orchestrator as features land (research, email, reminders…).
 */
export const PALETTE_ACTIONS: PaletteAction[] = [
  { id: "ask", label: "Ask SAGE…", hint: "free-form", icon: Sparkles, group: "Actions", href: "/chat" },
  { id: "research", label: "/research", hint: "deep-dive a topic", icon: Search, group: "Actions", command: "research" },
  { id: "summarize", label: "/summarize", hint: "summarize a source", icon: FileText, group: "Actions", command: "summarize" },
  { id: "email", label: "/email", hint: "draft an email", icon: Mail, group: "Actions", command: "email" },
  { id: "reminder", label: "/reminder", hint: "set a reminder", icon: AlarmClock, group: "Actions", command: "reminder" },
  { id: "create-project", label: "/create project", icon: FolderKanban, group: "Actions", command: "create-project" },

  { id: "nav-dashboard", label: "Dashboard", icon: LayoutDashboard, group: "Navigate", href: "/dashboard" },
  { id: "nav-chat", label: "Chat", icon: MessageSquare, group: "Navigate", href: "/chat" },
  { id: "nav-workspace", label: "Workspace", icon: FolderKanban, group: "Navigate", href: "/workspace" },
  { id: "nav-knowledge", label: "Knowledge", icon: BookOpen, group: "Navigate", href: "/knowledge" },
  { id: "nav-automations", label: "Automations", icon: Zap, group: "Navigate", href: "/automations" },
  { id: "nav-memory", label: "Memory", icon: Brain, group: "Navigate", href: "/memory" },
  { id: "nav-settings", label: "Settings", icon: Settings, group: "Navigate", href: "/settings" },
];
