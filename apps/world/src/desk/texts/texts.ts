import { create } from "zustand";
import { readRelayStatus, type RelayStatus } from "@ceo/core";
import { readTextCard, readTextItem, REQUEST_STATES, type RequestState, type TextCard, type TextItem } from "../../../../../api/_relay/texts.ts";
import { useSystems, type LinkState } from "../../systems.ts";
import { assertionJson, canPasskey, requestOptions, useDeskAuth } from "../signin.ts";

/**
 * Relay's texts line (#535, docs/RELAY-PRIVACY.md), browser side. Two reads of /api/relay on the Azure copy:
 *
 *   ?view=status   the public counts (RelayStatus): the Lattice's Relay room, Today and Systems, signed in or not
 *   (no query)     the signed-in Texts panel: the pairing, the who's-waiting list (names, Dialtone's gist, Blasto's
 *                  drafts), the requests and whether this device's send unlock is on. Passkey session only.
 *
 * Every 20 seconds while the tab shows. Every action is a request the Mac hub picks up within about 15 seconds; a
 * send needs this device's unlock (one fresh passkey check, good 72 hours), and is single-use with 10 minutes to live.
 */

export type { TextCard, TextItem };

const PATH = "/api/relay";
const POLL_MS = 20_000;
/** A status this old means the Mac stopped reporting (it reports every few minutes at least). */
export const STALE_MS = 15 * 60_000;

export type TextsLoad = "idle" | "off" | "live" | "failed";

export interface TextRequestView {
  rid: string;
  kind: "send" | "later" | "done" | "restyle" | "compose";
  thread: string;
  text: string;
  created: number;
  until: number;
  state: RequestState;
}

