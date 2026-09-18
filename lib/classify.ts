/**
 * Sorting a headline into a desk.
 *
 * Keyword matching, not a model: the feed refreshes every few minutes and
 * classifying two dozen headlines through an LLM each time would cost more
 * than the feed is worth and be slower than reading them. It is a heuristic
 * and it is wrong sometimes — which is why the source is always shown beside
 * the desk, so a mislabelled item is still traceable to where it came from.
 *
 * Order matters: the first desk that matches wins, and the list runs from
 * most specific to least. GENERAL is the honest answer for anything that
 * matches nothing, rather than guessing it into a desk it does not belong to.
 */

export const DESKS = ["MARKETS", "CRYPTO", "TECH", "AI", "GEO", "DEFENSE", "ENERGY", "GENERAL"] as const;
export type Desk = (typeof DESKS)[number];

const RULES: [Desk, RegExp][] = [
  ["CRYPTO", /\b(bitcoin|btc|ethereum|eth\b|crypto|blockchain|stablecoin|defi|solana|binance|coinbase)\b/i],
  ["AI", /\b(ai\b|a\.i\.|artificial intelligence|openai|anthropic|llm|chatgpt|gemini|neural|machine learning)\b/i],
  ["DEFENSE", /\b(military|defen[cs]e|missile|troops|airstrike|nato|warship|army|navy|drone strike)\b/i],
  ["ENERGY", /\b(oil|opec|crude|barrel|gas prices|refinery|solar|nuclear plant|electricity|power grid)\b/i],
  ["GEO", /\b(ukraine|russia|israel|gaza|china|taiwan|iran|border|sanction|diplomat|summit|election|parliament|houthi)\b/i],
  // `market` without the optional s never matched "markets", which is the
  // form almost every headline uses — the commonest word on the desk was the
  // one word that did not fire.
  ["MARKETS", /\b(stocks?|shares?|markets?|nasdaq|s&p|sensex|nifty|dow|rupee|dollar|inflation|fed\b|rbi|earnings|ipo|bonds?|yields?)\b/i],
  ["TECH", /\b(tech|chips?|semiconductors?|nvidia|apple|google|microsoft|meta\b|startups?|software|apps?|cyber|hack|breach|iphone|android|kernel|linux)\b/i],
];

export function deskOf(title: string): Desk {
  for (const [desk, re] of RULES) if (re.test(title)) return desk;
  return "GENERAL";
}
