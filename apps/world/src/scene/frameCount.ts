/**
 * The Lattice's own frame count, one per drawn frame (Scene.tsx's heartbeat ticks it). three.js's
 * `renderer.info.render.frame` counts every `render()` call instead, and each frame makes thirty-odd of them (the
 * mirror, the effect passes), so it can't say "one frame ago" (#416).
 */
export const frames = { n: 0 };
