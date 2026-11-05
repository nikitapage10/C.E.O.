/**
 * WASD to look around (#776): one helper every Desk 3D scene shares. W/S/A/D and the arrow keys pan the camera's
 * target over the ground, relative to where the camera looks; Q/E turn it where the scene already orbits. The pan
 * stretches to the scene's border with a rubber-band give past 80% and stops hard at the edge, eases back inside when
 * the keys let go, and returns home on Escape or after a few idle seconds.
 *
 * It listens only while the scene is hovered or has focus, never while something is being typed into (Skippy's chat,
 * a quick-add), and not at all on a touch-only device. A scene owns its camera; it calls `step(dt)` each frame and
 * adds `x`/`z` to its camera's target and position:
 *
 * ```ts
 * const pan = wasdPan({ el: host, bounds: () => ({ kind: "disc", cx: 0, cz: 0, r: 8 }), origin: () => [look.x, look.z], forward: () => [look.x - cam.position.x, look.z - cam.position.z] });
 * // in the frame: pan.step(dt); cam.position.x += pan.x; cam.position.z += pan.z; ... lookAt(look.x + pan.x, look.y, look.z + pan.z)
 * ```
 */

/** Where the camera's target may go, in world units on the ground (x, z). */
export type PanBounds = { kind: "box"; x0: number; x1: number; z0: number; z1: number } | { kind: "disc"; cx: number; cz: number; r: number };

/** Past this share of the way to the border, the pan meets resistance. */
export const SOFT = 0.8;
/** How quickly the pan gets up to speed and stops (1/s). */
const ACCEL = 9;
/** How quickly it springs back inside the soft edge once the keys let go (1/s). */
const SETTLE = 6;
/** How quickly it returns home (1/s). */
const RETURN = 3.2;
/** Q/E's turn (rad/s). */
const TURN = 1.1;
const EPS = 1e-4;

/** How much of an outward step gets through at `f` of the way to the border: all of it inside SOFT, none at the border. */
export function edgeFactor(f: number, soft = SOFT): number {
  if (f <= soft) return 1;
  if (f >= 1) return 0;
  const u = (1 - f) / (1 - soft);
  return u * u;
}

/** One axis of a box: the step (d) from u (position over the half-width, from the centre), resisted and clamped. */
function axis(p: number, d: number, c: number, h: number): number {
  if (h <= 0) return c;
  const u = (p - c) / h;
  const out = d !== 0 && (u === 0 || Math.sign(d) === Math.sign(u));
  const n = p + (out ? d * edgeFactor(Math.abs(u)) : d);
  return Math.max(c - h, Math.min(c + h, n));
}

/** Move a target point (px, pz) by (dx, dz) inside the bounds: free inside SOFT, resisted past it, stopped at the border. */
export function constrain(b: PanBounds, px: number, pz: number, dx: number, dz: number): [number, number] {
  if (b.kind === "box") {
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    return [axis(px, dx, cx, (b.x1 - b.x0) / 2), axis(pz, dz, cz, (b.z1 - b.z0) / 2)];
  }
  const ox = px - b.cx, oz = pz - b.cz, d = Math.hypot(ox, oz);
  let sx = dx, sz = dz;
  if (d > EPS && b.r > 0) {
    // Split the step into its outward part (resisted) and the rest (free).
    const nx = ox / d, nz = oz / d, rad = dx * nx + dz * nz;
    if (rad > 0) {
      const k = edgeFactor(d / b.r);
      sx = dx - rad * nx + rad * k * nx;
      sz = dz - rad * nz + rad * k * nz;
    }
  }
  let x = ox + sx, z = oz + sz;
  const e = Math.hypot(x, z);
  if (e > b.r) {
    x *= b.r / e;
    z *= b.r / e;
  }
  return [b.cx + x, b.cz + z];
}

/** How far toward the border a point is: 0 at the centre, 1 on it (a box measures each axis, the larger wins). */
export function fracOf(b: PanBounds, px: number, pz: number): number {
  if (b.kind === "disc") return b.r > 0 ? Math.hypot(px - b.cx, pz - b.cz) / b.r : 0;
  const hx = (b.x1 - b.x0) / 2, hz = (b.z1 - b.z0) / 2;
  const fx = hx > 0 ? Math.abs(px - (b.x0 + b.x1) / 2) / hx : 0, fz = hz > 0 ? Math.abs(pz - (b.z0 + b.z1) / 2) / hz : 0;
  return Math.max(fx, fz);
}

