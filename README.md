# SAGE

A personal AI operating system. One interface for your tasks, mail, calendar,
money, health, study and research — with an assistant that works while you
sleep.

Built to run on **free tiers**: Vercel Hobby, Supabase free, Gemini free,
Cloudflare Workers free. It is designed around those limits rather than in
spite of them, which is most of what makes it interesting.

**Status:** in daily production use by its author. Not a demo.

---

## What it actually does

**Capture** — Talk at it for two minutes, or drop in a screenshot. It sorts the
result into tasks, reminders, memories, expenses, decisions, questions and
notes, and files each through the same path the rest of the app uses. Nothing
is written until you have read the list, because a misheard word becomes a
false memory, and a false memory poisons every answer after it.

**The night shift** — Runs in the small hours. Researches a question you left
open, prepares tomorrow's first commitment by reading the history with whoever
it involves, and reports what quietly went wrong: budget running ahead, sleep
debt, a decision owed a verdict. Silence is a legitimate outcome; it does not
manufacture busywork.

**Explain** (the Feynman loop) — Mark what you do not understand, paste the
source, and it comes back on an SM-2 schedule. You explain it aloud and are
marked *against that source only* — grading against a model's general knowledge
would reward fluent nonsense and punish disagreement with a textbook it has
never seen.

**Exam mode** — A countdown with a phase, and the phase says what it is *for*.
Inside three weeks the night shift stops researching and starts setting
practice questions off your syllabus, weighted toward wherever you are actually
losing marks.

**Decisions** — A decision journal that scores your calibration with a Brier
score, and a devil's advocate that argues against you using your own record.

**Money, markets, health, career, code** — Budget envelopes you define, a
shadow book of trades you *didn't* take (does hesitation cost you, or save
you?), readiness from acute:chronic workload ratio, application tracking, and a
LeetCode workspace that pushes solutions to GitHub in a folder structure you
choose.

## Running your own

```bash
git clone <your fork>
cd sage
npm install
cp env.example .env.local     # then fill it in — the file explains every key
npm run dev
```

**Minimum to boot:** a Supabase project, a Gemini API key (free), and a
password. Everything else degrades gracefully — a missing key disables that
feature and says so on the page, rather than crashing.

1. **Database.** Create a Supabase project. Run
   `prisma/migrations/0001_init/migration.sql`, then every file in
   `prisma/sql/` (RPCs and indexes, including the pgvector index without which
   memory recall takes over a second).
2. **Identity.** Set `SAGE_OWNER_NAME`, `SAGE_TZ`, `SAGE_PLACE`, `SAGE_LAT`,
   `SAGE_LON`. The name is threaded into every system prompt from one constant,
   so forking is a variable, not a grep.
3. **Deploy.** Push to Vercel. Set the same variables there.
4. **The clock.** Deploy `ops/heartbeat-worker` to Cloudflare. **Without it
   there are no reminders, no price alerts, no night shift and no backups —
   and nothing warns you.** Hobby allows two crons a day; reminders need every
   minute. See [docs/OPERATIONS.md](docs/OPERATIONS.md).
5. **Check it.** Open `/api/preflight`. It tells you what is missing and
   whether the clock is running.

## Honest limitations

- **Single user by design.** There is one `DEFAULT_USER_ID` and one password
  gate. Every table carries `userId`, so multi-tenancy is a real possibility
  rather than a rewrite, but it is not implemented and the auth model assumes
  one person. Self-host your own instance; do not put several people on one.
- **Free-tier shaped.** 60-second functions, ~4.5MB request bodies, a daily
  Gemini quota. Long work is split into parts that survive those limits.
- **LeetCode submission is not implemented and will not be.** It would require
  borrowing your session cookie — against their terms, and not a thing to build.
- **Video and audio uploads are stored, not read.** Only text and images reach
  a model.
- **The LeetCode problem search is unverified** against the live API at the
  time of writing; if their problem-list endpoint has changed shape again, the
  picker will say so explicitly rather than showing an empty list.

## Architecture

Next.js 15 (App Router) · React 19 · TypeScript strict · Tailwind v4 · Vercel
AI SDK · Supabase (Postgres + pgvector + Storage).

```
app/          routes and API endpoints
core/         domain logic — no React, no framework
features/     UI, one directory per feature
infrastructure/  the outside world: db, llm, integrations
lib/          shared config and utilities
tests/        pure-logic tests, no network
```

The rule that keeps it navigable: **`core/` never imports from `features/`**.
Domain logic is testable without a browser, which is why the test suite runs in
seconds with no mocking framework.

Design notes live in [docs/architecture](docs/architecture/00-overview.md); the
runbook is [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Tests

```bash
npm test                 # 115 pure-logic tests, no network
npx tsc --noEmit
npx next build
```

One test parses the SQL schema and checks that every object-literal insert in
the codebase supplies the NOT NULL columns. Supabase *returns* errors rather
than throwing them, so a rejected row otherwise reports success — that class of
bug is silent, and it cost real data before the test existed.

## Contributing

Issues and pull requests welcome. Two conventions worth matching:

- **Comments explain why, not what.** The code says what it does. Comments are
  for the constraint, the failure it prevents, or the reason the obvious
  approach was wrong.
- **Degrade, don't crash.** A missing key disables a feature and says so.

## Licence

MIT — see [LICENSE](LICENSE).
