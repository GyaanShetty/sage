# Disk bridge

Gives SAGE **read-only** access to folders you choose on your Mac.

## How it works

Your Mac reaches out to SAGE; SAGE never reaches in. Nothing listens, no port
is opened, and nothing has to be exposed to the internet.

```
SAGE (Vercel)                     your Mac
     │                                │
     │   ← "any work?"  ──────────────┤   outbound HTTPS, every 3s
     │   → job: read ~/notes/spec.md  │
     │                                │   ← the allowlist is checked HERE
     │   ← result ────────────────────┤
```

The allowlist lives on this side, and SAGE can neither see nor change it. That
is the point: a compromised SAGE cannot widen its own access, because the thing
enforcing the boundary is the one thing the internet cannot reach.

## What it can and cannot do

**Can** — list a folder, read a text file, stat a path, search a folder by name.

**Cannot** — write, delete, move, or run anything. There is no code path for it.
That's a ceiling rather than a first milestone: an app that can execute on your
machine is a different risk category from one that can read your notes, and the
useful half needs only the reading.

Also refused, even inside a shared folder: `.env*`, `.ssh`, `.aws`, `.gnupg`,
`.netrc`, private keys, `*.pem/.key/.p12/.keychain/.kdbx`, git credentials. You
share a project folder because you want the notes in it; `.env` is in there too,
and nobody means to hand that over.

Files over 256KB and binaries are refused rather than sent.

## Setup

1. **Pick a secret** — its own, not `CRON_SECRET`. These are different
   capabilities: one runs scheduled jobs, the other reaches your filesystem.

   ```bash
   openssl rand -hex 32
   ```

2. **Add it to SAGE** — Vercel → sage-os → Settings → Environment Variables →
   `BRIDGE_SECRET`. Redeploy (Vercel only picks up env changes on a new build).

3. **Run the daemon** on your Mac:

   ```bash
   cd ops/disk-bridge
   SAGE_URL=https://sage-os-plum.vercel.app \
   BRIDGE_SECRET=<the same value> \
   SAGE_ROOTS="$HOME/Documents/notes:$HOME/Desktop/work" \
   node bridge.mjs
   ```

   `SAGE_ROOTS` is colon-separated and **required** — with none set it refuses
   to start rather than defaulting to your whole disk.

4. **Try it.** Ask SAGE: *"list the files in my notes folder"*.

## Keeping it running

```bash
# ~/Library/LaunchAgents/com.sage.bridge.plist — then:
launchctl load ~/Library/LaunchAgents/com.sage.bridge.plist
```

Any process manager works; it is a plain Node script with no dependencies.

## The audit log

Every request is printed, served or refused:

```
2026-08-25T09:14:02.118Z  SERVED  list   ~/Documents/notes
2026-08-25T09:14:44.902Z  REFUSED read   ~/.ssh/id_ed25519  (That file is excluded from the bridge.)
```

Redirect it somewhere durable if you want to keep it. The record of what a
remote system read from your disk is the reason it exists.

## Turning it off

Stop the process. SAGE loses access immediately — there is no cached copy and
no other route in.