/** Pull a point that's past the soft edge back toward it, by `k` (0 to 1) of the way. A point inside stays put. */
export function settle(b: PanBounds, px: number, pz: number, k: number, soft = SOFT): [number, number] {
  if (b.kind === "disc") {
    const ox = px - b.cx, oz = pz - b.cz, d = Math.hypot(ox, oz), lim = b.r * soft;
    if (d <= lim) return [px, pz];
    const nd = d + (lim - d) * k;
    return [b.cx + (ox / d) * nd, b.cz + (oz / d) * nd];
  }
  const one = (p: number, c: number, h: number) => {
    const lim = h * soft, o = p - c;
    if (Math.abs(o) <= lim) return p;
    return c + Math.sign(o) * (Math.abs(o) + (lim - Math.abs(o)) * k);
  };
  return [one(px, (b.x0 + b.x1) / 2, (b.x1 - b.x0) / 2), one(pz, (b.z0 + b.z1) / 2, (b.z1 - b.z0) / 2)];
}

/** What a key does: by its physical place (`KeyboardEvent.code`), so it works on any layout. */
export type PanKey = "fwd" | "back" | "left" | "right" | "ccw" | "cw" | "home";
export function keyOf(code: string): PanKey | null {
  switch (code) {
    case "KeyW":
    case "ArrowUp":
      return "fwd";
    case "KeyS":
    case "ArrowDown":
      return "back";
    case "KeyA":
    case "ArrowLeft":
      return "left";
    case "KeyD":
    case "ArrowRight":
      return "right";
    case "KeyQ":
      return "ccw";
    case "KeyE":
      return "cw";
    case "Escape":
      return "home";
    default:
      return null;
  }
}

/** The part of an element the guard reads: a real Element, or a stand-in in tests. */
export interface Typable {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
  getAttribute?: (n: string) => string | null;
}

const NOT_TEXT = new Set(["button", "checkbox", "radio", "range", "submit", "reset", "color", "file", "image"]);

/** Is this element something the person types into? Then the keys are theirs, not the camera's. */
export function isTyping(el: Typable | null | undefined): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = (el.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !NOT_TEXT.has((el.type ?? "text").toLowerCase());
  const role = el.getAttribute?.("role");
  return role === "textbox" || role === "combobox" || role === "searchbox";
}

/** Should a key press move the camera? Only over (or focused in) the scene, with no modifier, and nothing being typed. */
export function shouldHandle(o: { hovered: boolean; focusedIn: boolean; active: Typable | null; mods: boolean; enabled?: boolean }): boolean {
  if (o.enabled === false || o.mods) return false;
  if (isTyping(o.active)) return false;
  return o.hovered || o.focusedIn;
}

export interface PanCoreOpts {
  bounds: () => PanBounds | null;
  /** The camera's target without the pan (world x, z). */
  origin: () => [number, number];
  /** The direction the camera looks along, on the ground (needn't be unit length). */
  forward: () => [number, number];
  /** World units a second at full speed; by default from the bounds' size. */
  speed?: () => number;
  /** Q/E's turn, for a scene that already orbits. */
  rotate?: (rad: number) => void;
  /** Idle time before it eases home (ms). */
  returnMs?: number;
  reduce?: boolean;
  onHome?: () => void;
}

/** The pan's state and its per-frame step, with no DOM (wasdPan wires the keys to it). */
export class PanCore {
  x = 0;
  z = 0;
  vx = 0;
  vz = 0;
  held = new Set<PanKey>();
  returning = false;
  private clock = 0;
  private lastKey = -Infinity;

  constructor(private o: PanCoreOpts) {}

  press(k: PanKey) {
    if (k === "home") return this.home();
    this.held.add(k);
    this.returning = false;
    this.lastKey = this.clock;
  }

  release(k: PanKey) {
    if (this.held.delete(k)) this.lastKey = this.clock;
  }

  clear() {
    this.held.clear();
  }

  /** Ease back to the scene's own view (at once with reduced motion). */
  home() {
    this.held.clear();
    if (!this.x && !this.z && !this.vx && !this.vz) return;
    this.returning = true;
  }

  /** Moving, holding a key, or still away from home: the scene should keep drawing. */
  get busy(): boolean {
    return this.held.size > 0 || this.returning || Math.abs(this.vx) + Math.abs(this.vz) > EPS || this.x !== 0 || this.z !== 0;
  }

