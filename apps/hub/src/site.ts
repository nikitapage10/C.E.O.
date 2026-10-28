import type { RelayStatus } from "@ceo/core";
import type { ComposeInput, DraftAnswer, DraftInput, SortAnswer, SortInput } from "../../../api/_relay/models.ts";
import type { RequestResult, TextsView } from "../../../api/_relay/texts.ts";
import { SITE } from "./config.ts";

/**
 * The hub's outbound calls to the site, every one with the paired hub token (docs/RELAY-PRIVACY.md, "Mac to the
 * site"). The hub opens no port for the site: it pushes, and it polls for the Desk's requests.
 *
 *   status    counts and states only (RelayStatus), checked by readRelayStatus before it goes
 *   texts     the who's-waiting list: names, Dialtone's gist, Blasto's drafts; never a message body
 *   sort      one placeholdered, trimmed snippet for Dialtone; the answer comes back, nothing is kept there
 *   draft     the same for Blasto
 *   compose   a new text Skippy asked for (#536): the placeholdered ask and style examples, on the draft view
 *   requests  the Desk's waiting requests (each handed out once)
 *   results   what became of the ones it took
 *   skip      the private skip list's terms, held in memory only
 *   unpair    the wipe: the site forgets this pairing (the token stops working), the list and the requests
 */

export interface Site {
  status(status: RelayStatus): Promise<boolean>;
  texts(view: TextsView): Promise<boolean>;
  sort(input: SortInput): Promise<{ answer: SortAnswer | null } | { paused: true }>;
  draft(input: DraftInput): Promise<{ answer: DraftAnswer | null } | { paused: true }>;
  compose(input: ComposeInput): Promise<{ answer: DraftAnswer | null } | { paused: true }>;
  requests(): Promise<unknown[]>;
  results(results: { rid: string; result: RequestResult }[]): Promise<boolean>;
  skipTerms(): Promise<string[] | null>;
  /** The wipe: the site forgets this pairing, its list and its requests. */
  unpair(): Promise<boolean>;
}

const httpError = () => Object.assign(new Error("site"), { name: "HttpError" });

export function siteClient(token: string, fetcher: typeof fetch = fetch, base = SITE): Site {
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" };
  const post = async (view: string, body: unknown) => {
    const res = await fetcher(`${base}/api/relay-hub${view ? `?view=${view}` : ""}`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(45_000) });
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
    requests: async () => {
      const got = await get("requests");
      return Array.isArray(got.requests) ? got.requests : [];
    },
    results: async (results) => (await post("results", { results })).ok === true,
    unpair: async () => (await post("unpair", {})).ok === true,
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
