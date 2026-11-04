#!/usr/bin/env node
/**
 * The C.E.O. mark and the Desk's icons (#135, #640). The mark is the Lattice C: a pointy-top hexagon of thin silver
 * lines and nodes, open on the right so it reads as a C, its mouth running in to one gold core (Nikita's pick, option
 * 4). Hand-built here from a hexagon of radius 20 on a 48 grid; the Desk header draws the same lines
 * (apps/world/src/desk/DeskNav.tsx, LatticeMark). Written under apps/world/public/desk/ and listed in
 * apps/world/index.html and apps/world/public/manifest.webmanifest:
 *
 *   favicon.svg, favicon-32.png     the browser tab (the small cut: no inner lattice, heavier lines)
 *   icon-192.png, icon-512.png      the app icon (Android, desktop)
 *   icon-maskable-512.png           the same with room to be cropped to a circle or a squircle (Android)
 *   apple-touch-icon.png (180)      the iPhone and iPad home screen
 *   badge-96.png                    the small monochrome badge Android shows in the status bar
 *
 * Usage: node scripts/desk-icons.mjs (sharp is already a dev dependency). Run it again if the mark changes, and bump the
 * `?v=` on every icon URL (index.html, manifest.webmanifest, public/sw.js) so installed apps and browsers fetch the
 * new files instead of the ones they cached (#668; it reads 648, the logo of #648).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const OUT = new URL("../apps/world/public/desk/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const GOLD = "#e8cf9c";
const SILVER = "#c9cfd8";
const INK = "#05070c";

// The hexagon: centre (24,24), radius 20, so its corners sit at x = 24 ± 17.32.
const X0 = 6.68;
const X1 = 41.32;
const XM0 = 15.34; // halfway in, left
const XM1 = 32.66; // halfway in, right
const P = {
  t: [24, 4],
  ul: [X0, 14],
  l: [X0, 24],
  ll: [X0, 34],
  b: [24, 44],
  ur: [X1, 14],
  lr: [X1, 34],
  i1: [24, 14],
  i2: [24, 34],
  c: [24, 24],
};
const pt = (k) => P[k].join(" ");
/** The C itself: the five outer sides, and the mouth running in to the core. */
const OUTER = `M${pt("ur")}L${pt("t")}L${pt("ul")}L${pt("ll")}L${pt("b")}L${pt("lr")}`;
const MOUTH = `M${pt("ur")}L${pt("c")}L${pt("lr")}`;
/** The spokes from the core to the left and to top and bottom. */
const SPOKES = `M${pt("t")}L${pt("b")}M${pt("ul")}L${pt("c")}M${pt("l")}L${pt("c")}M${pt("ll")}L${pt("c")}`;
/** The finer lattice: the four half-lines through each inner node, and the short upright between them. */
const GRID = `M${XM0} 9L${XM1} 19M${XM1} 9L${XM0} 19M${XM0} 39L${XM1} 29M${XM1} 39L${XM0} 29M${XM0} 19L${XM0} 29`;
const NODES = ["t", "ul", "l", "ll", "b", "ur", "lr", "i1", "i2"];

/**
 * The mark on a 48 grid, with lines `w` units wide. `full` keeps the inner lattice and the ring nodes (the header, the
 * large icons); the small cut (favicon, badge) keeps only the C, its mouth and the core, drawn heavier so it holds at
 * 16px.
 */
