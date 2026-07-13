# 05 — UI: Wireframes, Components, State, Motion

## 1. Shell Layout

```
┌──┬───────────────────────────────────────────────┬──────────┐
│  │  ⌘K ······ Command Palette (overlay) ······   │          │
│ S│                                               │  Context │
│ i│                MAIN VIEW                      │  Panel   │
│ d│   Dashboard / Chat / Workspace / Knowledge    │ (agent   │
│ e│                                               │  steps,  │
│ b│                                               │  sources,│
│ a│                                               │  memory) │
│ r│                                               │ optional │
├──┴───────────────────────────────────────────────┴──────────┤
│  Status bar: active run · voice orb · connection · costs    │
└─────────────────────────────────────────────────────────────┘
```

- **Sidebar** (64px collapsed / 240px expanded, spring animation): Dashboard, Chat, Workspace, Knowledge, Automations, Memory, Settings. Collapsed by default — the palette is the primary nav.
- **Command palette** (⌘K): global, fuzzy, sections = Actions (`/research`, `/plan`, `/email`, `/reminder`, `/code`, `/summarize`, `/automate`…), Navigate, Recent, and **Ask** (free text → chat with palette input pre-filled). Actions accept inline args Raycast-style (`/reminder call mom tomorrow 9am` parses live with a preview).
- **Context panel** (right, slide-in): shows the live agent run (plan checklist, tool cards), RAG sources for the current answer, or note backlinks — contextual to the main view.

### Key screens (wireframe intent)

- **Dashboard / Morning Brief:** greeting + AI summary paragraph at top (streams in on first open), then a bento grid: Calendar (next 3), Tasks (today), Weather, Unread email digest, GitHub notifications, News. Cards stagger-fade in (60ms offsets), hover-elevate. Each card deep-links and has an "ask about this" affordance.
- **Chat:** centered column (max-w-3xl), user msgs right-subtle, assistant full-width. Tool calls render as collapsed glass cards with status shimmer; plan renders as a live checklist; memory citations as small chips. Input is a growing textarea with `/` triggering inline palette and attachment drop.
- **Workspace:** project switcher → tabs: Notes (Tiptap, `/` slash menu incl. "AI continue"), Whiteboard (React Flow), Tasks (TanStack table + board), Journal (calendar strip + daily doc, AI prompts).
- **Knowledge:** sources grid with type icons + status; drop-anywhere-to-ingest; source viewer with chunk highlights when cited.
- **Memory browser:** typed filter chips, timeline view, edit/forget/pin, "why?" trace.
- **Automations:** list + React Flow workflow editor (trigger node → step nodes), run history with logs.

## 2. Component Hierarchy

```
AppShell
├── Providers (Theme, TRPC+QueryClient, Motion(MotionConfig), Auth, Hotkeys)
├── Sidebar → NavItem*, WorkspaceSwitcher, UserMenu
├── CommandPalette → PaletteInput, ResultList(virtualized), ActionPreview, ArgHints
├── ContextPanel → RunInspector | SourceList | Backlinks
├── VoiceOrb (floating; idle/listening/thinking/speaking states)
├── StatusBar
└── <MainView> (route)
    ├── DashboardView → BriefHeader, BentoGrid → {Calendar,Tasks,Weather,Email,GitHub,News}Card
    ├── ChatView → ThreadList, MessageList(virtualized) → MessageItem →
    │              {TextPart(streaming md), ToolCard, PlanChecklist, MemoryChips,
    │               ApprovalPrompt, SuggestionChips}, ChatInput
    ├── WorkspaceView → NoteEditor(Tiptap) | Whiteboard(ReactFlow) | TaskBoard | Journal
    ├── KnowledgeView → SourceGrid, SourceCard, IngestDropzone, SourceViewer
    ├── MemoryView → MemoryFilters, MemoryTimeline, MemoryCard
    └── AutomationsView → AutomationList, WorkflowEditor(ReactFlow), RunLog
```

`components/ui/` adds motion primitives on top of shadcn: `GlassPanel`, `AnimatedList` (layout animations), `Shimmer`, `TypingIndicator`, `StreamedText`, `ElevateOnHover`. Heavy editors (Monaco, Tiptap, React Flow, Recharts) are `next/dynamic` with skeletons.

## 3. State Management

Hard rule: **server state in React Query (via tRPC), UI state in Zustand, streaming state in AI SDK hooks.** Nothing server-derived ever lives in Zustand.

```ts
// Zustand slices (features/*/store.ts + a small global shell store)
shellStore:   { sidebarOpen, paletteOpen, contextPanel, activeModal, hotkeysScope }
chatStore:    { draftByThread, composerAttachments, pendingApproval }
voiceStore:   { state: idle|listening|thinking|speaking, transcriptPartial }
paletteStore: { query, mode: root|action|ask, argState }
```

- Chat streaming: `useChat` (AI SDK) with `onData` handlers dispatching custom parts (plan/tool/memory) into per-message local state.
- Optimistic updates for all CRUD (React Query `onMutate` rollback pattern).
- Realtime: Supabase Realtime on `AgentRun`/`Reminder`/`AutomationRun` → invalidate queries (background runs update UI even with no stream attached).
- Persistence: Zustand `persist` for shell prefs only.

## 4. Motion System

Central `lib/motion.ts` tokens so everything feels like one product:

- **Springs:** `snappy {stiffness:400,damping:30}` (palette, hover), `smooth {260,28}` (panels, page), `gentle {170,26}` (cards entering).
- **Durations:** micro 120ms, standard 200ms, entrance 350ms. Stagger 40–60ms.
- **Patterns:** page transitions = fade+4px rise via template.tsx; palette = scale .98→1 + backdrop blur-in; cards `whileHover={{y:-2, scale:1.005}}` + shadow token; streaming text = per-chunk fade; thinking = 3-dot orbit that morphs into the plan checklist; skeletons shimmer with the glass palette.
- **Rules:** animate only `transform`/`opacity`; respect `prefers-reduced-motion` (MotionConfig `reducedMotion="user"`); no animation longer than 400ms on the interaction path.

**Theme:** pure black `#000`, glass surfaces `rgba(255,255,255,0.04–0.08)` + `backdrop-blur`, 1px `rgba(255,255,255,0.08)` borders, white/zinc typography (Inter or Geist; SF-style tracking), single accent color (electric blue) used *only* for AI activity — the accent glowing means SAGE is thinking.
