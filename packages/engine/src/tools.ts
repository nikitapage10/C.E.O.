/**
 * The rooms' tools (#646): one registry of the things Skippy can do in a room, shared by Desk Skippy's agent loop
 * (api/_skippy/agent) and a room's voice intent handler (`@ceo/engine/voice`, RoomUtterance.tool). Each room declares
 * its own in `rooms/<id>/tools.ts` and lists them in its manifest (`tools`); the server holds the one executor per
 * name and runs every call, from either side, through the same checks (`POST /api/skippy-act`).
 *
 * The rule that never bends: anything that sends, spends or deletes waits for Nikita's Yes tap on the Desk
 * (`needsConfirm`). A tool may also ask for the tap itself (`confirm: true`), as the home devices do. Pure data and
 * types, no zod: safe for the Desk's first load and for the Function App's bundle alike.
 */

/** What a tool does to the world. `read` changes nothing; `write` changes C.E.O.'s own state; the rest leave C.E.O. */
export const TOOL_EFFECTS = ["read", "write", "send", "spend", "delete"] as const;
export type ToolEffect = (typeof TOOL_EFFECTS)[number];

/** One input field, a small strict subset of JSON Schema that the model and the server both understand. */
export type ToolProp =
  | { type: "string"; description?: string; enum?: readonly string[]; maxLength?: number }
  | { type: "integer"; description?: string; minimum?: number; maximum?: number }
  | { type: "boolean"; description?: string }
  | { type: "array"; description?: string; items: { type: "string"; maxLength?: number }; maxItems?: number };

export interface ToolSchema {
  type: "object";
  properties: Readonly<Record<string, ToolProp>>;
  required: readonly string[];
  additionalProperties: false;
}

export interface RoomTool {
  /** Unique across every room: lowercase, digits and underscores. */
  name: string;
  /** The Desk room that owns it (its manifest's id). */
  room: string;
  /** Its chip's words, under 40 characters ("Read the Green's board"). */
  title: string;
  /** What the model is told it does, and when to use it. */
  description: string;
  input: ToolSchema;
  effect: ToolEffect;
  /** Ask for the tap even for a `write` (the home devices, a saved memory). */
  confirm?: boolean;
}

/** Spoken surfaces (the phone, a room's mic) can't show a Yes button, so they only get the tools that need none. */
export const spokenSafe = (t: Pick<RoomTool, "effect" | "confirm">): boolean => !needsConfirm(t);

export const TOOL_NAME = /^[a-z][a-z0-9_]{2,39}$/;

/** Whether a call waits for Nikita's Yes tap. */
export const needsConfirm = (t: Pick<RoomTool, "effect" | "confirm">): boolean => t.confirm === true || t.effect === "send" || t.effect === "spend" || t.effect === "delete";

/** What running a tool gives back, to the agent, the voice hook and the Desk alike. */
export type ToolOutcome =
  /** It ran: `text` for the model or the voice; `did` the chip's words when it changed something. */
  | { ok: true; text: string; did?: string }
  /** It waits for the tap: the pending call's id, the button's words and exactly what will happen. */
  | { ok: true; confirm: PendingConfirm }
  | { ok: false; text: string };

export interface PendingConfirm {
  id: string;
  /** The Yes button's label, under 40 characters. */
  label: string;
  /** Exactly what will happen, one plain line. */
  summary: string;
}

const isStr = (v: unknown): v is string => typeof v === "string";

/** Whether a declaration is well formed (the contract test and the server's registry both check). */
export function isRoomTool(v: unknown): v is RoomTool {
  if (!v || typeof v !== "object") return false;
  const t = v as Partial<RoomTool>;
  if (!isStr(t.name) || !TOOL_NAME.test(t.name) || !isStr(t.room) || !isStr(t.title) || t.title.length < 3 || t.title.length > 40) return false;
  if (!isStr(t.description) || t.description.length < 20 || t.description.length > 900) return false;
  if (!(TOOL_EFFECTS as readonly string[]).includes(t.effect as string)) return false;
  const s = t.input;
  if (!s || s.type !== "object" || s.additionalProperties !== false || !Array.isArray(s.required) || !s.properties) return false;
  return s.required.every((r) => Object.hasOwn(s.properties, r)) && Object.values(s.properties).every((p) => ["string", "integer", "boolean", "array"].includes(p.type));
}

/**
 * A call's input checked against its schema, strictly: no unknown fields, every required one, each of the right type
 * and within its limits. Strings are trimmed and must not be empty. The model's input is never trusted as given.
 */
export function checkInput(schema: ToolSchema, input: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; why: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, why: "input must be an object" };
  const raw = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(raw)) if (!Object.hasOwn(schema.properties, k)) return { ok: false, why: `unknown field ${k}` };
  for (const [k, p] of Object.entries(schema.properties)) {
    const v = raw[k];
    if (v === undefined || v === null) {
      if (schema.required.includes(k)) return { ok: false, why: `${k} is required` };
      continue;
    }
    if (p.type === "string") {
      if (!isStr(v) || !v.trim()) return { ok: false, why: `${k} must be text` };
      const s = v.trim();
      if (p.maxLength !== undefined && s.length > p.maxLength) return { ok: false, why: `${k} is too long` };
      if (p.enum && !p.enum.includes(s)) return { ok: false, why: `${k} must be one of ${p.enum.join(", ")}` };
      out[k] = s;
    } else if (p.type === "integer") {
      if (typeof v !== "number" || !Number.isInteger(v)) return { ok: false, why: `${k} must be a whole number` };
      if ((p.minimum !== undefined && v < p.minimum) || (p.maximum !== undefined && v > p.maximum)) return { ok: false, why: `${k} is out of range` };
      out[k] = v;
    } else if (p.type === "boolean") {
      if (typeof v !== "boolean") return { ok: false, why: `${k} must be true or false` };
      out[k] = v;
    } else {
      if (!Array.isArray(v) || v.some((x) => !isStr(x) || !x.trim())) return { ok: false, why: `${k} must be a list of text` };
      if (p.maxItems !== undefined && v.length > p.maxItems) return { ok: false, why: `${k} has too many items` };
      const max = p.items.maxLength;
      if (max !== undefined && v.some((x: string) => x.trim().length > max)) return { ok: false, why: `${k} has an item that is too long` };
      out[k] = v.map((x: string) => x.trim());
    }
  }
  return { ok: true, value: out };
}

/*
 * Every room's tools, for a page that shows them (#847, the Boiler Room's Controls). A room never imports another, so
 * the Desk plugs the rooms' lists in here, once, as it starts (`desk/roomHooks.ts`), as a lazy loader: nothing loads
 * until a page asks. Its order matches the server's registry (`ALL_TOOLS`, api/_skippy/agent/tools.ts), and a test
 * keeps the two the same.
 */
let toolbelt: (() => Promise<readonly RoomTool[]>) | null = null;

/** The Desk hands in how to load every room's tools. */
export function setToolbelt(load: () => Promise<readonly RoomTool[]>): void {
  toolbelt = load;
}

/** Every room's tools, or an empty list where nothing has been plugged in (a test, the server). */
export const loadToolbelt = (): Promise<readonly RoomTool[]> => (toolbelt ? toolbelt() : Promise.resolve([]));