function markBody({ full = true, mono = false, w = full ? 1.1 : 3.2, glow = true } = {}) {
  const silver = mono ? "#ffffff" : SILVER;
  const gold = mono ? "#ffffff" : GOLD;
  if (!full) {
    const halo = glow && !mono ? `<circle cx="24" cy="24" r="10" fill="url(#core)"/>` : "";
    return `<path d="${OUTER}${MOUTH}" fill="none" stroke="${silver}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>${halo}<circle cx="24" cy="24" r="5.4" fill="${gold}"/>`;
  }
  const r = Math.max(1.25, w * 1.9);
  const nodes = NODES.map((k) => `<circle cx="${P[k][0]}" cy="${P[k][1]}" r="${r.toFixed(2)}"/>`).join("");
  const halo = glow && !mono ? `<circle cx="24" cy="24" r="8" fill="url(#core)"/>` : "";
  const coreR = Math.max(2.1, r * 1.6);
  return (
    `<path d="${OUTER}${MOUTH}${SPOKES}${GRID}" fill="none" stroke="${silver}" stroke-width="${w.toFixed(3)}" stroke-linecap="round" stroke-linejoin="round"${mono ? "" : ' opacity=".78"'}/>` +
    `<g fill="${INK}" stroke="${silver}" stroke-width="${w.toFixed(3)}"${mono ? "" : ' stroke-opacity=".62"'}>${nodes}</g>` +
    `${halo}<circle cx="24" cy="24" r="${coreR.toFixed(2)}" fill="${INK}" stroke="${gold}" stroke-width="${(w * 1.15).toFixed(3)}"/>` +
    `<circle cx="24" cy="24" r="${(coreR * 0.7).toFixed(2)}" fill="${gold}"/>`
  );
}

const CORE_GRADIENT = `<radialGradient id="core"><stop offset="0" stop-color="${GOLD}" stop-opacity=".9"/><stop offset=".4" stop-color="${GOLD}" stop-opacity=".3"/><stop offset="1" stop-color="${GOLD}" stop-opacity="0"/></radialGradient>`;
const SKY = `<radialGradient id="sky" cx="50%" cy="46%" r="72%"><stop offset="0" stop-color="#121a2c"/><stop offset=".6" stop-color="#090d18"/><stop offset="1" stop-color="${INK}"/></radialGradient>`;

/** A square icon of `canvas` px with the mark `size` px tall in the middle, its lines `px` pixels wide. */
function icon(canvas, size, { px, ...opts } = {}) {
  const { bg = true } = opts;
  const s = size / 40; // the mark spans y 4..44 (40 units) and x 6.68..41.32
  const off = (canvas - 48 * s) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas}" height="${canvas}" viewBox="0 0 ${canvas} ${canvas}">
  <defs>${SKY}${CORE_GRADIENT}</defs>
  ${bg ? `<rect width="${canvas}" height="${canvas}" fill="url(#sky)"/>` : ""}
  <g transform="translate(${off.toFixed(2)} ${off.toFixed(2)}) scale(${s.toFixed(4)})">${markBody({ ...opts, w: px / s })}</g>
</svg>`;
}

const png = (svg, file) => sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(OUT + file);

// The tab icon: the small cut on the night square, rounded so it sits softly in a tab strip.
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><defs>${CORE_GRADIENT}</defs><rect width="48" height="48" rx="9" fill="${INK}"/><g transform="translate(24 24) scale(1.06) translate(-24 -24)">${markBody({ full: false })}</g></svg>\n`;
writeFileSync(OUT + "favicon.svg", favicon);
await sharp(Buffer.from(favicon)).resize(32, 32).png({ compressionLevel: 9 }).toFile(OUT + "favicon-32.png");

await png(icon(192, 124, { px: 2.4 }), "icon-192.png");
await png(icon(512, 330, { px: 4.6 }), "icon-512.png");
// Maskable: the mark inside the middle 80% (the safe zone), so any mask shape keeps it whole.
await png(icon(512, 250, { px: 4 }), "icon-maskable-512.png");
await png(icon(180, 118, { px: 2.3 }), "apple-touch-icon.png");
// The badge is drawn as a silhouette by Android: white on transparent, the small cut so it holds at 24dp.
await png(icon(96, 80, { bg: false, mono: true, full: false, px: 7 }), "badge-96.png");
console.log("Wrote the mark and the Desk's icons to apps/world/public/desk/.");
