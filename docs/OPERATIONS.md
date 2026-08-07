# Operating SAGE

The runbook. Written for the person who has to fix this at 11pm with no
context — which, eventually, is everyone.

Start here: **`/api/preflight`**. It reports what is configured, whether the
database answers, and whether the clock is actually running, and it names what
is missing. It reports whether each variable is *set*, never what it contains.

---

## 1. What has to be true for SAGE to work

Four things, in order of how loudly they fail:

| Thing | Without it | How you find out |
|---|---|---|
| Supabase reachable | Nothing loads | Every page errors |
| `SAGE_PASSWORD` | **The app is open to anyone with the URL** | Silently. Nothing warns you but preflight |
| An AI key | No chat, capture, briefs, marking | Pages say "No AI key configured" |
| The heartbeat | No reminders, price alerts, night shift, backups | **Silently.** Everything looks fine |

The last one is the trap. Read on.

## 2. The heartbeat — the single most important thing to know

Vercel's Hobby plan allows **two cron invocations a day**. Reminders need to be
checked every minute. Those two facts are irreconcilable, so the clock lives
*outside* Vercel: a Cloudflare Worker (free, one-minute granularity) calls
`/api/beat` on a schedule, and `/api/beat` decides which jobs are due.

Deploy it from `ops/heartbeat-worker` — see the README there. It needs
`CRON_SECRET` to match the app's.

**If the heartbeat is not running, SAGE looks completely healthy and quietly
does nothing.** No reminder fires, no price alert is ever evaluated, the night
shift never runs, and nothing is backed up. Preflight is the only place that
tells you. Check it after any change to hosting.

Jobs and their cadence live in `core/ops/heartbeat.ts`. Each records when it
last ran, so beating ten times in ten seconds runs the work once — the
frequency of the caller is not the frequency of the work.

## 3. Backups

`BACKUP_REPO` must be a **private** `owner/repo`. The backup checks this on
every single run and refuses if the repo is public — a public repo is how a
personal database ends up indexed.

Stored API keys are stripped from every export. They are the one thing that
must never reach a git history, so `core/ops/backup.ts` keeps an explicit
`NEVER_BACKED_UP` set rather than relying on anyone remembering.

Restores are **upsert-only** and never delete. A restore that removed rows the
backup did not know about would turn "recover one table" into data loss.

## 4. Secrets

- Keys added through **Settings → Vitals** are AES-256-GCM encrypted under
  `KEY_SECRET`, which lives in the environment, *outside* the database. A
  database dump alone cannot read them.
- Changing `KEY_SECRET` makes every stored key unreadable. There is no
  recovery. Re-enter them.
- Diagnostic endpoints return **counts and masked tails only**. If you add one,
  keep it that way: an endpoint that echoes secrets is a credential leak with a
  friendly interface.
- Rotate anything you have ever pasted into a chat window, including with an
  AI assistant. Transcripts are stored.

## 5. When something breaks

**"No AI key configured"** — every Gemini key is exhausted or absent. The free
tier resets daily. Add more keys in Settings; they rotate on exhaustion, not
per request, because rotating eagerly wastes the warm one.

**Reminders stopped** — heartbeat. See §2. `/api/preflight` will say so.

**A page is empty but not broken** — that integration's key is missing. This is
deliberate: features degrade rather than crash. Preflight lists which.

**Voice stops a minute in** — was a bug, fixed. If it returns, check
`lib/speak.ts`: long answers are split into parts that auto-advance, and the
`session` counter is what stops a superseded answer from talking over its
replacement.

**Something wrote nothing but reported success** — check the returned error.
Supabase *returns* errors rather than throwing them, so `await db.insert(...)`
succeeds even when the row was rejected. `tests/logic.test.ts` has a test that
reads the schema and checks every insert supplies the NOT NULL columns; run it.

**You deleted something you needed** — `core/ops/trash.ts` snapshots the whole
row before any delete, kept 30 days.

## 6. Deploying

Push to `main`; Vercel builds. Verify with `/api/version`, which returns the
deployed commit sha — the only reliable way to know your change is actually
live rather than cached.

Before pushing: `npx tsc --noEmit && npm test && npx next build`. The tests are
pure logic, no network, and take seconds.

## 7. Limits worth knowing before you design around them

- Vercel Hobby: 60s function duration, ~4.5MB request body, 2 crons/day.
- Gemini free tier: per-project quota. More keys from the same project do not
  add quota — only separate projects do.
- Supabase free tier: 500MB. `core/ops/retention.ts` prunes old events.
- LeetCode submission is **not** implemented and will not be. It would require
  borrowing a session cookie, which is both against their terms and the sort of
  thing you should never build.
