/**
 * Gmail, read-only (#263, docs/GMAIL.md): Google's OAuth 2.0 web flow for one scope, `gmail.readonly`, and the three
 * Gmail API reads the agent makes. Nothing here can send, label, archive or delete: the scope doesn't allow it, and
 * the only calls are GETs to the profile, the history and one message.
 *
 *   GET users/me/profile                 the mailbox's current history id (the first check starts there)
 *   GET users/me/history                 what changed since a history id: the minute check, free of Claude
 *   GET users/me/messages/{id}           one new inbox mail, read only to sort it
 *
 * `fetcher` is passed in everywhere, so the tests never touch the network.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
/** The one scope asked for. Read-only: Gmail itself refuses a send, a label change or a delete with it. */
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 3_000_000;

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Google refused the refresh token (revoked, expired, or the app is still in Testing and a week passed). */
export class TokenRefusedError extends Error {
  constructor() {
    super("gmail token refused");
    this.name = "TokenRefusedError";
  }
}

/** Gmail's history id is too old to list from (a 404): start again from the mailbox's current one. */
export class HistoryGoneError extends Error {
  constructor() {
    super("gmail history gone");
    this.name = "HistoryGoneError";
  }
}

/** Where Connect Gmail sends the browser: Google's consent page for gmail.readonly, offline, asking every time. */
export function authUrl(client: Pick<OAuthClient, "clientId" | "redirectUri">, state: string): string {
  const q = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    // Always show consent, so Google always hands back a refresh token (it only does on consent).
    prompt: "consent",
    include_granted_scopes: "false",
    state,
  });
  return `${AUTH_URL}?${q.toString()}`;
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error("gmail answer too big");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function postForm(fetcher: Fetcher, url: string, form: Record<string, string>): Promise<{ status: number; body: unknown }> {
  const res = await fetcher(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "error",
  });
  return { status: res.status, body: await readBody(res) };
}

/**
 * Trades the callback's one-time code for tokens. Returns the refresh token only when Google granted gmail.readonly
 * and nothing that could write; anything else is refused (and the access it came with simply expires).
 */
/** Full Gmail access (read, send, delete): a grant that carries it is refused. */
const FULL_MAIL_SCOPE = "https://mail.google.com/";

export async function exchangeCode(fetcher: Fetcher, client: OAuthClient, code: string): Promise<string> {
  const { status, body } = await postForm(fetcher, TOKEN_URL, {
    code,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    redirect_uri: client.redirectUri,
    grant_type: "authorization_code",
  });
  const b = (body ?? {}) as Record<string, unknown>;
  if (status !== 200 || typeof b.refresh_token !== "string" || !b.refresh_token) throw new Error(`gmail code exchange ${status}`);
  const scopes = typeof b.scope === "string" ? b.scope.split(/\s+/).filter(Boolean) : [];
  if (!scopes.includes(GMAIL_SCOPE) || scopes.some((s) => s.startsWith("https://www.googleapis.com/auth/gmail.") && s !== GMAIL_SCOPE) || new Set(scopes).has(FULL_MAIL_SCOPE)) {
    throw new Error("gmail scope not read-only");
  }
  return b.refresh_token;
}

/** A short-lived access token from the refresh token. TokenRefusedError when Google says the grant is gone. */
export async function accessToken(fetcher: Fetcher, client: Pick<OAuthClient, "clientId" | "clientSecret">, refresh: string): Promise<string> {
  const { status, body } = await postForm(fetcher, TOKEN_URL, { client_id: client.clientId, client_secret: client.clientSecret, refresh_token: refresh, grant_type: "refresh_token" });
  const b = (body ?? {}) as Record<string, unknown>;
  if (status === 400 || status === 401) {
    if (b.error === "invalid_grant" || b.error === "unauthorized_client") throw new TokenRefusedError();
  }
  if (status !== 200 || typeof b.access_token !== "string") throw new Error(`gmail token ${status}`);
  return b.access_token;
}

