/**
 * The Annex's own record (#618): each pop-up's status (live, ended, archived or graduated) and the races Nikita
 * follows on Election night. One small JSON file in the private store (desk/annex/state.json), so archiving a pop-up
 * on one device archives it everywhere, and the server stops reading for it too. Without a store (a local run) it
 * lives in the instance's memory.
 *
 * The statuses are public (the Annex lists its pop-ups to anyone who can open the Desk); the follows are read and
 * written only in a Desk session.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { pickBlob, type BlobBackend } from "../_blob.js";

export const STATE_PATH = "desk/annex/state.json";
export const POPUP_IDS = ["elections"] as const;
export type PopupId = (typeof POPUP_IDS)[number];
export const POPUP_STATUSES = ["live", "ended", "archived", "graduated"] as const;
export type PopupStatus = (typeof POPUP_STATUSES)[number];
/** At most this many followed races. */
export const MAX_FOLLOWS = 200;

export interface AnnexState {
  popups: Record<PopupId, { status: PopupStatus; at: string | null }>;
  /** Followed race ids, per pop-up. */
  follows: Record<PopupId, number[]>;
}

export const defaultState = (): AnnexState => ({ popups: { elections: { status: "live", at: null } }, follows: { elections: [] } });

export const isPopup = (v: unknown): v is PopupId => (POPUP_IDS as readonly unknown[]).includes(v);
export const isStatus = (v: unknown): v is PopupStatus => (POPUP_STATUSES as readonly unknown[]).includes(v);

export const cleanFollows = (v: unknown): number[] =>
  Array.isArray(v) ? [...new Set(v.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n > 0 && n < 1e9))].slice(0, MAX_FOLLOWS) : [];

/** A stored record, read defensively: anything unknown falls back to the default. */
export function readState(raw: unknown): AnnexState {
  const s = defaultState();
  const r = raw as Partial<AnnexState> | null;
  if (!r || typeof r !== "object") return s;
  for (const id of POPUP_IDS) {
    const p = r.popups?.[id];
    if (p && isStatus(p.status)) s.popups[id] = { status: p.status, at: typeof p.at === "string" ? p.at.slice(0, 40) : null };
    s.follows[id] = cleanFollows(r.follows?.[id]);
  }
  return s;
}

export interface AnnexStore {
  read(): Promise<AnnexState>;
  write(state: AnnexState): Promise<void>;
}

export class BlobAnnexStore implements AnnexStore {
  constructor(private readonly blob: BlobBackend) {}
  async read(): Promise<AnnexState> {
    const found = await this.blob.get(STATE_PATH);
    return readState(found ? await new Response(found.stream).json().catch(() => null) : null);
  }
  async write(state: AnnexState): Promise<void> {
    await this.blob.put(STATE_PATH, JSON.stringify(state), { contentType: "application/json", addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0 });
  }
}

export class MemoryAnnexStore implements AnnexStore {
  state = defaultState();
  async read(): Promise<AnnexState> {
    return readState(JSON.parse(JSON.stringify(this.state)));
  }
  async write(state: AnnexState): Promise<void> {
    this.state = readState(JSON.parse(JSON.stringify(state)));
  }
}

const memory = new MemoryAnnexStore();
export function pickAnnexStore(env: Record<string, string | undefined> = process.env): AnnexStore {
  const blob = pickBlob(env);
  return blob ? new BlobAnnexStore(blob) : memory;
}
