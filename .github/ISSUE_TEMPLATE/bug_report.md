---
name: Bug report
about: Something behaves differently than it says it does
labels: bug
---

**What happened, and what you expected instead**

**How to reproduce it**

**What `/api/preflight` says**
It reports which variables are set (never their values) and whether the
heartbeat is running. Most "feature does nothing" reports turn out to be a
missing key or a dead heartbeat, and this is the fastest way to rule that out.

**Where it is deployed** — Vercel / self-hosted / local