export interface TextsPrivate {
  ready: boolean;
  paired: boolean;
  pairedAt: number | null;
  lastSeen: number | null;
  unlockedUntil: number | null;
  items: TextItem[];
  /** The texts Skippy asked Blasto to write (#536). */
  cards: TextCard[];
  textsAt: number | null;
  requests: TextRequestView[];
  spend: { usd: number; budget: number };
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The private view, checked; null when it isn't one. */
export function readPrivateView(b: unknown): (TextsPrivate & { status: RelayStatus }) | null {
  const o = b as Record<string, unknown> | null;
  if (!o || o.ok !== true) return null;
  const st = readRelayStatus(o.status);
  if (!st.ok || !Array.isArray(o.texts) || !Array.isArray(o.requests)) return null;
  const spend = o.spend as Record<string, unknown> | null;
  const requests: TextRequestView[] = (o.requests as Record<string, unknown>[]).flatMap((r) =>
    r && typeof r.rid === "string" && /^[0-9a-f]{24}$/.test(r.rid) && typeof r.thread === "string" && ["send", "later", "done", "restyle", "compose"].includes(r.kind as string) && (REQUEST_STATES as readonly string[]).includes(r.state as string) && isNum(r.created) && isNum(r.until)
      ? [{ rid: r.rid, kind: r.kind as TextRequestView["kind"], thread: r.thread, text: typeof r.text === "string" ? r.text.slice(0, 2_000) : "", created: r.created, until: r.until, state: r.state as RequestState }]
      : [],
  );
  return {
    status: st.status,
    ready: o.ready === true,
    paired: o.paired === true,
    pairedAt: isNum(o.pairedAt) ? o.pairedAt : null,
    lastSeen: isNum(o.lastSeen) ? o.lastSeen : null,
    unlockedUntil: isNum(o.unlockedUntil) ? o.unlockedUntil : null,
    items: (o.texts as unknown[]).map(readTextItem).filter((i): i is TextItem => i !== null),
    cards: (Array.isArray(o.cards) ? (o.cards as unknown[]) : []).map(readTextCard).filter((c): c is TextCard => c !== null),
    textsAt: isNum(o.textsAt) ? o.textsAt : null,
    requests,
    spend: { usd: isNum(spend?.usd) ? spend.usd : 0, budget: isNum(spend?.budget) ? spend.budget : 10 },
  };
}

/** The hub's light, from the public counts. */
export function hubLink(status: RelayStatus | null, now: number): LinkState {
  if (!status || status.hub === "off" || status.hub === "wiped") return "off";
  if (status.hub === "error" || now - status.at > STALE_MS) return "down";
  return status.hub === "paused" || status.hub === "starting" ? "slow" : "ok";
}

const linkOf = (l: RelayStatus["messages"]): LinkState => (l === "up" ? "ok" : l === "down" ? "down" : "off");

/** The texts line in a few words, for the Lattice, Today and Systems. Never a name. */
export function textsLine(load: TextsLoad, status: RelayStatus | null, now: number): string {
  if (load === "off") return "Texts: on the Azure copy";
  if (!status) return load === "failed" ? "Texts: not answering" : "Texts: reading…";
  if (status.hub === "off") return "Texts: waiting on the MacBook";
  if (status.hub === "wiped") return "Texts: wiped from the MacBook";
  if (now - status.at > STALE_MS) return "Texts: the MacBook stopped reporting";
  if (status.hub === "paused") return "Texts: paused on the MacBook";
  if (status.hub === "error") return "Texts: the hub has a problem";
  return status.owed === 1 ? "1 reply owed" : `${status.owed} replies owed`;
}

function setLinks(status: RelayStatus | null, now: number) {
  const { setLink } = useSystems.getState();
  const hub = hubLink(status, now);
  const lastSeen = status && status.hub !== "off" ? status.at : null;
  const on = hub === "ok" || hub === "slow";
  setLink("hub", { state: hub, load: status ? Math.min(1, 0.2 + status.owed / 20) : 0, lastSeen, note: hub === "ok" ? "OUTBOUND ONLY" : undefined });
  setLink("mac", { state: hub === "off" ? "off" : hub === "down" ? "down" : "ok", load: on ? 0.3 : 0, lastSeen });
  setLink("bluebubbles", { state: on && status ? linkOf(status.messages) : "off", load: on ? 0.3 : 0, lastSeen });
  setLink("messages", { state: on && status ? linkOf(status.messages) : "off", load: on ? 0.3 : 0, lastSeen });
  const models = on && status ? linkOf(status.models) : "off";
  setLink("openai", { state: models, load: on && status ? Math.min(1, 0.2 + status.draftsReady / 10) : 0, lastSeen });
  setLink("dialtone", { state: on ? (models === "down" ? "slow" : "ok") : "off", load: on && status ? Math.min(1, 0.2 + status.owed / 20) : 0, lastSeen });
  setLink("postmaster", { state: on ? (models === "down" ? "slow" : "ok") : "off", load: on && status ? Math.min(1, 0.2 + status.draftsReady / 10) : 0, lastSeen });
}

export type UnlockResult = "ok" | "cancelled" | "failed" | "unsupported" | "locked-out";

interface TextsStore {
  load: TextsLoad;
  status: RelayStatus | null;
  view: TextsPrivate | null;
  /** The pair code on screen, and when it ends. */
  code: { code: string; until: number } | null;
  busy: string | null;
  error: string | null;
  refresh: () => Promise<void>;
  pairCode: () => Promise<void>;
  unpair: () => Promise<void>;
  unlock: () => Promise<UnlockResult>;
  lock: () => Promise<void>;
  /** One request; false (with `error` set) when the site refused it. */
  ask: (body: Record<string, unknown>) => Promise<boolean>;
  /** A new text for Blasto to write (#536): the card's id, or the site's error code. */
  compose: (body: { who: string; gist: string; card?: string; pick?: string }) => Promise<{ card: string } | { error: string }>;
}

const isJson = (res: Response) => (res.headers.get("content-type") ?? "").includes("json");
const post = (body: object) => fetch(PATH, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, credentials: "same-origin", cache: "no-store", body: JSON.stringify(body) });

const ERRORS: Record<string, string> = {
  locked: "Sending is locked on this device. Unlock it with your passkey first.",
  changed: "Blasto made a newer draft since this page loaded. Check it, then send again.",
  busy: "That one is already on its way to the Mac.",
  "no-thread": "That conversation isn't waiting any more.",
  "bad-text": "The reply is empty or too long.",
  "no-resend": "That request can't be sent again.",
  "not-paired": "No Mac is paired yet.",
  "not-set-up": "Texts aren't set up on this copy yet.",
  paired: "A Mac is already paired. Unpair it first to pair another.",
  "off-limits": "Relay keeps that one from Blasto (money, legal, a code or the skip list). Text it yourself.",
  private: "That has a number, address or key in it. Say it another way.",
};

/** What the site said about a request, in the Desk's words. */
export const errorWords = (code: string) => ERRORS[code] ?? "That didn't go through. Try again.";

