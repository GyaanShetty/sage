/**
 * Render the app icons from the SAGE mark.
 *
 * The icons in public/ were the stock files from the day the repo was created:
 * they predate the crowned queen by months, so the home-screen icon, the tab
 * favicon and the PWA install prompt were all still showing artwork belonging
 * to nothing. `public/sage-mark.svg` could not be used directly either — it
 * paints with `currentColor` and `var(--background)`, which resolve inside a
 * page and are black-on-black in a standalone file.
 *
 * So the geometry lives here once, with explicit colours, and every size is
 * rendered from it. Checked in rather than run at build time because the
 * output is four binaries that should change only when the mark does, and a
 * build step that regenerates binaries makes every deploy a diff.
 *
 *   node scripts/make-icons.mjs
 */
import sharp from "sharp";
import { writeFileSync } from "node:fs";

const GROUND = "#070708";
const MARK = "#ff3b30";

/** The mark's paths, on the same 100-unit grid as components/ui/sage-mark.tsx. */
const PATHS = [
  "M14 12 L31 34 L38 30 L50 44 L34 44 L20 26 Z",
  "M86 12 L69 34 L62 30 L50 44 L66 44 L80 26 Z",
  "M50 6 L60 28 L50 38 L40 28 Z",
  "M32 42 L68 42 L50 62 Z",
  "M43 58 H57 Q60 72 63 84 H37 Q40 72 43 58 Z",
  "M35 86 H65 L67 92 H33 Z",
  "M31 94 H69 L71 99 H29 Z",
];
const CROSS = "M47 20 h6 v5 h5 v6 h-5 v5 h-6 v-5 h-5 v-6 h5 z";

/**
 * `inset` is how much of the square the mark leaves empty on each side.
 *
 * Maskable icons are cropped to whatever shape the launcher likes — a circle
 * on most Android homescreens — so the mark has to sit inside the safe zone,
 * which is the middle 80%. Everything outside it is decoration the platform is
 * allowed to cut off, and a crown whose points get shaved is worse than a
 * smaller crown.
 */
function svg(inset) {
  const s = 100 - inset * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="${GROUND}"/>
  <g transform="translate(${inset} ${inset}) scale(${s / 100})">
    <g fill="${MARK}">${PATHS.map((d) => `<path d="${d}"/>`).join("")}</g>
    <path d="${CROSS}" fill="${GROUND}"/>
  </g>
</svg>`;
}

// A little air at every size: the mark is tall and thin, and edge-to-edge it
// reads as cramped next to the rounded, padded icons beside it on a homescreen.
const STANDARD = Buffer.from(svg(14));
const MASKABLE = Buffer.from(svg(22));

/*
 * The version suffix is the point, not decoration.
 *
 * Icons are cached harder than anything else on the web: a browser will serve
 * /icon-192.png from disk for months, and an installed PWA keeps the icon it
 * was installed with essentially forever. Replacing the bytes at the same URL
 * therefore changes nothing on the device that already has it. A new filename
 * is the only reliable way to make a new icon actually appear.
 *
 * Bump this when the mark changes, and update app/layout.tsx, app/manifest.ts
 * and public/sw.js to match.
 */
const V = "v2";

const out = [
  [`public/icon-192-${V}.png`, STANDARD, 192],
  [`public/icon-512-${V}.png`, STANDARD, 512],
  [`public/icon-maskable-${V}.png`, MASKABLE, 512],
  [`public/apple-icon-${V}.png`, STANDARD, 180], // iOS home screen
];

for (const [path, src, size] of out) {
  await sharp(src).resize(size, size).png().toFile(path);
  console.log("wrote", path, size);
}

// The manifest lists this first, so it has to stand on its own — no
// currentColor, no CSS variables.
writeFileSync(`public/sage-mark-${V}.svg`, svg(14).replace(/width="1024" height="1024"/, 'role="img" aria-label="SAGE"') + "\n");
console.log(`wrote public/sage-mark-${V}.svg`);
