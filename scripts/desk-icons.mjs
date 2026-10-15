#!/usr/bin/env node
/**
 * The Desk's home-screen icons (#135), drawn from the Desk's own mark (the tide line and its two arcs, in the
 * header and the favicon) on the Lattice's navy, with the mark's ice glow. Written as PNG under
 * apps/world/public/desk/ and listed in apps/world/public/manifest.webmanifest:
 *
 *   icon-192.png, icon-512.png       the app icon (Android, desktop)
 *   icon-maskable-512.png           the same with room to be cropped to a circle or a squircle (Android)
 *   apple-touch-icon.png (180)      the iPhone and iPad home screen
 *   badge-96.png                    the small monochrome badge Android shows in the status bar
 *
 * Usage: node scripts/desk-icons.mjs (sharp is already a dev dependency). Run it again if the mark changes.
 */
import { mkdirSync } from "node:fs";
import sharp from "sharp";

const OUT = new URL("../apps/world/public/desk/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

/** The mark, as the Desk draws it (viewBox 0 0 32 32), centred and scaled to `size` of a `canvas` square. */
function mark(canvas, size, { glow = true, bg = true, mono = false } = {}) {
  const s = size / 32;
  const off = (canvas - size) / 2;
  const ice = mono ? "#ffffff" : "#8fe8ff";
  const silver = mono ? "#ffffff" : "#e8f1ff";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas}" height="${canvas}" viewBox="0 0 ${canvas} ${canvas}">
  <defs>
    <radialGradient id="sky" cx="50%" cy="42%" r="70%">
      <stop offset="0" stop-color="#13264a"/>
      <stop offset="0.55" stop-color="#0a1428"/>
      <stop offset="1" stop-color="#04060b"/>
    </radialGradient>
    <filter id="glow" filterUnits="userSpaceOnUse" x="0" y="0" width="${canvas}" height="${canvas}">
      <feGaussianBlur stdDeviation="${(canvas / 90).toFixed(2)}" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  ${bg ? `<rect width="${canvas}" height="${canvas}" fill="url(#sky)"/>` : ""}
  <g ${glow ? 'filter="url(#glow)"' : ""}><g transform="translate(${off} ${off}) scale(${s})">
    <path d="M16 3v26M9 9a7 7 0 0 1 14 0M10 23a6 6 0 0 0 12 0" fill="none" stroke="${ice}" stroke-width="1.4" stroke-linecap="round"/>
    <circle cx="16" cy="16" r="2.4" fill="${silver}"/>
  </g></g>
</svg>`;
}

const png = (svg, file) => sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(OUT + file);

await png(mark(192, 132), "icon-192.png");
await png(mark(512, 352), "icon-512.png");
// Maskable: the mark inside the middle 80% (the safe zone), so any mask shape keeps it whole.
await png(mark(512, 260), "icon-maskable-512.png");
await png(mark(180, 124), "apple-touch-icon.png");
// The badge is drawn as a silhouette by Android: white on transparent.
await png(mark(96, 84, { glow: false, bg: false, mono: true }), "badge-96.png");
console.log("Wrote the Desk's icons to apps/world/public/desk/.");
