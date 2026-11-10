/**
 * The Kitchen's meal photo library (#687, planner part 3): the shapes the Desk and the server share, the readers that
 * take every body and file as untrusted data, and the prompt. No I/O and nothing Node-only, so the Desk can import the
 * types and `photoUrl`. The server side (storage, the generator, the routes) is api/_haven/photos.ts; the contract is in
 * docs/HOME-DEVICES.md, "The meal photo library".
 *
 * A photo belongs to a meal (`meal`, the planner's meal id) and, for a customized night, to that meal as built: its
 * components after the swaps and its style. Those three make the photo's `key`, and the key makes its id, so the same
 * meal with the same components always lands on the same photo: re-confirming a week never makes a picture twice.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

/** A meal id, a component id or a photo id: the planner's own shape (api/_haven/mealShape.ts, `ID`). */
export const PHOTO_ID = /^[a-z0-9][a-z0-9-]{1,47}$/;

export const PHOTO_STYLES = ["plate", "prep", "workout", "step"] as const;
/** `plate`: plated on off-white ceramic in daylight. `prep`: portioned into meal-prep containers. `workout`: the
 * Gym's exercise art (#718), one picture per exercise of the plan, made through the same library and cap. `step`: one
 * cook-mode step in progress (#1010), the step's words in `description` and what it uses in `components`; made small
 * and at low quality (photoGen.ts, `STEP_PLAN`), asked for the first time a recipe is opened in cook mode. */
export type PhotoStyle = (typeof PHOTO_STYLES)[number];

export const PHOTO_SOURCES = ["openai", "upload", "seed"] as const;
export type PhotoSource = (typeof PHOTO_SOURCES)[number];

/**
 * Where a photo is:
 *   queued  waiting its turn (made one at a time, oldest first)
 *   making  being made now
 *   ready   both sizes are in the library
 *   failed  OpenAI said no or sent nothing, twice (medium, then low); confirming again tries once more
 *   budget  the month's image cap was reached first; confirming again next month tries once more
 */
export const PHOTO_STATES = ["queued", "making", "ready", "failed", "budget"] as const;
export type PhotoState = (typeof PHOTO_STATES)[number];

export const PHOTO_SIZES = ["720", "full"] as const;
export type PhotoSize = (typeof PHOTO_SIZES)[number];

/** One meal as it will be cooked, to photograph. */
export interface MealToShoot {
  /** The planner's meal id. */
  meal: string;
  name: string;
  /** A sentence on the dish (the catalog's blurb). */
  description: string;
  /** What's in it after Customize: the components' names ("Chicken thighs", "Quinoa", "Charred broccolini"). */
  components: string[];
  style: PhotoStyle;
}

/** A photo in the library's catalog (`catalog.json` beside the photos). */
export interface PhotoEntry {
  id: string;
  meal: string;
  name: string;
  components: string[];
  style: PhotoStyle;
  /** The hash of meal, components and style (16 hex): the photo's identity. */
  key: string;
  /** What OpenAI was asked for; empty for an upload. */
  prompt: string;
  source: PhotoSource;
  status: PhotoState;
  /** ISO times. */
  created: string;
  updated: string;
  /** "medium" or "low" for a made photo, once ready. */
  quality?: "medium" | "low";
  /** The full image's name in the library (`full/<id>.png` or `.jpg`), once ready. */
  full?: string;
  width?: number;
  height?: number;
  /** A short reason, never a prompt or a key: "openai 400", "no image", "store". */
  error?: string;
  /** How many times the generator tried it. */
  tries: number;
}

/** The month's image spend against the cap, as the Desk shows it. */
export interface PhotoBudget {
  month: string;
  images: number;
  usd: number;
  capUsd: number;
  /** Whole images left at the conservative per-image estimate. */
  left: number;
  reached: boolean;
}

/** What the confirm hook answers for each meal it was given. */
export interface PhotoTicket {
  meal: string;
  key: string;
  /** The photo id the night can show (`slot.photo`) once `status` is "ready". */
  id: string;
  status: PhotoState;
}

/** The most meals one confirm takes: a week, with room for lunches made from a dish of their own. */
export const CONFIRM_MAX = 14;
const NAME_MAX = 80;
const DESCRIPTION_MAX = 300;
const COMPONENT_MAX = 60;
const COMPONENTS_MAX = 8;