export const useTexts = create<TextsStore>((set, get) => ({
  load: "idle",
  status: null,
  view: null,
  code: null,
  busy: null,
  error: null,
  refresh: async () => {
    const auth = useDeskAuth.getState().auth.status;
    try {
      if (auth === "in") {
        const res = await fetch(PATH, { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" });
        if (res.status === 401) useDeskAuth.getState().lost();
        else if (res.status === 404 || !isJson(res)) {
          set({ load: "off", status: null, view: null });
          setLinks(null, Date.now());
          return;
        } else if (res.ok) {
          const got = readPrivateView(await res.json());
          if (got) {
            const { status, ...view } = got;
            set({ load: "live", status, view });
            setLinks(status, Date.now());
            return;
          }
        }
      }
      const res = await fetch(`${PATH}?view=status`, { headers: { Accept: "application/json" }, cache: "no-store" });
      if (res.status === 404 || !isJson(res)) {
        set({ load: "off", status: null, view: null });
        setLinks(null, Date.now());
        return;
      }
      const read = res.ok ? readRelayStatus(((await res.json()) as { status?: unknown }).status) : null;
      const status = read?.ok ? read.status : null;
      set({ load: status ? "live" : "failed", status: status ?? get().status, view: null });
      setLinks(status ?? get().status, Date.now());
    } catch {
      set({ load: "failed" });
    }
  },
  pairCode: async () => {
    set({ busy: "pair", error: null });
    try {
      const res = await post({ action: "pair-code" });
      const got = isJson(res) ? ((await res.json()) as { code?: unknown; until?: unknown; error?: unknown }) : {};
      if (typeof got.code === "string" && isNum(got.until)) set({ code: { code: got.code, until: got.until } });
      else set({ error: res.status === 503 ? "Texts aren't set up on this copy yet." : (typeof got.error === "string" && ERRORS[got.error]) || "Couldn't make a pair code." });
    } finally {
      set({ busy: null });
    }
  },
  unpair: async () => {
    set({ busy: "unpair", error: null, code: null });
    try {
      await post({ action: "unpair" });
    } finally {
      set({ busy: null });
      await get().refresh();
    }
  },
  unlock: async () => {
    if (!canPasskey()) return "unsupported";
    set({ busy: "unlock", error: null });
    try {
      const opts = await post({ action: "unlock-options" });
      if (opts.status === 429) return "locked-out";
      if (!opts.ok) return "failed";
      let cred: PublicKeyCredential | null;
      try {
        cred = (await navigator.credentials.get({ publicKey: requestOptions((await opts.json()) as Parameters<typeof requestOptions>[0]) })) as PublicKeyCredential | null;
      } catch {
        return "cancelled";
      }
      if (!cred) return "cancelled";
      const res = await post({ action: "unlock", response: assertionJson(cred) });
      await get().refresh();
      return res.ok ? "ok" : res.status === 429 ? "locked-out" : "failed";
    } catch {
      return "failed";
    } finally {
      set({ busy: null });
    }
  },
  lock: async () => {
    await post({ action: "lock" }).catch(() => undefined);
    await get().refresh();
  },
  ask: async (body) => {
    set({ busy: `${String(body.action)}:${String(body.thread ?? body.rid ?? "")}`, error: null });
    try {
      const res = await post(body);
      if (res.status === 401) {
        const err = String(((await res.json().catch(() => ({}))) as { error?: unknown }).error ?? "");
        if (err === "signed-out") useDeskAuth.getState().lost();
        set({ error: ERRORS[err] ?? "Signed out." });
        return false;
      }
      if (!res.ok) {
        const err = String(((await res.json().catch(() => ({}))) as { error?: unknown }).error ?? "");
        set({ error: ERRORS[err] ?? "That didn't go through. Try again." });
        return false;
      }
      return true;
    } catch {
      set({ error: "That didn't go through. Try again." });
      return false;
    } finally {
      set({ busy: null });
      await get().refresh();
    }
  },
  compose: async (body) => {
    try {
      const res = await post({ action: "compose", ...body });
      const got = isJson(res) ? ((await res.json().catch(() => ({}))) as { card?: unknown; error?: unknown }) : {};
      if (res.status === 401 && got.error === "signed-out") useDeskAuth.getState().lost();
      if (res.ok && typeof got.card === "string" && /^[0-9a-f]{16}$/.test(got.card)) return { card: got.card };
      return { error: typeof got.error === "string" ? got.error : res.status === 503 ? "not-set-up" : "failed" };
    } catch {
      return { error: "failed" };
    } finally {
      void get().refresh();
    }
  },
}));

let started = false;

/** Start reading (once per page): every 20 seconds while the tab shows, and on sign-in or out. */
export function startTexts(): void {
  if (started || typeof window === "undefined") return;
  const q = new URLSearchParams(window.location.search);
  if (q.has("offline") || q.has("demo")) return;
  started = true;
  const refresh = () => void useTexts.getState().refresh();
  refresh();
  window.setInterval(() => {
    if (document.visibilityState === "visible") refresh();
  }, POLL_MS);
  let was = useDeskAuth.getState().auth.status;
  useDeskAuth.subscribe((st) => {
    if (st.auth.status !== was) {
      was = st.auth.status;
      if (was !== "checking") refresh();
    }
  });
}
