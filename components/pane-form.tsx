"use client";

import { useState } from "react";

/**
 * The editor every pane shares.
 *
 * Panes were read-only: each showed a number that could only be changed by
 * leaving for the page behind it — which, on a screen whose whole point is
 * that everything is already in front of you, was the one thing still making
 * him navigate.
 *
 * Declarative rather than thirteen hand-written forms, because thirteen forms
 * drift: the third one gets a busy state the first two never got, the fifth
 * forgets to clear on success, and the ninth posts a number as a string. One
 * component means one set of behaviours, and fixing any of them fixes all of
 * them.
 */

export type FieldType = "text" | "number" | "date" | "datetime" | "select";

export interface Field {
  name: string;
  label: string;
  type?: FieldType;
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  /** Sent when the field is left empty. Lets a form default without pre-filling. */
  fallback?: string | number;
}

/**
 * Turn the raw string values a form holds into the JSON the API expects.
 *
 * Two things this exists to get right, both of which produce a 400 that reads
 * as "the form is broken" rather than as bad input:
 *
 * - A number field must post a number. `amount: "250"` reaching a
 *   `z.number()` schema is rejected, and nothing on screen says why.
 * - An empty optional field must be *omitted*, not sent as `""`. An empty
 *   string is a value; it fails date parsing and overwrites real data with
 *   nothing on an upsert.
 *
 * Pure and exported so both can be tested — neither is visible in a browser
 * until the request fails.
 */
export function buildPayload(fields: Field[], values: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = (values[f.name] ?? "").trim();
    if (!raw) {
      if (f.fallback !== undefined) out[f.name] = f.fallback;
      continue;
    }
    if (f.type === "number") {
      const n = Number(raw);
      if (Number.isFinite(n)) out[f.name] = n;
      continue;
    }
    if (f.type === "date" || f.type === "datetime") {
      // Datetime-local has no zone, so it is read as local time and sent as an
      // instant. Posting the bare string would have the server read it as UTC
      // and file everything five and a half hours early.
      const t = Date.parse(f.type === "date" ? `${raw}T09:00` : raw);
      if (Number.isFinite(t)) out[f.name] = new Date(t).toISOString();
      continue;
    }
    out[f.name] = raw;
  }
  return out;
}

/** Which required fields are still empty. Empty array means submittable. */
export function missingRequired(fields: Field[], values: Record<string, string>): string[] {
  return fields.filter((f) => f.required && !(values[f.name] ?? "").trim()).map((f) => f.label);
}

export function PaneForm({
  endpoint,
  fields,
  submitLabel = "ADD",
  method = "POST",
  extra,
  onDone,
}: {
  endpoint: string;
  fields: Field[];
  submitLabel?: string;
  method?: "POST" | "PATCH";
  /** Constants the API needs that are not worth asking for — a `kind`, say. */
  extra?: Record<string, unknown>;
  onDone?: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const set = (name: string, v: string) => {
    setValues((s) => ({ ...s, [name]: v }));
    setNote(null);
  };

  const submit = async () => {
    const missing = missingRequired(fields, values);
    if (missing.length) {
      // Name the field. "Invalid input" sends you hunting through six of them.
      setNote(`${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} required.`);
      return;
    }

    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(endpoint, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...buildPayload(fields, values), ...extra }),
      });
      const j = await res.json().catch(() => null);

      if (j?.ok === false || !res.ok) {
        setNote(j?.error ?? `Rejected (${res.status}).`);
        return;
      }
      // Cleared only on success: a failed submit that wipes what you typed is
      // worse than the failure.
      setValues({});
      setNote("Saved.");
      onDone?.();
    } catch (err) {
      setNote(err instanceof Error ? `Couldn't reach SAGE: ${err.message}` : "Couldn't reach SAGE.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pfm">
      {fields.map((f) => (
        <label className="pfm-f" key={f.name}>
          <span className="pfm-l">{f.label}{f.required && <i>*</i>}</span>
          {f.type === "select" ? (
            <select value={values[f.name] ?? ""} onChange={(e) => set(f.name, e.target.value)}>
              <option value="">—</option>
              {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <input
              type={f.type === "number" ? "number" : f.type === "date" ? "date" : f.type === "datetime" ? "datetime-local" : "text"}
              value={values[f.name] ?? ""}
              placeholder={f.placeholder}
              onChange={(e) => set(f.name, e.target.value)}
              // Enter submits from any field: this is a one-line entry form,
              // and reaching for the button every time is the friction that
              // stops things being logged at all.
              onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
            />
          )}
        </label>
      ))}

      <button className="pfm-go" onClick={() => void submit()} disabled={busy}>
        {busy ? "…" : submitLabel}
      </button>
      {note && <span className="pfm-note">{note}</span>}
    </div>
  );
}