/** Tells Google to forget the grant (Disconnect on the Desk). Best effort. */
export async function revoke(fetcher: Fetcher, refresh: string): Promise<void> {
  await postForm(fetcher, REVOKE_URL, { token: refresh }).catch(() => undefined);
}

async function gmailGet(fetcher: Fetcher, token: string, path: string, query?: URLSearchParams): Promise<unknown> {
  const qs = query?.toString();
  const res = await fetcher(`${GMAIL_API}${path}${qs ? `?${qs}` : ""}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "error",
  });
  if (res.status === 401) throw new TokenRefusedError();
  if (res.status === 404 && path === "/history") throw new HistoryGoneError();
  if (!res.ok) throw new Error(`gmail ${res.status}`);
  return readBody(res);
}

/** The mailbox's current history id. */
export async function currentHistoryId(fetcher: Fetcher, token: string): Promise<string> {
  const b = (await gmailGet(fetcher, token, "/profile")) as Record<string, unknown> | null;
  const id = b?.historyId;
  if (typeof id !== "string" && typeof id !== "number") throw new Error("gmail profile without history id");
  return String(id);
}

export interface HistoryPage {
  history?: { id?: string; messagesAdded?: { message?: { id?: string; labelIds?: string[] } }[] }[];
  historyId?: string;
  nextPageToken?: string;
}

/** Every page of history since `start`: messages added to the inbox only. At most `maxPages` pages. */
export async function historySince(fetcher: Fetcher, token: string, start: string, maxPages = 5): Promise<HistoryPage[]> {
  const pages: HistoryPage[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const q = new URLSearchParams({ startHistoryId: start, historyTypes: "messageAdded", labelId: "INBOX", maxResults: "100" });
    if (pageToken) q.set("pageToken", pageToken);
    const page = ((await gmailGet(fetcher, token, "/history", q)) ?? {}) as HistoryPage;
    pages.push(page);
    pageToken = typeof page.nextPageToken === "string" ? page.nextPageToken : undefined;
    if (!pageToken) break;
  }
  return pages;
}

const MESSAGE_ID = /^[0-9a-f]{6,32}$/;
/** Labels that make an added message not new inbox mail for Nikita. */
const NOT_NEW = new Set(["DRAFT", "SENT", "SPAM", "TRASH", "CHAT"]);

/**
 * The history diff: the ids of messages newly added to the inbox, oldest first, each once, leaving out anything
 * already seen and anything Nikita sent or drafted himself. Pure, so it is tested on its own.
 */
export function newInboxIds(pages: HistoryPage[], seen: Iterable<string>): string[] {
  const skip = new Set(seen);
  const out: string[] = [];
  for (const page of pages) {
    for (const h of page.history ?? []) {
      for (const added of h.messagesAdded ?? []) {
        const m = added.message;
        const id = m?.id;
        if (typeof id !== "string" || !MESSAGE_ID.test(id) || skip.has(id)) continue;
        const labels = Array.isArray(m?.labelIds) ? m.labelIds : [];
        if (!labels.includes("INBOX") || labels.some((l) => NOT_NEW.has(l))) continue;
        skip.add(id);
        out.push(id);
      }
    }
  }
  return out;
}

/** The newest history id the pages report, to start the next check from. */
export function lastHistoryId(pages: HistoryPage[], fallback: string): string {
  let best = fallback;
  for (const p of pages) if (typeof p.historyId === "string" && /^\d+$/.test(p.historyId) && BigInt(p.historyId) > BigInt(best)) best = p.historyId;
  return best;
}

/** One message, fully. */
export async function readMessageRaw(fetcher: Fetcher, token: string, id: string): Promise<unknown> {
  if (!MESSAGE_ID.test(id)) throw new Error("not a message id");
  return gmailGet(fetcher, token, `/messages/${id}`, new URLSearchParams({ format: "full" }));
}

/* ── reading a message into something small and safe to sort ── */

/** The most body text that ever goes to a model. */
export const BODY_MAX = 2_500;

export interface MailForSort {
  id: string;
  at: number;
  from: string;
  /** The sender's address's domain only ("example.com"), a hint for the sort. */
  fromDomain: string;
  subject: string;
  /** Plain text, links taken out, trimmed to BODY_MAX. */
  body: string;
  /** Gmail filed it under Promotions or Social: sorted as noise without a model. */
  promo: boolean;
  /** A List-Unsubscribe header: a mailing list. */
  bulk: boolean;
}

interface Part {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: Part[];
  headers?: { name?: string; value?: string }[];
}

const b64 = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

function findPart(p: Part | undefined, type: string, depth = 0): string | null {
  if (!p || depth > 6) return null;
  if (p.mimeType === type && typeof p.body?.data === "string") return b64(p.body.data);
  for (const c of p.parts ?? []) {
    const got = findPart(c, type, depth + 1);
    if (got !== null) return got;
  }
  return null;
}

/** The entities mail text uses, decoded in one pass so "&amp;lt;" stays "&lt;" (any other entity becomes a space). */
const ENTITIES: Readonly<Record<string, string>> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'" };

/**
 * Mail text made plain and safe to quote: HTML tags and entities gone, every link and bare address of a web page
 * replaced by "[link]", invisible characters dropped, whitespace folded, trimmed to `max`.
 */
export function plainMail(raw: string, max = BODY_MAX): string {
  const text = raw
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#?\w{1,8});/g, (_, e: string) => ENTITIES[e.toLowerCase()] ?? " ")
    .replace(/\p{Cf}/gu, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\b(?:https?|ftp|mailto|javascript|data|vbscript):\S*/gi, "[link]")
    .replace(/\bwww\.\S+/gi, "[link]")
    .replace(/(?:\[link\][\s,]*){2,}/g, "[link] ")
    .replace(/^>.*$/gm, "")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** "Sam Reyes <sam@example.com>" → "Sam Reyes"; a bare address stays itself. Never more than 80 characters. */
export function senderName(header: string): string {
  const m = /^\s*"?([^"<]*?)"?\s*<[^>]+>\s*$/.exec(header);
  const name = (m?.[1] ?? "").trim();
  return plainMail(name || header.replace(/[<>]/g, "").trim(), 80);
}

export function senderDomain(header: string): string {
  const m = /@([A-Za-z0-9.-]+\.[A-Za-z]{2,24})/.exec(header);
  return (m?.[1] ?? "").toLowerCase().slice(0, 80);
}

/** A Gmail message (format=full) as the sort needs it; null when it isn't one. */
export function readMessage(raw: unknown): MailForSort | null {
  const m = raw as { id?: unknown; internalDate?: unknown; labelIds?: unknown; snippet?: unknown; payload?: Part } | null;
  if (!m || typeof m.id !== "string" || !MESSAGE_ID.test(m.id)) return null;
  const headers = new Map<string, string>();
  for (const h of m.payload?.headers ?? []) if (h.name && typeof h.value === "string") headers.set(h.name.toLowerCase(), h.value);
  const labels = Array.isArray(m.labelIds) ? (m.labelIds as unknown[]).filter((l): l is string => typeof l === "string") : [];
  const plain = findPart(m.payload, "text/plain");
  const html = plain === null ? findPart(m.payload, "text/html") : null;
  const body = plainMail(plain ?? html ?? (typeof m.snippet === "string" ? m.snippet : ""));
  const from = headers.get("from") ?? "";
  const at = Number(m.internalDate);
  return {
    id: m.id,
    at: Number.isFinite(at) && at > 0 ? at : Date.now(),
    from: senderName(from) || "Unknown sender",
    fromDomain: senderDomain(from),
    subject: plainMail(headers.get("subject") ?? "(no subject)", 160),
    body,
    promo: labels.includes("CATEGORY_PROMOTIONS") || labels.includes("CATEGORY_SOCIAL"),
    bulk: headers.has("list-unsubscribe"),
  };
}
