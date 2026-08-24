# SAGE — what to build next

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

### 4. Two-way calendar
`core/calendar` reads Google Calendar and `syncEventReminders` generates prep
nudges from it. SAGE cannot yet *create* an event — so scheduling still means
leaving. Same shape as the gap `createTickTask` closed for tasks.

### 5. Capture → action
`core/capture` parses a voice memo or screenshot into notes, tasks and memories.
It stops at filing. The obvious next step is proposing the *action*: a screenshot
of a receipt should offer to log the expense; a photo of a whiteboard should
offer to create the tasks on it.

### 6. Mail that can reply
`/mail` reads and classifies. Drafting a reply in SAGE's voice, held for
approval, is a much larger saving than reading it there.

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

### 12. A weekly review that argues back
`core/review/weekly` summarises. It could instead compare what was planned
against what happened and name the pattern — the useful and uncomfortable half.

### 13. Decision follow-through
`core/decisions` records decisions and asks for a verdict. It does not yet check
whether the reasoning held up. Scoring past decisions is where the value is.

### 14. ~~Spend forecasting~~ — already built

`core/finance/budget.ts` already projects month-end from days elapsed
(`projected`, `projectedTotal`, and the pacing note). Listed here in error.

### 15. Offline-first
The service worker exists and caches shell assets. Making the last-known state
of each panel readable offline would make the phone case genuinely useful.

---

## Deliberately not building

- **LeetCode submission.** It needs the user's logged-in session cookie, which
  is against LeetCode's terms. The lab does everything up to that line.
- **Multi-user.** Single-user is a design constraint, not an oversight; it is
  why the auth model can be this simple.
