import type { RelayStatus } from "@ceo/core";
import type { ComposeInput, DraftAnswer, DraftInput, SortAnswer, SortInput } from "../../../api/_relay/models.ts";
import type { Reason, RequestResult, TextsView } from "../../../api/_relay/texts.ts";
import type { LearnInput } from "../../../api/_relay/voice.ts";
import { SITE } from "./config.ts";

/**
 * The hub's outbound calls to the site, every one with the paired hub token (docs/RELAY-PRIVACY.md, "Mac to the
 * site"). The hub opens no port for the site: it pushes, and it polls for the Desk's requests.
 *
 *   status    counts and states only (RelayStatus), checked by readRelayStatus before it goes
 *   texts     the who's-waiting list: names, Dialtone's gist, Blasto's drafts; never a message body
 *   sort      one placeholdered, trimmed snippet for Dialtone; the answer comes back, nothing is kept there
 *   draft     the same for Blasto
 *   learn     "Learn from my texts" (#758): the placeholdered, labelled sample of Nikita's own texts; style traits back
 *             and what the call cost, nothing kept there
 *   compose   a new text Skippy asked for (#536): the placeholdered ask and style examples, on the draft view
 *   requests  the Desk's waiting requests (each handed out once)
 *   results   what became of the ones it took
 *   skip      the private skip list's terms, held in memory only
 *   unpair    the wipe: the site forgets this pairing (the token stops working), the list and the requests
 *   photo-key, photo, photos   contact photos (#642): an opaque id and a small cleaned PNG each, never a name or a
 *             number; the email match travels as keyed hashes only (api/_relay/photos.ts)
 */

export interface Site {
  status(status: RelayStatus): Promise<boolean>;
  texts(view: TextsView): Promise<boolean>;
  sort(input: SortInput): Promise<{ answer: SortAnswer | null } | { paused: true }>;
  draft(input: DraftInput): Promise<{ answer: DraftAnswer | null } | { paused: true }>;
  compose(input: ComposeInput): Promise<{ answer: DraftAnswer | null } | { paused: true }>;
  /** The one style call (#758): the model's answer (checked on the Mac again) and its cost in dollars. */
  learn(input: LearnInput): Promise<{ answer: unknown; usd: number } | { paused: true }>;
  requests(): Promise<unknown[]>;
  /** What became of each request, with a reason code for a refusal or a failure (#767): never content. */
  results(results: { rid: string; result: RequestResult; reason?: Reason }[]): Promise<boolean>;
  skipTerms(): Promise<string[] | null>;
  /** The wipe: the site forgets this pairing, its list and its requests. */
  unpair(): Promise<boolean>;
  /** The key email addresses are hashed under for the photo match (#642); null when the site has none. Memory only. */
  photoKey(): Promise<Buffer | null>;
  /** One contact photo: its opaque id and a cleaned PNG (#642). */
  photo(id: string, png: Uint8Array): Promise<boolean>;
  /** The photo ids the Mac has now and the email-hash → id map; the ids the site holds after. */
  photos(keep: string[], emails: [string, string][]): Promise<string[]>;
}

const httpError = () => Object.assign(new Error("site"), { name: "HttpError" });

export function siteClient(token: string, fetcher: typeof fetch = fetch, base = SITE): Site {
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" };
  const post = async (view: string, body: unknown, ms = 45_000) => {
    const res = await fetcher(`${base}/api/relay-hub${view ? `?view=${view}` : ""}`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
    if (!res.ok) throw httpError();
    return (await res.json()) as Record<string, unknown>;
  };
  const get = async (view: string) => {
    const res = await fetcher(`${base}/api/relay-hub?view=${view}`, { headers, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw httpError();
    return (await res.json()) as Record<string, unknown>;
  };
  return {
    status: async (status) => (await post("", status)).ok === true,
    texts: async (view) => (await post("texts", view)).ok === true,
    sort: async (input) => {
      const got = await post("sort", input);
      return got.paused === true ? { paused: true } : { answer: (got.answer ?? null) as SortAnswer | null };
    },
    draft: async (input) => {
      const got = await post("draft", input);
      return got.paused === true ? { paused: true } : { answer: (got.answer ?? null) as DraftAnswer | null };
    },
    compose: async (input) => {
      const got = await post("draft", input);
      return got.paused === true ? { paused: true } : { answer: (got.answer ?? null) as DraftAnswer | null };
    },
    learn: async (input) => {
      const got = await post("learn", input, 120_000);
      return got.paused === true ? { paused: true } : { answer: got.answer ?? null, usd: typeof got.usd === "number" && Number.isFinite(got.usd) ? got.usd : 0 };
    },
    requests: async () => {
      const got = await get("requests");
      return Array.isArray(got.requests) ? got.requests : [];
    },
    results: async (results) => (await post("results", { results })).ok === true,
    unpair: async () => (await post("unpair", {})).ok === true,
    photoKey: async () => {
      try {
        const got = await get("photo-key");
        return typeof got.key === "string" && /^[A-Za-z0-9_-]{40,50}$/.test(got.key) ? Buffer.from(got.key, "base64url") : null;
      } catch {
        return null;
      }
    },
    photo: async (id, png) => (await post("photo", { id, png: Buffer.from(png).toString("base64") })).ok === true,
    photos: async (keep, emails) => {
      const got = await post("photos", { keep, emails });
      return Array.isArray(got.have) ? got.have.filter((x): x is string => typeof x === "string") : [];
    },
    skipTerms: async () => {
      try {
        const got = await get("skip");
        return Array.isArray(got.terms) ? got.terms.filter((t): t is string => typeof t === "string" && t.length <= 200).slice(0, 500) : null;
      } catch {
        return null;
      }
    },
  };
}