  private defaultSpeed(b: PanBounds | null): number {
    if (!b) return 4;
    return b.kind === "box" ? Math.max(b.x1 - b.x0, b.z1 - b.z0) * 0.45 : b.r * 0.9;
  }

  /** Advance by dt seconds. True when the pan or the turn changed (the scene should apply its camera). */
  step(dtIn: number): boolean {
    const dt = Math.max(0, Math.min(0.1, dtIn));
    this.clock += dt * 1000;
    const { reduce } = this.o;
    const was = [this.x, this.z];
    let turned = false;
    // Q/E turn, for a scene that orbits.
    if (this.o.rotate) {
      const t = (this.held.has("cw") ? 1 : 0) - (this.held.has("ccw") ? 1 : 0);
      if (t && dt) {
        this.o.rotate(t * TURN * dt);
        turned = true;
      }
    }
    const f = (this.held.has("fwd") ? 1 : 0) - (this.held.has("back") ? 1 : 0);
    const r = (this.held.has("right") ? 1 : 0) - (this.held.has("left") ? 1 : 0);
    const b = this.o.bounds();
    // Idle for a while: home.
    if (!this.held.size && (this.x || this.z) && !this.returning && this.clock - this.lastKey > (this.o.returnMs ?? 5000)) this.returning = true;
    if (this.returning) {
      this.vx = this.vz = 0;
      const k = reduce ? 1 : 1 - Math.exp(-RETURN * dt);
      this.x -= this.x * k;
      this.z -= this.z * k;
      if (Math.hypot(this.x, this.z) < 0.002) {
        this.x = this.z = 0;
        this.returning = false;
        this.o.onHome?.();
      }
      return turned || this.x !== was[0] || this.z !== was[1];
    }
    // The wanted velocity, along the view (forward) and across it (right).
    let [fx, fz] = this.o.forward();
    const fl = Math.hypot(fx, fz) || 1;
    fx /= fl;
    fz /= fl;
    let ix = f * fx - r * fz, iz = f * fz + r * fx;
    const il = Math.hypot(ix, iz);
    if (il > 1) {
      ix /= il;
      iz /= il;
    }
    const sp = this.o.speed?.() ?? this.defaultSpeed(b);
    const k = reduce ? 1 : 1 - Math.exp(-ACCEL * dt);
    this.vx += (ix * sp - this.vx) * k;
    this.vz += (iz * sp - this.vz) * k;
    if (Math.abs(this.vx) < EPS && !ix) this.vx = 0;
    if (Math.abs(this.vz) < EPS && !iz) this.vz = 0;
    const [ox, oz] = this.o.origin();
    let px = ox + this.x, pz = oz + this.z;
    if (this.vx || this.vz) {
      if (b) [px, pz] = constrain(b, px, pz, this.vx * dt, this.vz * dt);
      else {
        px += this.vx * dt;
        pz += this.vz * dt;
      }
    }
    // Keys up: back inside the soft edge.
    if (b && !this.held.size && (this.x || this.z)) [px, pz] = settle(b, px, pz, reduce ? 1 : 1 - Math.exp(-SETTLE * dt));
    this.x = px - ox;
    this.z = pz - oz;
    if (Math.abs(this.x) < 1e-6) this.x = 0;
    if (Math.abs(this.z) < 1e-6) this.z = 0;
    return turned || this.x !== was[0] || this.z !== was[1];
  }
}

export interface WasdPanOpts extends PanCoreOpts {
  /** The scene's host: hovering it or focusing in it lets the keys through, and the hint shows on it. */
  el: HTMLElement;
  /** False while the scene shouldn't take keys (say, content open over it). */
  enabled?: () => boolean;
  /** Show the one-time hint (default true). */
  hint?: boolean;
}

export interface WasdPan {
  readonly x: number;
  readonly z: number;
  /** Keep drawing frames while this is true (a held key, a glide, a return). */
  readonly busy: boolean;
  step(dt: number): boolean;
  home(): void;
  dispose(): void;
}

const HINT_KEY = "ceo:wasd-hint";
const mm = (q: string) => (typeof matchMedia === "function" ? matchMedia(q).matches : false);

function hintSeen(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return true;
  }
}
function markHint() {
  try {
    localStorage.setItem(HINT_KEY, "1");
  } catch {
    /* blocked storage: shown again next time */
  }
}