/** Plain, single-line text: no control characters, no markup brackets, trimmed and capped. */
export function plain(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v
    // eslint-disable-next-line no-control-regex -- control characters are exactly what this strips
    .replace(/[\u0000-\u001f\u007f<>{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

export const isStyle = (v: unknown): v is PhotoStyle => (PHOTO_STYLES as readonly unknown[]).includes(v);

/** One meal from a request body, or null when it isn't one. */
export function readMealToShoot(v: unknown): MealToShoot | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const x = v as Record<string, unknown>;
  const meal = typeof x.meal === "string" ? x.meal : typeof x.id === "string" ? x.id : "";
  if (!PHOTO_ID.test(meal)) return null;
  const name = plain(x.name, NAME_MAX);
  if (!name) return null;
  const components = (Array.isArray(x.components) ? x.components : [])
    .map((c) => plain(c, COMPONENT_MAX))
    .filter(Boolean)
    .slice(0, COMPONENTS_MAX);
  return { meal, name, description: plain(x.description, DESCRIPTION_MAX), components, style: isStyle(x.style) ? x.style : "plate" };
}

/** The meals of a confirm body: every one checked, duplicates (by meal and components) kept once. */
export function readMealsToShoot(v: unknown): MealToShoot[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > CONFIRM_MAX) return null;
  const out: MealToShoot[] = [];
  for (const one of v) {
    const m = readMealToShoot(one);
    if (!m) return null;
    out.push(m);
  }
  return out;
}

/**
 * What the key is made of: the meal, its components as a set (case and order don't matter) and the style. A step's
 * picture (#1010) adds the step's words, so each step of a meal is its own picture and a step that names a swapped
 * part gets a new one; the other styles' keys are unchanged.
 */
export function keySource(m: Pick<MealToShoot, "meal" | "components" | "style"> & { description?: string }): string {
  const parts = [...new Set(m.components.map((c) => c.toLowerCase()))].sort();
  return JSON.stringify(m.style === "step" ? [m.meal, parts, m.style, (m.description ?? "").toLowerCase()] : [m.meal, parts, m.style]);
}

/** A photo's id from its meal and key: `<meal>-<8 hex>`, inside the planner's id shape (48 characters at most). */
export function photoIdOf(meal: string, key: string): string {
  return `${meal.slice(0, 38).replace(/-+$/, "")}-${key.slice(0, 8)}`;
}

/** The Desk's address for a photo (passkey session only; the 720 px JPEG unless `full`). */
export function photoUrl(id: string, size: PhotoSize = "720"): string {
  return `/api/haven-photos?id=${encodeURIComponent(id)}${size === "full" ? "&size=full" : ""}`;
}

/* ── The prompt: the demo's two styles (scratchpad gen2.sh, approved by Nikita) ── */

export const STYLE_PLATE =
  "Photorealistic professional food blog photograph, top-down or 45-degree angle, served in a matte off-white ceramic bowl or plate on a white weathered painted-wood table or light grey stone surface, a linen napkin with a thin grey check at the edge, bright soft natural window daylight, crisp detail, garnish of fresh chopped parsley or herbs, part of a second dish visible at the frame edge, shallow depth of field. Creative, restaurant-quality plating.";
export const STYLE_PREP =
  "Photorealistic professional meal-prep food blog photograph, 45-degree or top-down angle, portioned into kraft paper bowls or glass meal-prep containers with lids beside them, several matching containers partly visible at the frame edges, on a light grey stone countertop, bright soft natural daylight, crisp detail, small bowls of garnish nearby.";
const PROMPT_TAIL = "Only raw vegetables if any vegetables appear. No text, no labels, no logos, no people, no hands.";

/** The Gym's exercise art (#718): the house's night gym, the exercise shown with good form, nobody recognisable. */
export const STYLE_WORKOUT =
  "Cinematic editorial fitness illustration, painterly digital art. One athletic adult performing the exercise named below with correct form, full body in frame, three-quarter view, in a dark modern home gym at night: black rubber floor tiles, a black steel power rack and dumbbells softly out of focus behind, warm amber key light from one side and a cool blue rim light, a little haze, high contrast, calm and focused mood, vertical composition.";
const WORKOUT_TAIL = "No text, no labels, no logos, no brand names, no mirrors facing the viewer; the face turned away or in shadow, nobody recognisable.";

/** A cook-mode step (#1010): the same food-blog daylight as the plates, the step caught in the middle of being done. */
export const STYLE_STEP =
  "Photorealistic professional food blog process photograph of one cooking step in progress, 45-degree or top-down angle, on a light grey stone countertop or a pale wood cutting board, matte off-white ceramic bowls and plates, a simple stainless pan or pot where the step needs one, a linen napkin with a thin grey check at the edge, bright soft natural window daylight, crisp detail, shallow depth of field, clean and calm.";
const STEP_TAIL = "Show only what this step does, nothing from later steps. No text, no labels, no logos, no people, no hands.";

/** The image prompt for one meal as built. */
export function promptFor(m: MealToShoot): string {
  if (m.style === "step") {
    const uses = m.components.length ? ` Using: ${m.components.join(", ")}.` : "";
    return `${STYLE_STEP} Dish: ${m.name}. Step: ${m.description.replace(/\.$/, "")}.${uses} ${STEP_TAIL}`;
  }
  if (m.style === "workout") return `${STYLE_WORKOUT} Exercise: ${[m.name, m.description].filter(Boolean).join(": ").replace(/\.$/, "")}. ${WORKOUT_TAIL}`;
  const style = m.style === "prep" ? STYLE_PREP : STYLE_PLATE;
  const dish = [m.name, m.description].filter(Boolean).join(": ").replace(/\.$/, "");
  const made = m.components.length ? ` Made with ${m.components.join(", ")}.` : "";
  return `${style} Dish: ${dish}.${made} ${PROMPT_TAIL}`;
}

/* ── The catalog file ── */

export interface PhotoCatalog {
  v: 1;
  photos: PhotoEntry[];
  /** The generator's lease: one run at a time (`by`, a random run id), until this ISO time. */
  worker: { until: string; by: string } | null;
}

export const EMPTY_CATALOG: PhotoCatalog = { v: 1, photos: [], worker: null };
/** The most photos the catalog keeps (oldest failed ones go first beyond it). */
export const CATALOG_MAX = 2000;

const iso = (v: unknown, fallback: string) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : fallback);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined);

