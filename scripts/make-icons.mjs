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

/*
 * The mark's geometry, on the same 100-unit grid as
 * components/ui/sage-mark.tsx. Duplicated rather than imported because this
 * script runs in plain Node and that file is a client component — the two are
 * checked against each other by a test instead.
 */
const HEAD = `
M 50 1 L 56 19 L 61.5 26 L 59 47 L 50 63 L 41 47 L 38.5 26 L 44 19 Z
M 50 21.5 L 58.5 30 L 50 38.5 L 41.5 30 Z
M 41.5 40 L 47.5 47.5 L 45 51.5 L 40 43.5 Z
M 58.5 40 L 52.5 47.5 L 55 51.5 L 60 43.5 Z
`;
const CROSS = `
M 48.2 25.2 L 51.8 25.2 L 51.8 28.4 L 55 28.4 L 55 31.6 L 51.8 31.6
L 51.8 34.8 L 48.2 34.8 L 48.2 31.6 L 45 31.6 L 45 28.4 L 48.2 28.4 Z
`;
const WING_R = `M 56.5 30 C 66 22, 76 13, 88 3 C 86 21, 78 40, 65.5 53 L 59 43 Z`;
const WING_L = `M 43.5 30 C 34 22, 24 13, 12 3 C 14 21, 22 40, 34.5 53 L 41 43 Z`;
const SPIKE_R = `M 54.5 14 L 63 8 L 60.5 30 Z`;
const SPIKE_L = `M 45.5 14 L 37 8 L 39.5 30 Z`;
const ROBE = `
M 43 54 L 57 54 L 58.5 66
C 63 72, 70 80, 74 88 L 80 97 L 20 97 L 26 88
C 30 80, 37 72, 41.5 66 Z
M 48.8 63 L 51.2 63 L 52.1 97 L 47.9 97 Z
M 27.5 87.5 L 72.5 87.5 L 73.9 90.3 L 26.1 90.3 Z
M 24.2 92.4 L 75.8 92.4 L 77.2 95.2 L 22.8 95.2 Z
`;

function svg(inset) {
  const s = 100 - inset * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="${GROUND}"/>
  <g transform="translate(${inset} ${inset}) scale(${s / 100})" fill="${MARK}">
    <path d="${WING_L}"/><path d="${WING_R}"/>
    <path d="${SPIKE_L}"/><path d="${SPIKE_R}"/>
    <path d="${HEAD}" fill-rule="evenodd"/>
    <path d="${CROSS}"/>
    <path d="${ROBE}" fill-rule="evenodd"/>
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
const V = "v3";

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
