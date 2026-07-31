import { asciiText, asciiWidth } from "@/lib/ascii-font";

/**
 * A heading rendered in the block alphabet.
 *
 * Type, not an image: crisp at any zoom, themeable, weightless, and selectable.
 * The real text goes in aria-label and a visually-hidden span, so screen
 * readers and page search get the word rather than a wall of blocks.
 *
 * `scale` is a multiplier on the base cell size. The width is computed from the
 * glyph table so long titles shrink to fit instead of wrapping — wrapped block
 * art is illegible, which is worse than small block art.
 */
export function AsciiTitle({
  text,
  scale = 1,
  className = "",
  glow = true,
}: {
  text: string;
  scale?: number;
  className?: string;
  glow?: boolean;
}) {
  const art = asciiText(text);
  const cells = asciiWidth(text);
  if (!art) return <span className={className}>{text}</span>;

  return (
    <span className={`ascii-title ${className}`}>
      <pre
        aria-hidden
        className={glow ? "ascii-art glow" : "ascii-art"}
        style={{
          // Cell width is ~0.6em of font-size in a monospace face, so this
          // keeps the whole word inside its container at any title length.
          fontSize: `min(${scale * 13}px, ${(scale * 92) / cells}vw)`,
        }}
      >
        {art}
      </pre>
      <span className="sr-only">{text}</span>
    </span>
  );
}