/** The catalog from its file, every entry checked; a file that isn't one reads as empty. */
export function readCatalog(v: unknown): PhotoCatalog {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ...EMPTY_CATALOG, photos: [] };
  const x = v as Record<string, unknown>;
  const photos: PhotoEntry[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(x.photos) ? x.photos.slice(0, CATALOG_MAX) : []) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Record<string, unknown>;
    if (typeof p.id !== "string" || !PHOTO_ID.test(p.id) || seen.has(p.id)) continue;
    if (typeof p.meal !== "string" || !PHOTO_ID.test(p.meal)) continue;
    if (typeof p.key !== "string" || !/^[0-9a-f]{16}$/.test(p.key)) continue;
    seen.add(p.id);
    const created = iso(p.created, new Date(0).toISOString());
    const full = typeof p.full === "string" && /^full\/[a-z0-9-]+\.(png|jpg)$/.test(p.full) ? p.full : undefined;
    photos.push({
      id: p.id,
      meal: p.meal,
      name: plain(p.name, NAME_MAX),
      components: (Array.isArray(p.components) ? p.components : []).map((c) => plain(c, COMPONENT_MAX)).filter(Boolean).slice(0, COMPONENTS_MAX),
      style: isStyle(p.style) ? p.style : "plate",
      key: p.key,
      prompt: typeof p.prompt === "string" ? p.prompt.slice(0, 2000) : "",
      source: (PHOTO_SOURCES as readonly unknown[]).includes(p.source) ? (p.source as PhotoSource) : "upload",
      status: (PHOTO_STATES as readonly unknown[]).includes(p.status) ? (p.status as PhotoState) : "failed",
      created,
      updated: iso(p.updated, created),
      ...(p.quality === "medium" || p.quality === "low" ? { quality: p.quality } : {}),
      ...(full ? { full } : {}),
      ...(num(p.width) !== undefined ? { width: num(p.width) } : {}),
      ...(num(p.height) !== undefined ? { height: num(p.height) } : {}),
      ...(typeof p.error === "string" && p.error ? { error: plain(p.error, 60) } : {}),
      tries: num(p.tries) ?? 0,
    });
  }
  const w = x.worker && typeof x.worker === "object" ? (x.worker as Record<string, unknown>) : null;
  const leased = w && typeof w.until === "string" && !Number.isNaN(Date.parse(w.until)) && typeof w.by === "string";
  return { v: 1, photos, worker: leased ? { until: w.until as string, by: String(w.by).slice(0, 40) } : null };
}
