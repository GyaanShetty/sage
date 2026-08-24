# Testing SAGE — what only you can check

## Why this exists

Three kinds of thing get verified here, and only the first two can be verified
without you:

| | Checked by | Covers |
|---|---|---|
| Pure logic | `npm test` (147 tests, no config needed) | scheduling maths, ranking, parsing, prompt rules |
| Wiring | `npm run build`, `npx tsc`, `eslint` | types, imports, routes compiling |
| **Everything real** | **you** | voice, live data, your accounts, how it feels |

The sandbox has no microphone, no speakers, no Google/TickTick/Fish account, and
a proxied network. So the third row is the gap, and this is how to close it
quickly.

---

## The 60-second smoke test

Run after any deploy. If all five pass, nothing important is broken.

1. **Is my build live?** → `https://sage-os-plum.vercel.app/api/version`
   The `short` field should match the newest commit.
2. **Can it speak?** Open the dashboard, press **Listen** on the morning brief.
   Audio should start within ~2s and *finish the whole thing*.
3. **Is it live?** Tick a task in the Deadlines band. The Eisenhower matrix
   above it should update immediately, not in two minutes.
4. **Does AI work?** Ask SAGE anything in chat. A reply means keys, model ids
   and quota are all fine.
5. **Any errors?** Vercel → sage-os → Logs, filter to Errors, last hour.

---

## When something is wrong, get me the reason not the symptom

This is the single most useful thing you can do. "The voice is broken" costs a
day of guessing; the output of one of these costs a minute.

### Voice
```
/api/voice/diagnose          (logged in, in the browser)
```
Reports every provider, whether a key is configured, and **what each one
actually said** — bad key, no credit, timed out. Masked key tails only, never
key material. Paste the whole thing.

### The scheduler
```
curl -H "Authorization: Bearer $CRON_SECRET" https://sage-os-plum.vercel.app/api/cron
```
`ms` is how long the tick took; `skipped` names any job that ran out of budget.
`skipped: []` means everything ran.

### Configuration
```
/api/preflight
```
Every environment variable SAGE wants, whether it is set, and what breaks
without it. Counts and masked tails only.

### Anything in the browser
Open DevTools → Console, reproduce, screenshot **including** the red errors.
A screenshot of the UI alone shows me the symptom; the console shows the cause.

---

## Feature-by-feature checks

Only worth running when I have touched that area — I will say which.

**Voice**
- Long answer plays to the end without stopping mid-sentence
- Leave it playing 5+ minutes — the ambient voice must not cut in over it
- "Stop" actually stops, and a new question starts cleanly

**Tasks / TickTick**
- Add in SAGE → appears in the TickTick app
- Complete in the TickTick app → switch back to the tab, gone within a second
- Delete (hover a row) → gone from both
- Both task panels always agree

**LeetCode**
- Search by number (`12`) and by name (`two sum`)
- Pick a language other than Python — the solution must come back in it
- Type in Python, switch to Go, switch back — your Python must still be there
- Check the constraints in the statement match leetcode.com exactly

**Ambient voice**
- Over a day: is it mostly tasks and calendar rather than the market?
- Does it ever repeat itself, or talk at a bad moment?

**Morning brief**
- Are the articles real and the summaries accurate?
- Does anything overlap or clip at your usual window size?

---

## Things I genuinely cannot test

Worth knowing so you are not waiting on me for them:

- Anything needing **your** logged-in accounts (Google, TickTick, Gmail, Hevy)
- **Microphone** input — dictation, wake word
- **Audio output** — I can verify bytes come back, never that it sounds right
- **iOS/PWA** behaviour — install, notifications, Shortcuts
- **How it looks on your screen** at your window size
- Whether a summary is *correct* rather than merely well-formed
