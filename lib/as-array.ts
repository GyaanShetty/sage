/**
 * Whatever it is, hand back an array.
 *
 * A tile that reads `j?.data?.items ?? j?.data ?? []` looks defensive and is
 * not: when the endpoint returns an object without that key, the second branch
 * yields the *object*, and the next `.map()` or `.slice()` throws. In a React
 * tree one throw is not one broken tile — it unmounts the whole app and shows
 * "a client-side exception has occurred", which is exactly what happened here.
 *
 * It looked fine in development because every endpoint was failing and every
 * tile fell through to its catch. Real data is what triggered it.
 *
 * So: never trust a payload's shape. An unexpected shape renders an empty
 * panel, which is honest and survivable; a crash is neither.
 */
export function asArray<T = unknown>(...candidates: unknown[]): T[] {
  for (const c of candidates) if (Array.isArray(c)) return c as T[];
  return [];
}
