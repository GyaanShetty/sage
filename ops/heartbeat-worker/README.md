# SAGE heartbeat

Vercel's free plan gives **two cron invocations a day**. That ceiling shaped
everything time-sensitive in SAGE: a reminder set for 3pm arrived at 9pm, price
alerts were never evaluated at all, and automations could only notice they were
due twice a day.

This moves the schedule off Vercel. A Cloudflare Worker cron fires every minute —
free — and calls `/api/beat`. The Worker holds no schedule of its own; SAGE
decides what is due.

## What it unlocks

| Job | Cadence | Was |
|---|---|---|
| Reminders | every minute | twice a day |
| Prep nudges (15 min before events) | every 15 min | twice a day |
| Price alerts | every 10 min, market hours only | **never evaluated** |
| Automations | every 5 min | twice a day |
| Notifications | hourly, 06:00–23:00 | twice a day |
| Hevy sync | every 3 hours | twice a day |
| Backup | daily, small hours | weekly |

## Setup (about five minutes)

1. **dash.cloudflare.com** → Workers & Pages → *Create* → *Worker*. Name it
   `sage-heartbeat`, deploy the placeholder, then *Edit code* and paste
   [`worker.js`](./worker.js).
2. **Settings → Variables and Secrets**:
   - `SAGE_URL` = `https://your-app.vercel.app` (plain text)
   - `CRON_SECRET` = the same value as in Vercel (**encrypted secret**)
3. **Settings → Triggers → Cron Triggers** → *Add Cron Trigger* → `* * * * *`.
4. Open the worker's URL once. It runs a beat by hand and shows the response —
   `{"ok": true, ...}` means it is wired up.

## Checking it

`GET /api/beat` returns which jobs ran, how long each took, and which were
skipped as not yet due. Hitting it repeatedly is safe: cadence is enforced
server-side, so ten beats in ten seconds run the work once.

## If it stops

Nothing breaks. The two Vercel crons still run, so SAGE keeps closing the day
out and taking a weekly backup — just at the old, coarse resolution. The
heartbeat is an upgrade to the clock, not a dependency.

## Free-tier notes

- Cloudflare Workers: 100,000 requests/day free. A minute cron uses 1,440.
- Every job is idempotent — reminders claim before sending, syncs upsert — so a
  duplicated beat cannot double-notify.
- Any other minute-granularity scheduler works identically. `/api/beat` also
  accepts `?key=CRON_SECRET` for services that cannot set a header.
