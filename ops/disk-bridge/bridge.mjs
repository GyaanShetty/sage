#!/usr/bin/env node
/**
 * SAGE disk bridge — runs on your Mac, gives SAGE read access to chosen folders.
 *
 * ── The boundary lives here, on purpose ───────────────────────────────────
 *
 * SAGE asks for a path; this file decides whether that path is allowed. The
 * allowlist is local and SAGE cannot see or change it, so a compromised SAGE
 * cannot widen its own access — the thing enforcing the limit is the one
 * thing the internet cannot reach.
 *
 * Read only. List, read, stat, search by name. No writes, no deletes, no
 * shell. That is a ceiling, not a first milestone: a web app that can execute
 * on your machine is a different risk category from one that can read your
 * notes, and the useful half needs only the reading.
 *
 * Outbound only. Nothing listens; nothing is exposed; no port is opened.
 *
 * Usage:
 *   SAGE_URL=https://sage-os-plum.vercel.app \
 *   BRIDGE_SECRET=... \
 *   SAGE_ROOTS="$HOME/Documents/notes:$HOME/Desktop/work" \
 *   node bridge.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

const SAGE_URL = (process.env.SAGE_URL || "").replace(/\/$/, "");
const SECRET = process.env.BRIDGE_SECRET || "";
const POLL_MS = Number(process.env.BRIDGE_POLL_MS || 3000);
const MAX_BYTES = Number(process.env.BRIDGE_MAX_BYTES || 256 * 1024);
const MAX_ENTRIES = 400;

/**
 * Folders SAGE may read. Required — an empty allowlist means "your whole
 * disk" only if you write the code carelessly, so this refuses to start
 * instead. The safe default for a tool like this is no access at all.
 */
export const ROOTS = (process.env.SAGE_ROOTS || "")
  .split(":")
  .map((r) => r.trim())
  .filter(Boolean)
  .map((r) => path.resolve(r.replace(/^~/, os.homedir())));

/** Refuse to start without all three. An unset allowlist must never mean
 *  "everything" — the safe default for a tool like this is no access at all. */
export function checkConfig() {
  const missing = [];
  if (!SAGE_URL) missing.push("SAGE_URL");
  if (!SECRET) missing.push("BRIDGE_SECRET");
  if (ROOTS.length === 0) missing.push("SAGE_ROOTS (name the folders SAGE may read)");
  return missing;
}

/**
 * Names that stay unreadable even inside an allowed folder.
 *
 * You allow a project directory because you want SAGE to read the notes in
 * it, and .env is sitting in there too. Nobody intends to hand over their
 * credentials; they just intended to share the folder.
 */
const DENY = [
  /(^|\/)\.env(\.|$)/i,
  /(^|\/)\.ssh(\/|$)/i,
  /(^|\/)\.aws(\/|$)/i,
  /(^|\/)\.gnupg(\/|$)/i,
  /(^|\/)\.netrc$/i,
  /(^|\/)id_(rsa|ed25519|ecdsa)/i,
  /\.(pem|key|p12|pfx|keychain|kdbx)$/i,
  /(^|\/)\.git\/(config|credentials)/i,
];

/**
 * Is this path allowed?
 *
 * realpath first, then compare — otherwise `notes/../../.ssh` or a symlink
 * pointing outside the allowlist walks straight past a string check. The
 * separator on the end matters too: without it, allowing `/Users/g/work`
 * would also allow `/Users/g/work-secrets`.
 */
export async function resolveAllowed(p) {
  const target = path.resolve(p.replace(/^~/, os.homedir()));
  let real;
  try {
    real = await fs.realpath(target);
  } catch {
    // Does not exist yet — check the literal path so the error we return is
    // "not found" rather than a misleading "not allowed".
    real = target;
  }
  const inside = ROOTS.some((root) => real === root || real.startsWith(root + path.sep));
  if (!inside) return { ok: false, error: "That path is outside the folders you shared with SAGE." };
  if (DENY.some((re) => re.test(real))) return { ok: false, error: "That file is excluded from the bridge." };
  return { ok: true, real };
}

export const audit = (line) => console.log(`${new Date().toISOString()}  ${line}`);

export async function run(job) {
  const gate = await resolveAllowed(job.path);
  if (!gate.ok) return { error: gate.error };
  const p = gate.real;

  if (job.op === "stat" || job.op === "list" || job.op === "read" || job.op === "search") {
    const st = await fs.stat(p).catch(() => null);
    if (!st) return { error: "No such file or folder." };

    if (job.op === "stat") {
      return { result: { path: p, dir: st.isDirectory(), bytes: st.size, modified: st.mtime.toISOString() } };
    }

    if (job.op === "list" || job.op === "search") {
      if (!st.isDirectory()) return { error: "That is a file, not a folder." };
      const entries = await fs.readdir(p, { withFileTypes: true });
      let out = entries
        .filter((e) => !DENY.some((re) => re.test(path.join(p, e.name))))
        .map((e) => ({ name: e.name, dir: e.isDirectory() }));
      if (job.op === "search" && job.query) {
        const q = String(job.query).toLowerCase();
        out = out.filter((e) => e.name.toLowerCase().includes(q));
      }
      return { result: { path: p, entries: out.slice(0, MAX_ENTRIES), truncated: out.length > MAX_ENTRIES } };
    }

    // read
    if (st.isDirectory()) return { error: "That is a folder, not a file." };
    if (st.size > MAX_BYTES) {
      return { error: `That file is ${(st.size / 1024).toFixed(0)}KB; the bridge reads up to ${MAX_BYTES / 1024}KB.` };
    }
    const buf = await fs.readFile(p);
    // Binary in a text channel is noise at best; say so rather than sending it.
    if (buf.includes(0)) return { error: "That looks like a binary file." };
    return { result: { path: p, bytes: st.size, text: buf.toString("utf8") } };
  }

  return { error: `Unsupported operation: ${job.op}` };
}

const headers = { authorization: `Bearer ${SECRET}`, "content-type": "application/json" };

async function tick() {
  const res = await fetch(`${SAGE_URL}/api/bridge`, { headers }).catch(() => null);
  if (!res?.ok) {
    if (res && res.status === 401) audit("AUTH FAILED — check BRIDGE_SECRET matches SAGE");
    return;
  }
  const { jobs = [] } = await res.json().catch(() => ({ jobs: [] }));
  for (const job of jobs) {
    let outcome;
    try {
      outcome = await run(job);
    } catch (e) {
      outcome = { error: String(e?.message ?? e).slice(0, 200) };
    }
    // Every request is logged, allowed or refused — the record of what a
    // remote system read from your disk is the point.
    audit(`${outcome.error ? "REFUSED" : "SERVED "} ${job.op.padEnd(6)} ${job.path}${outcome.error ? `  (${outcome.error})` : ""}`);
    await fetch(`${SAGE_URL}/api/bridge`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: job.id, ...outcome }),
    }).catch(() => {});
  }
}

/**
 * Only poll when this file is the thing that was run.
 *
 * Without the guard, importing it — to test the gate, which is the part worth
 * testing — would start a live poller against whatever SAGE_URL happened to
 * be set. The boundary logic is exported so it can be exercised directly.
 */
const launched = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (launched) {
  const missing = checkConfig();
  if (missing.length) {
    console.error("Refusing to start. Missing:\n  " + missing.join("\n  "));
    process.exit(1);
  }
  audit(`bridge up · ${SAGE_URL}`);
  ROOTS.forEach((r) => audit(`  shared: ${r}`));
  audit("read-only · no writes, no shell · outbound only");
  setInterval(() => void tick(), POLL_MS);
  void tick();
}
