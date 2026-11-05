import { COUNCIL_RC } from "../council/deskPulses.ts";

/**
 * Today's chamber, warmed while the Desk is idle on another room (#759). Today is the likeliest next room, and a cold
 * first open spent seconds building the chamber and compiling its programs before it drew (the numbers are on #759).
 * This builds it once off screen with the same settings (same model, same pods' colours, same phone or desktop
 * programs), draws one frame and lets it go. What stays: the model (modelCache.ts), the pods' recoloured textures
 * (recolor.ts's cache) and the browser's compiled programs (its shader cache), so the real chamber builds and draws
 * its first frame quickly. Once per page, in idle time, and only where the Lattice warm-up would run (latticeWarm.ts):
 * a desktop with memory to spare, never a phone (the build is a few hundred milliseconds of main thread there too, and
 * #401 showed what building out of sight costs a small device), never with Data Saver or on a slow connection, nor in
 * an automated browser unless it asks (`window.__ceoWarm`).
 */

type Nav = Navigator & { connection?: { saveData?: boolean; effectiveType?: string }; webdriver?: boolean; deviceMemory?: number };

let warmed: Promise<void> | null = null;

export function canWarm(): boolean {
  if (typeof window === "undefined" || !import.meta.env.PROD) return false;
  const nav = navigator as Nav;
  if (nav.webdriver && !(window as Window & { __ceoWarm?: boolean }).__ceoWarm) return false;
  if (nav.deviceMemory !== undefined && nav.deviceMemory < 4) return false;
  if (window.matchMedia?.("(pointer: coarse)").matches) return false;
  const conn = nav.connection;
  return !(conn?.saveData || /(^|-)(2g|3g)$/.test(conn?.effectiveType ?? ""));
}

const hex = (rgb: string) => `#${rgb.split(",").map((v) => Number(v).toString(16).padStart(2, "0")).join("")}`;

/** Build Today's chamber off screen once, draw a frame, and dispose it. Safe to call often. */
export function warmRotunda(): Promise<void> {
  if (warmed) return warmed;
  warmed = (async () => {
    const { createRotunda } = await import("./rotundaScene.ts");
    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    // Rotunda.tsx's own test for a phone, so the warm build compiles the same programs (no shadows on a phone).
    const phone = typeof window.matchMedia === "function" && window.matchMedia("(max-width: 760px)").matches;
    const seats = Object.entries(COUNCIL_RC).map(([id, rgb]) => ({ id, title: id, room: id, colour: hex(rgb), alive: true, working: false }));
    const c = await createRotunda(host, canvas, { phone, reduce: true, seats, onFloor: () => {}, onDone: () => {}, onPlace: () => {}, safeBottom: () => 0 });
    c.dispose();
  })().catch(() => {});
  return warmed;
}