/** Wire the keys to a pan for a scene. On a touch-only device it does nothing (x and z stay 0). */
export function wasdPan(o: WasdPanOpts): WasdPan {
  const core = new PanCore(o);
  const el = o.el;
  // Phones and touch-only tablets: no keys to read.
  if (typeof window === "undefined" || !mm("(any-pointer: fine)")) {
    return { x: 0, z: 0, busy: false, step: () => false, home: () => undefined, dispose: () => undefined };
  }
  let hovered = false;
  let hint: HTMLElement | null = null;
  let hintTimer = 0;
  const offs: (() => void)[] = [];
  const on = (t: EventTarget, k: string, f: (e: Event) => void) => {
    t.addEventListener(k, f);
    offs.push(() => t.removeEventListener(k, f));
  };
  const dropHint = (remember: boolean) => {
    window.clearTimeout(hintTimer);
    if (remember) markHint();
    if (!hint) return;
    const h = hint;
    hint = null;
    h.style.opacity = "0";
    window.setTimeout(() => h.remove(), o.reduce ? 0 : 400);
  };
  const showHint = () => {
    if (hint || o.hint === false || hintSeen() || !mm("(hover: hover) and (pointer: fine)")) return;
    if (getComputedStyle(el).position === "static") el.style.position = "relative";
    const h = document.createElement("div");
    h.className = "wasd-hint";
    h.setAttribute("role", "note");
    h.style.cssText =
      "position:absolute;left:14px;bottom:14px;z-index:6;display:flex;align-items:center;gap:8px;padding:5px 6px 5px 10px;border-radius:999px;background:rgba(8,9,14,.78);border:1px solid rgba(255,255,255,.14);color:rgba(236,238,245,.86);font:500 11.5px/1.2 system-ui,sans-serif;letter-spacing:.02em;pointer-events:none;opacity:0;transition:opacity .35s ease";
    const kbd = "display:inline-block;padding:1px 4px;margin-right:1px;border:1px solid rgba(255,255,255,.28);border-radius:4px;font:600 10.5px/1.2 ui-monospace,monospace";
    h.innerHTML = `<span><span style="${kbd}">W</span><span style="${kbd}">A</span><span style="${kbd}">S</span><span style="${kbd}">D</span> to look around</span>`;
    const x = document.createElement("button");
    x.type = "button";
    x.textContent = "×";
    x.setAttribute("aria-label", "Dismiss the WASD hint");
    x.style.cssText = "pointer-events:auto;cursor:pointer;border:0;background:transparent;color:inherit;font:400 15px/1 system-ui,sans-serif;padding:0 4px;opacity:.7";
    x.addEventListener("click", (e) => {
      e.stopPropagation();
      dropHint(true);
    });
    h.appendChild(x);
    el.appendChild(h);
    hint = h;
    requestAnimationFrame(() => h.isConnected && (h.style.opacity = "1"));
    // Shown once: it fades by itself after a while and isn't shown again.
    hintTimer = window.setTimeout(() => dropHint(true), 9000);
  };
  on(el, "pointerenter", (e) => {
    if ((e as PointerEvent).pointerType === "touch") return;
    hovered = true;
    showHint();
  });
  on(el, "pointerleave", () => (hovered = false));
  on(window, "keydown", (e) => {
    const ev = e as KeyboardEvent;
    const k = keyOf(ev.code);
    if (!k) return;
    const active = document.activeElement;
    const focusedIn = !!active && active !== document.body && el.contains(active);
    if (!shouldHandle({ hovered, focusedIn, active: active as Typable | null, mods: ev.ctrlKey || ev.metaKey || ev.altKey, enabled: o.enabled?.() })) return;
    if (k === "home") return core.home();
    if ((k === "ccw" || k === "cw") && !o.rotate) return;
    ev.preventDefault();
    if (!ev.repeat) dropHint(true);
    core.press(k);
  });
  on(window, "keyup", (e) => {
    const k = keyOf((e as KeyboardEvent).code);
    if (k) core.release(k);
  });
  on(window, "blur", () => core.clear());
  return {
    get x() {
      return core.x;
    },
    get z() {
      return core.z;
    },
    get busy() {
      return core.busy;
    },
    step: (dt) => core.step(dt),
    home: () => core.home(),
    dispose: () => {
      for (const f of offs.splice(0)) f();
      window.clearTimeout(hintTimer);
      hint?.remove();
      hint = null;
    },
  };
}
