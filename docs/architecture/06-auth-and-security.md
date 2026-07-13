# 06 — Authentication & Security Model

## 1. Authentication Flow

Supabase Auth. MVP: email magic link + Google OAuth. Sessions = httpOnly cookies via `@supabase/ssr`.

```
Login → Supabase Auth → callback → middleware refreshes session cookie
  → RSC/route handlers read session server-side
  → tRPC protectedProcedure injects { userId }
  → Postgres RLS enforces userId = auth.uid() on every table (last line of defense)
```

- Next.js middleware guards `(shell)` routes; unauthenticated → `/login`.
- First login → onboarding wizard (name, preferences seed, optional integrations) → creates `User` row + seed memories (`sourceType:"explicit"`).
- Electron later: system browser OAuth + deep-link callback (`sage://auth`) — never embed login in a webview.

### Integration OAuth (Google Calendar/Gmail, GitHub…)
Standard authorization-code + PKCE per provider, minimal scopes, tokens AES-256-GCM encrypted at rest (key in env/KMS — **not** in the DB), refresh handled centrally in `infrastructure/integrations/token-manager.ts`. Revocation = delete row + revoke upstream.

## 2. Security Model

**Trust zones**

| Zone | Trust | Examples |
| --- | --- | --- |
| User input | trusted-ish | chat, notes |
| Retrieved content | **untrusted** | scraped web, PDFs, YouTube transcripts, email bodies |
| LLM output | **untrusted** | anything the model produces |
| Tool effects | gated | side-effecting tools |

**Prompt injection defenses** (the #1 threat for an agent with tools):
1. Retrieved/ingested content is always wrapped in delimited blocks with an explicit "data, not instructions" framing.
2. **Capability firewall:** side-effecting tools (`email_send`, `file_write`, `run_command`, calendar mutations, future MCP write tools) require human approval by default; approval UI shows the *exact* payload.
3. A run that ingested untrusted content gets a tainted flag → auto-approve policies are ignored for that run (untrusted data can never silently trigger writes).
4. Egress allowlist for the scraper; no requests to link-local/private ranges (SSRF).

**Command execution** (`run_command` for the Coder agent): disabled by default; when enabled, runs in a sandbox (container/firejail) with cwd allowlist, no network by default, timeout, and always approval-gated. Never `exec` on the web server itself — deferred to the Electron/desktop phase where a local sandboxed runner exists.

**Data protection**
- RLS everywhere; service-role key only in server env, never shipped to client.
- Secrets: env vars via Vercel/Supabase config; `lib/config.ts` validates with Zod at boot (fail fast).
- Encrypt integration tokens (above); Supabase storage buckets private + signed URLs.
- Memory browser gives full inspect/edit/delete — GDPR-ish by construction; "export all my data" and "delete account" jobs from day one.
- LLM providers: no-training API tiers; log prompts only in dev, redact in prod logs.

**App hardening:** CSP (no inline scripts beyond Next requirements), all inputs Zod-validated at the edge, webhook signature verification, `CRON_SECRET` on scheduler endpoints, rate limits (doc 02), dependency audit in CI, `iframe`/`sandbox` for rendering any user-ingested HTML.

**Audit:** every tool execution and approval decision is an `AgentStep` + `Event` — full replayable trail of what SAGE did and why.
