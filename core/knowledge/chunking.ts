export interface TextChunk {
  content: string;
  position: number;
  metadata: Record<string, unknown>;
}

/**
 * Word-window chunking with overlap (~500 words ≈ 600–700 tokens).
 * Structure-aware chunking (headings/pages) can layer on later without
 * changing the storage shape.
 */
export function chunkText(
  text: string,
  metadata: Record<string, unknown> = {},
  wordsPerChunk = 450,
  overlap = 60,
): TextChunk[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  if (words.length === 0 || (words.length === 1 && !words[0])) return [];
  const chunks: TextChunk[] = [];
  let position = 0;
  for (let start = 0; start < words.length; start += wordsPerChunk - overlap) {
    const slice = words.slice(start, start + wordsPerChunk);
    if (slice.length < 20 && position > 0) break; // skip trailing crumbs
    chunks.push({ content: slice.join(" "), position: position++, metadata });
    if (start + wordsPerChunk >= words.length) break;
  }
  return chunks;
}
