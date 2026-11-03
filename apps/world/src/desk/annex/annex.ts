import { create } from "zustand";

/**
 * The Annex's record, browser side (#618): each pop-up's status and the races followed on Election night. Read from
 * GET /api/annex; written with POST in a Desk session, so archiving on one device archives everywhere. Signed out, a
 * change is kept on this device only (localStorage), and the server's record stands for everyone else.
 */

export type PopupId = "elections";
export type PopupStatus = "live" | "ended" | "archived" | "graduated";

export interface Popup {
  id: PopupId;
  name: string;
  line: string;
  /** Until when it is meant to run (a date), shown beside its status. */
  until: string;
}

/** The pop-ups, newest first. Each is a small module of its own: an api route, a page section and a feed. */
export const POPUPS: Popup[] = [{ id: "elections", name: "Election night", line: "Live 2026 midterm results: the Senate, governors, the House and ballot measures", until: "Nov 4, 2026" }];

const LOCAL = "ceo.annex.v1";

interface Local {
  status?: Partial<Record<PopupId, PopupStatus>>;
  follows?: Partial<Record<PopupId, number[]>>;
}

function readLocal(): Local {
  try {
    const raw = window.localStorage.getItem(LOCAL);
    const v = raw ? (JSON.parse(raw) as Local) : {};
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function writeLocal(patch: (l: Local) => Local): void {
  try {
    window.localStorage.setItem(LOCAL, JSON.stringify(patch(readLocal())));
  } catch {
    // Private mode or storage off: the change lasts for this visit.
  }
}

const STATUSES = new Set<PopupStatus>(["live", "ended", "archived", "graduated"]);
const ids = (v: unknown): number[] => (Array.isArray(v) ? v.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n > 0).slice(0, 200) : []);

interface AnnexStore {
  /** "idle" before the first answer; "ready" once the server answered; "local" when it couldn't (this device only). */
  load: "idle" | "ready" | "local";
  signedIn: boolean;
  status: Record<PopupId, PopupStatus>;
  follows: Record<PopupId, number[]>;
  refresh: () => Promise<void>;
  setStatus: (id: PopupId, status: PopupStatus) => Promise<void>;
  toggleFollow: (id: PopupId, race: number) => void;
}

async function post(body: unknown): Promise<{ popups?: Record<string, { status?: unknown }>; follows?: Record<string, unknown> } | null> {
  try {
    const res = await fetch("/api/annex", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) });
    return res.ok && (res.headers.get("content-type") ?? "").includes("json") ? await res.json() : null;
  } catch {
    return null;
  }
}

let followTimer: ReturnType<typeof setTimeout> | undefined;

export const useAnnex = create<AnnexStore>((set, get) => ({
  load: "idle",
  signedIn: false,
  status: { elections: "live" },
  follows: { elections: [] },
  refresh: async () => {
    const local = readLocal();
    let server: { popups?: Record<string, { status?: unknown }>; follows?: Record<string, unknown>; signedIn?: boolean } | null = null;
    try {
      const res = await fetch("/api/annex", { headers: { Accept: "application/json" }, credentials: "same-origin" });
      if (res.ok && (res.headers.get("content-type") ?? "").includes("json")) server = await res.json();
    } catch {
      server = null;
    }
    const signedIn = server?.signedIn === true;
    const status = { ...get().status };
    for (const p of POPUPS) {
      const s = server?.popups?.[p.id]?.status;
      // Signed in, the shared record is the truth; signed out, this device's own choice wins over it.
      const mine = signedIn ? undefined : local.status?.[p.id];
      status[p.id] = mine && STATUSES.has(mine) ? mine : STATUSES.has(s as PopupStatus) ? (s as PopupStatus) : status[p.id];
    }
    const follows = { ...get().follows };
    for (const p of POPUPS) follows[p.id] = signedIn ? ids(server?.follows?.[p.id]) : ids(local.follows?.[p.id]);
    set({ load: server ? "ready" : "local", signedIn, status, follows });
  },
  setStatus: async (id, status) => {
    set({ status: { ...get().status, [id]: status } });
    if (get().signedIn) {
      const back = await post({ popup: id, status });
      if (back) return;
    }
    writeLocal((l) => ({ ...l, status: { ...l.status, [id]: status } }));
  },
  toggleFollow: (id, race) => {
    const now = get().follows[id];
    const next = now.includes(race) ? now.filter((n) => n !== race) : [race, ...now].slice(0, 200);
    set({ follows: { ...get().follows, [id]: next } });
    writeLocal((l) => ({ ...l, follows: { ...l.follows, [id]: next } }));
    if (get().signedIn) {
      clearTimeout(followTimer);
      followTimer = setTimeout(() => void post({ popup: id, follows: get().follows[id] }), 600);
    }
  },
}));
