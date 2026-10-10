/** URL switches: ?quality=low, ?debug, ?instant, ?glitch=<id>, ?seed=<n>, ?speed=<n>, ?glitches=off|normal|unhinged. */
const q = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);

export const PARAMS = {
  quality: (q.get("quality") === "low" ? "low" : "high") as "low" | "high",
  debug: q.has("debug"),
  /** Cut instead of fly between rooms (tests, screenshots, slow machines). */
  instant: q.has("instant"),
  glitch: q.get("glitch"),
  seed: Number(q.get("seed") ?? "") || Math.floor(Date.now() / 86_400_000),
  speed: Number(q.get("speed") ?? "") || 1,
  glitches: (["off", "normal", "unhinged"].includes(q.get("glitches") ?? "") ? q.get("glitches") : null) as
    | "off"
    | "normal"
    | "unhinged"
    | null,
};
