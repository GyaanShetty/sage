/**
 * Render the app icons from the SAGE mark.
 *
 * The icons in public/ were the stock files from the day the repo was created:
 * they predate the crowned queen by months, so the home-screen icon, the tab
 * favicon and the PWA install prompt were all still showing artwork belonging
 * to nothing. The in-page mark could not be used directly either — it
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
const INK = "#f2f2f2";

/*
 * The mark's geometry, on the same 100-unit grid as
 * components/ui/sage-mark.tsx. Duplicated rather than imported because this
 * script runs in plain Node and that file is a client component — the two are
 * checked against each other by a test instead.
 */
const MARK = `
M 44.82 0.1 c -0.09 0.06 -1.13 0.26 -2.3 0.46 -8.25 1.41 -17.7 5.63 -24.42 10.94 -2.63
2.06 -7.55 7.48 -9.49 10.44 -3.86 5.86 -6.64 12.55 -7.96 19.16 -0.23 1.11 -0.46 2.11
-0.52 2.22 -0.21 0.38 -0.15 13.2 0.06 13.8 0.1 0.26 0.33 1.26 0.52 2.19 2.71 13.63
10.66 25.4 22.35 33.11 6.04 3.97 12.25 6.16 19.99 7.05 0.89 0.1 2 0.26 2.48 0.36 1.26
0.23 6.56 0.23 7.66 -0.01 0.45 -0.09 1.8 -0.33 3 -0.52 12.83 -2.04 24.55 -8.68 33.18
-18.78 4.62 -5.41 8.63 -14.1 9.95 -21.54 0.13 -0.73 0.35 -1.74 0.47 -2.24 0.22 -0.86
0.23 -1.26 0.23 -7.34 0 -6.42 0 -6.42 -0.36 -6.54 -0.48 -0.16 -41.65 -0.18 -42.09
-0.01 -0.45 0.17 -0.38 0.61 0.26 1.71 1.61 2.71 3.29 4.48 7.32 7.73 1.37 1.12 0.48
1.04 11.21 1.05 10.46 -0 9.83 -0.05 9.83 0.73 0 0.4 -0.43 2.7 -0.79 4.23 -1.3 5.51
-4.72 11.68 -8.93 16.09 -1.73 1.82 -2.02 1.89 -2.3 0.53 -1.49 -7.15 -4.47 -11.36
-11.65 -16.47 -1.19 -0.84 -2.7 -1.69 -5.47 -3.11 -4.39 -2.22 -6.29 -2.94 -13.02 -4.86
-7.79 -2.22 -11.01 -3.63 -14.72 -6.39 -8.26 -6.16 -7.56 -17.14 1.53 -23.96 1.88 -1.42
2.17 -1.59 4.16 -2.58 7.5 -3.73 14.42 -4.65 23.09 -3.06 9.67 1.77 19.12 8.51 23.74
16.94 0.86 1.57 0.12 1.43 8.01 1.43 4.5 -0 6.94 -0.05 7.09 -0.12 0.88 -0.47 -1.57
-6.08 -4.74 -10.83 -4.46 -6.71 -9.84 -11.69 -16.94 -15.69 -4.62 -2.62 -10.28 -4.6
-16.19 -5.68 -0.89 -0.16 -1.76 -0.35 -1.95 -0.4 -0.41 -0.14 -12.04 -0.15 -12.28 -0.01
z m -30.39 45.37 c 0.09 0.12 0.35 0.52 0.55 0.9 3.18 5.75 8.94 9.39 19.9 12.57 3.02
0.88 4.26 1.23 6.2 1.81 11.81 3.53 19.22 10.06 19.23 16.96 0.02 8.08 -8.7 10.92 -21.79
7.13 -14.16 -4.1 -24.94 -19.03 -24.97 -34.55 0 -4.02 0.26 -5.52 0.88 -4.82 z
`;

function svg(inset) {
  const s = 100 - inset * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="${GROUND}"/>
  <g transform="translate(${inset} ${inset}) scale(${s / 100})" fill="${INK}">
    <path d="${MARK}" fill-rule="evenodd"/>
  </g>
</svg>`;
}

// A little air at every size: edge-to-edge the mark reads as cramped next to
// the rounded, padded icons beside it on a homescreen.
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
const V = "v4";

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
