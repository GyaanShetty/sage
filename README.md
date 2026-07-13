# SAGE — Personal AI Operating System

> The single interface between you and your digital life. An intelligent chief of staff that understands, executes, automates, learns, and proactively helps.

**Status:** Architecture phase. No implementation yet — see [docs/architecture](docs/architecture/00-overview.md).

## Vision

SAGE is not a chatbot. It is an AI operating system: memory, knowledge, agents, automation, and voice unified behind one keyboard-first, Raycast-quality interface. Instead of opening 20 apps, you open SAGE.

## Documents

| Doc | Contents |
| --- | --- |
| [00-overview.md](docs/architecture/00-overview.md) | System overview, principles, tech stack, folder structure |
| [01-database-schema.md](docs/architecture/01-database-schema.md) | Full Prisma/PostgreSQL schema (pgvector included) |
| [02-api-design.md](docs/architecture/02-api-design.md) | API surface, streaming protocol, error model |
| [03-memory-architecture.md](docs/architecture/03-memory-architecture.md) | Short/long-term/semantic/contextual memory engine |
| [04-agent-architecture.md](docs/architecture/04-agent-architecture.md) | LangGraph orchestration, agent registry, tool layer, MCP readiness |
| [05-ui-architecture.md](docs/architecture/05-ui-architecture.md) | Wireframes, component hierarchy, state management, motion system |
| [06-auth-and-security.md](docs/architecture/06-auth-and-security.md) | Authentication flow, security model, secrets handling |
| [07-roadmap.md](docs/architecture/07-roadmap.md) | MVP → production roadmap, risks, performance plan, future expansion |

## Core Principles

1. **Keyboard-first.** Everything reachable from ⌘K. Zero clutter.
2. **Feature-based modularity.** Every feature independently replaceable.
3. **Memory is the moat.** Every interaction feeds the memory engine.
4. **Agents are plugins.** New agents register; the orchestrator routes.
5. **Tools are MCP-shaped from day one.** Native tools today, MCP servers tomorrow, no refactor.
6. **Premium motion.** The app feels alive — Framer Motion quality everywhere.

## Naming

Repo and canonical product name: **SAGE**. (The brief also uses "AXIOM"; treated as an open branding decision — the codebase never hardcodes the display name, it lives in one config constant.)
