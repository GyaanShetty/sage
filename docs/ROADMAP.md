# SAGE — what to build next

> **Audited 24 Aug 2026 against the codebase.** The first draft of this list was
> written from module names without opening the code, and eight of its items
> turned out to be already built. Everything below has now been checked. Items
> struck through are done; the rest were verified missing by their absence.


Written against the codebase as it stands, not a generic wishlist. Each item
names the problem it solves and roughly what it touches, so it can be picked up
cold. Ordered by value per unit of work.

---

## Tier 1 — make it feel alive

These are the difference between "a dashboard I check" and "a system that is
running". The plumbing landed with `lib/live.ts`; these build on it.

### 1. ~~Server-sent events instead of polling~~ — rejected, and why

Measured before building: a hidden dashboard was making **32 API calls a
minute**, 28 of them the globe refreshing satellites nobody could see.

SSE would fix staleness and break the budget. A connection occupies a
serverless function for as long as it is held open, so one tab left open all
day is 24 hours of function time per day — far past what a free plan includes,
for an app whose entire premise is that it costs nothing to run.

Done instead: polling pauses entirely while a tab is hidden, and the freed
budget is spent in the foreground (tasks went from 120s to 25s). Hidden cost
fell 32 → 3 calls a minute; the app feels *more* live and costs less.
Changes made outside SAGE still arrive on a timer rather than instantly — that
is the accepted trade.

### 2. Optimistic writes everywhere, with rollback
Ticking a TickTick task is instant because the row is removed locally before the
request returns. Almost nothing else does this — adding a note, logging an
expense, marking a habit all wait for a round trip, which is what makes the app
feel slower than it is. Generalise the pattern used in `ticktick-band.tsx`
(including the rollback, which is the half that is usually skipped).

### 3. A freshness indicator
Several panels are backed by deliberately cached third-party data — Alpha
Vantage allows 25 requests a *day*. The honest fix is not fetching more, it is
saying when the number is from. A small "14:02" under each panel removes the
suspicion that the whole app is stale.

---

## Tier 2 — close loops that are half-built

### 4. ~~Two-way calendar~~ — already built

`createCalendarEvent`, `updateCalendarEvent` and `deleteCalendarEvent` exist in
`infrastructure/integrations/google.ts` and are all exposed as voice tools in
`core/tools/native.ts`. My original grep looked for `createEvent` and missed them.

### 5. ~~Capture → action~~ — already built

`core/capture/index.ts` already proposes rather than files blindly — see its
"Why it proposes rather than acts" note.

### 6. ~~Mail that can reply~~ — already built

The `draft_email` tool exists and drafts into Gmail, held for approval.
Sending remains deliberately unbuilt — see *Deliberately not building*.

### 7. Exam mode ↔ Feynman loop
`core/exam` knows which topics are weak (`topicWeakness`) and `core/feynman`
knows which concepts are shaky. They do not talk. Weak exam topics should seed
Feynman concepts automatically.

---

## Tier 3 — the interface

### 8. One command surface
There is a wheel launcher, a command palette, a search box and a mic button —
four ways in, each knowing about different things. Collapsing them into one
surface that accepts a page name, a question, or a command would remove more
interface than it adds.

### 9. Density control
The dashboard is designed for a wide window and degrades badly in a narrow one
(see the split-screen screenshot). A comfortable/compact toggle, plus honest
breakpoints for the bands, the wheel tab and the floating mic.
*This is the outstanding layout issue.*

### 10. Keyboard-first navigation
`j`/`k` between bands, `/` to search, `g` then a letter to jump. Cheap to build,
and it changes how the app feels to use daily.

### 11. Per-panel error states
Several panels still render empty on failure, which is indistinguishable from
"nothing to show". `/explain` and `/exam` were fixed this way; the rest have not
been.

---

## Tier 4 — new ground

### 12. ~~A weekly review that argues back~~ — already built

`core/review/weekly.ts` already compares against budget and produces real
commentary. Sharpening its tone is a tweak, not a feature.

### 13. ~~Decision follow-through~~ — already built

`core/decisions/store.ts` already stores the prediction as "the thing being
scored" and reviews against it.

### 14. ~~Spend forecasting~~ — already built

`core/finance/budget.ts` already projects month-end from days elapsed
(`projected`, `projectedTotal`, and the pacing note). Listed here in error.

### 15. ~~Offline-first~~ — already built

`public/sw.js` is already network-first for navigations with a cached shell
for offline. Extending it to per-panel state is a smaller job than listed.

---

## Deliberately not building

- **LeetCode submission.** It needs the user's logged-in session cookie, which
  is against LeetCode's terms. The lab does everything up to that line.
- **Multi-user.** Single-user is a design constraint, not an oversight; it is
  why the auth model can be this simple.


---

## Verified still missing

Checked by absence on 24 Aug 2026. These are the real ones.

| | What | Why it matters | Size |
|---|---|---|---|
| A | **Freshness stamps** | Several panels are deliberately cached (Alpha Vantage allows 25 requests a *day*). Without a timestamp, cached and stale look identical — the root of "it doesn't feel live". | S |
| B | **Loading vs empty states** | A slow fetch and "nothing to show" render identically, so a slow panel reads as a broken one. | S |
| C | **Exam ↔ Feynman bridge** | `topicWeakness()` knows the weak topics and `core/feynman` knows the shaky concepts. Nothing connects them. | S |
| D | ~~**Reminder snooze**~~ | Built 24 Aug — `snooze_reminder`, including reminders that already fired. | ✔ |
| E | **Voice speed / voice picker** | Rate is hard-coded at 0.94 and the voice is an env var. Neither is changeable without a deploy, and there is no preview. | S |
| F | **Quota warning before it bites** | The failover already tracks strikes and cooldowns per key; nothing surfaces "two of five keys are cooling" until something fails. | S |
| G | **Backup restore drill** | Backups run and strip key rows. Nothing has ever restored one. An untested backup is a belief. | S |
| H | **One command surface** | Wheel, palette, search and mic are four entrances that know about different things. | M |
| I | **Keyboard-first navigation** | The launcher handles keys; there is no `j`/`k`/`g`-then-letter movement between bands. | S |
| J | **Real phone layout** | It installs as a PWA and shows a shrunken desktop layout. Glance-and-capture is a different design, not a narrower one. | M |
