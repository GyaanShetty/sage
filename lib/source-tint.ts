/**
 * One colour per publisher, stable everywhere on the wall.
 *
 * The same outlet should be the same colour in the wire, in hot topics and
 * in the picture wall, so a column of stories shows its spread without
 * being read. Hashing the name rather than keeping a lookup table means a
 * feed added tomorrow gets a slot without anyone remembering to assign one.
 *
 * Five slots, never cycled past five in a way that matters: two publishers
 * sharing a colour is acceptable here in a way it is not in a chart,
 * because this is a secondary cue — the name is always written beside it —
 * rather than the encoding itself. A chart may not do this.
 */
const SLOTS = 5;

export function sourceTint(name: string): string {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `src-${(Math.abs(h) % SLOTS) + 1}`;
}
