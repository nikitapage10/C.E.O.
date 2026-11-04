/**
 * Hey Skippy from the iPhone (#627, docs/HEY-SKIPPY.md). Azure only: azure/src/index.ts registers these behind the
 * same site gate as every function.
 *
 *   POST /api/capture  { text, voice? } with `x-ceo-phone-key: <phone key>` (or `Authorization: Bearer <phone key>` on
 *                      the Function App's own address: the Static Web App replaces Authorization; api/_haven/phones.ts). The iPhone's
 *                      "Skippy" shortcut dictates, posts the words here and speaks back `say`.
 *                        - a missing, malformed, unknown or revoked key: 401 { error: "unauthorized" }, nothing more;
 *                        - past the key's 30 an hour: 429 { say } with Retry-After;
 *                        - text over 300 characters: 400 { say };
 *                        - otherwise 200 { say, quiet, audio? }: rules sort the words first (api/_haven/classify.ts):
 *                          shopping items go on the Kitchen list (api/_haven/list.ts), a home-device ask ("feed the
 *                          cat", "clean the kitchen", "clean the litter box") through api/_haven/devices/home.ts and
 *                          its rails (#632), a to-do into the to-dos
 *                          (api/_haven/todos.ts, into Today's store), and anything else to Desk Skippy's own chat (`phoneAnswer` in
 *                          api/skippy.ts: the same prompt, router, caps and hand-offs, marked "phone"). A finished
 *                          action (a list add, a to-do, a device action that worked with nothing to warn of) answers
 *                          `quiet: true` with a short `say` and never an `audio` link or an ElevenLabs call (#652): the
 *                          shortcut shows it as a notification. A question, an answer, a refusal, a failure or a
 *                          warning is `quiet: false`. With
 *                          `voice: true`, `audio` is a five-minute, single-use link to `say` in Skippy's voice
 *                          (api/_haven/audio.ts), left out when ElevenLabs' cap is spent or it doesn't answer.
 *                      The words are never logged; a log line says only which way a capture went.
 *   GET  /api/capture?a=<signed link>   the answer's audio, once (WAV). 404 when used, expired or never made.
 *   GET  /api/haven?view=status          the counts only (the Kitchen list's open and ticked items, open phone to-dos).
 *   GET  /api/haven?view=list            passkey session: the Kitchen list's items.
 *   GET  /api/haven?view=phones          passkey session: the phones (label, added, last used, revoked) and the
 *                                        greeting clips' state. Never a key or a hash.
 *   POST /api/haven { action: "tick", id, done }         passkey session: tick an item off, or back on.
 *   POST /api/haven { action: "remove", id }            passkey session: take an item off the list (hidden at once, kept
 *                                                        ten minutes, #657). 404 when there is no such item.
 *   POST /api/haven { action: "undo-remove", id }        passkey session: bring a removed item back. 404 when it is gone.
 *   POST /api/haven { action: "add-phone", label }       passkey session: a new phone; its key comes back this once.
 *   POST /api/haven { action: "revoke-phone", id }       passkey session: that phone's key opens nothing from now on.
 *   POST /api/haven { action: "make-greetings" }         passkey session: (re)make the greeting clips, under
 *                                                        ElevenLabs' cap.
 *   POST /api/haven { action: "instacart" }              passkey session: Send to Instacart (#637,
 *                                                        api/_haven/instacart.ts): the open items become an Instacart
 *                                                        shopping list page → { url, items }. 503 without the key,
 *                                                        409 when nothing is open, 502 when Instacart said no.
 *   GET  /api/hey-skippy (and /hey-skippy/hello.mp3)    one of the greeting clips at random (MP3), public by design.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { pickBlob, type BlobBackend } from "../_blob.js";
import { deskKeyFor } from "../_desk/keys.js";
import { requireSession, withCookie, type DeskDeps } from "../_desk/session.js";
import { pickAuthStore } from "../_desk/store.js";
import { phoneAnswer, type PhoneTurn } from "../skippy.js";
import { elevenFromEnv, pickStoryStore } from "../_world/story.js";
import { audioIdOf, greetClip, greetState, makeGreetings, speakForPhone, takeAudio, type VoiceDeps } from "./audio.js";
import { classify, itemsOf, sayAdded, sayRemoved, sayTodo, spokenOf } from "./classify.js";
import { PhoneConvo, type ConvoTurn } from "./convo.js";
import { privateParts } from "../_privacy.js";
import { KitchenList } from "./list.js";
import { PhoneKeys, KEY_SHAPE } from "./phones.js";
import { phoneKeyOf } from "./links.js";
import { PhoneTodos, type TodoSink } from "./todos.js";
import type { Home } from "./devices/home.js";
import { homeFromEnv } from "./devices/live.js";
import { instacartFrom, sendToInstacart, type InstacartConfig } from "./instacart.js";
import type { Fetch } from "./devices/http.js";

type Env = Record<string, string | undefined>;

/** The longest dictated text taken. */
export const TEXT_MAX = 300;
/** The most a request body may be (bytes). */
const BODY_MAX = 4 * 1024;

export interface HavenDeps {
  desk: DeskDeps;
  blob: BlobBackend | null;
  /** The pepper phone keys are hashed with (`deskKeyFor(deskKey, "phone")`). */
  pepper: () => Promise<Buffer>;
  todos: (blob: BlobBackend) => TodoSink;
  /** Desk Skippy's chat for the phone (api/skippy.ts), with the phone's last few turns. */
  skippy: (text: string, phoneId: string, history: ConvoTurn[]) => Promise<PhoneTurn>;
  voice: Omit<VoiceDeps, "blob"> | null;
  log: (line: string) => void;
  random: () => number;
  /** The home devices (#632, api/_haven/devices/home.ts), or null when they aren't set up here. */
  devices?: () => Home | null;
  /** Send to Instacart (#637): the IDP key and environment, or null until the key is in the Key Vault. */
  instacart?: InstacartConfig | null;
  fetch?: Fetch;
}

export function liveDeps(env: Env = process.env): HavenDeps {
  const deskKey = env.FOUNDRY_DESK_KEY ?? "";
  const eleven = elevenFromEnv(env);
  return {
    desk: { deskKey, store: pickAuthStore(env), now: Date.now() },
    blob: pickBlob(env),
    pepper: () => deskKeyFor(deskKey, "phone"),
    todos: (blob) => new PhoneTodos(blob),
    skippy: (text, phoneId, history) => phoneAnswer(text, phoneId, history),
    voice: { eleven, ledger: pickStoryStore(env), deskKey },
    log: (line) => console.log(line),
    random: Math.random,
    devices: () => homeFromEnv(env),
    instacart: instacartFrom(env),
    fetch: (url, init) => fetch(url, init),
  };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", ...headers } });
}

const unauthorized = () => json({ error: "unauthorized" }, 401);


/** What Skippy says when his chat couldn't answer from the phone. */
const SKIPPY_SAYS: Record<NonNullable<PhoneTurn["error"]>, string> = {
  private: "That sounded private, so I didn't send it anywhere.",
  "slow-down": "Slow down, monkey. Give me a minute.",
  "not-set-up": "My chat isn't switched on here yet.",
  model: "My magnificent mind hiccupped. Try again in a bit.",
  text: "Texts need the Desk, so you can see the draft before anything goes.",
};

/** POST /api/capture. */
export async function capture(request: Request, deps: HavenDeps): Promise<Response> {
  const key = phoneKeyOf(request);
  if (!key || !KEY_SHAPE.test(key)) return unauthorized();
  if (!deps.blob || !deps.desk.deskKey) return unauthorized();
  const phones = new PhoneKeys(deps.blob, await deps.pepper());
  const now = deps.desk.now;
  let check: Awaited<ReturnType<PhoneKeys["use"]>>;
  try {
    check = await phones.use(key, now);
  } catch {
    return json({ error: "unavailable" }, 503);
  }
  if (!check.ok && check.why === "slow") return json({ say: "Easy, monkey. That's your lot for this hour." }, 429, { "Retry-After": String(check.wait ?? 60) });
  if (!check.ok) return unauthorized();

  if (Number(request.headers.get("content-length") ?? 0) > BODY_MAX) return json({ say: "That's too long for me. Keep it short." }, 413);
  const raw = await request.text().catch(() => "");
  if (raw.length > BODY_MAX) return json({ say: "That's too long for me. Keep it short." }, 413);
  type Body = { text?: unknown; voice?: unknown };
  let body: Body | null;
  try {
    const got: unknown = JSON.parse(raw);
    body = got && typeof got === "object" && !Array.isArray(got) ? (got as Body) : null;
  } catch {
    body = null;
  }
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return json({ say: "I didn't catch anything. Try again." }, 400);
  if (text.length > TEXT_MAX) return json({ say: "That's too long for me. Keep it under a few sentences." }, 400);

  // The phone's last few turns (ten quiet minutes at most), so a second press follows on from the first.
  const convo = new PhoneConvo(deps.blob);
  const before = await convo.read(check.phone.id, now).catch(() => null);
  const sorted = classify(text, before?.last ?? null);
  let say: string;
  // A finished action the person isn't waiting to hear about (#652): shown as a notification, never read out.
  let quiet = false;
  try {
    if (sorted.kind === "shopping") {
      // "Not as a task" right after a to-do (#641): that to-do moves onto the list.
      let items = sorted.items;
      if (sorted.fromLastTodo) {
        const moved = (await deps.todos(deps.blob).takeBackLast?.(now)) ?? null;
        items = moved ? itemsOf(moved.replace(/^(?:add|buy|get|pick up|grab)\s+/i, "")).filter((i) => i.length <= 60).slice(0, 12) : [];
      }
      if (sorted.fromLastTodo && !items.length) say = "Tell me what to put on the list, and I'll add it.";
      else {
        const { added, already } = await new KitchenList(deps.blob).add(items, now);
        say = sayAdded(added, already);
        quiet = added.length > 0 || already.length > 0;
      }
    } else if (sorted.kind === "remove") {
      // Off the Kitchen list (#657): quiet when everything asked for went; spoken when one is missing or could be two.
      const out = await new KitchenList(deps.blob).removeByName(sorted.items, now);
      say = sayRemoved(out);
      quiet = out.removed.length > 0 && !out.missing.length && !out.ambiguous.length;
    } else if (sorted.kind === "device") {
      // The home devices (#632): the same rails as the Desk's buttons, and the Council keeps the words as said.
      const home = deps.devices?.() ?? null;
      if (home) {
        const done = await home.act({ action: sorted.action, rooms: sorted.rooms, portions: sorted.portions, plate: sorted.plate, suction: sorted.suction, water: sorted.water, via: "phone", said: text });
        say = done.say;
        // Only a plain success: a refusal, a warning or a "what's in the tray" question is spoken.
        quiet = done.ok && !done.warned && sorted.action !== "wet.status";
      } else say = "The home devices aren't set up here yet.";
    } else if (sorted.kind === "todo") {
      const todo = await deps.todos(deps.blob).addTodo(sorted.text, now);
      say = sayTodo(todo.text, todo.due, now);
      quiet = true;
    } else {
      // A turn that looks private is left out of what Skippy is shown again, so it can't hold up the next ask.
      const history = (before?.turns ?? []).filter((t) => privateParts(t.text).length === 0);
      const turn = await deps.skippy(sorted.text || text, check.phone.id, history);
      say = turn.error ? SKIPPY_SAYS[turn.error] : spokenOf(turn.reply, turn.handedOff);
    }
  } catch {
    deps.log(`capture: ${sorted.kind} failed`);
    return json({ say: "Something broke on my end. Try again in a bit." }, 502);
  }
  // Which way it went, never what was said.
  deps.log(`capture: ${sorted.kind}`);
  await convo.add(check.phone.id, text, say, sorted.kind, now).catch(() => undefined);
  // A quiet ack makes no ElevenLabs call and carries no audio link; the shortcut shows `say` as a notification.
  if (quiet) return json({ say, quiet: true });
  if (body?.voice !== true || !deps.voice) return json({ say, quiet: false });
  const token = await speakForPhone(say, { ...deps.voice, blob: deps.blob }, now).catch(() => null);
  if (!token) return json({ say, quiet: false });
  const url = new URL(request.url);
  return json({ say, quiet: false, audio: `${url.origin}/api/capture?a=${encodeURIComponent(token)}` });
}

/** GET /api/capture?a=…: the answer's audio, once. */
export async function captureAudio(request: Request, deps: HavenDeps): Promise<Response> {
  const id = audioIdOf(new URL(request.url).searchParams.get("a"), deps.desk.deskKey, deps.desk.now);
  if (!id || !deps.blob) return json({ error: "not-found" }, 404);
  const bytes = await takeAudio(deps.blob, id).catch(() => null);
  if (!bytes) return json({ error: "not-found" }, 404);
  return new Response(bytes as Uint8Array<ArrayBuffer>, { status: 200, headers: { "Content-Type": "audio/wav", "Cache-Control": "private, no-store", "Content-Length": String(bytes.length) } });
}

/** GET /api/haven. */
export async function havenGet(request: Request, deps: HavenDeps): Promise<Response> {
  const view = new URL(request.url).searchParams.get("view");
  const now = deps.desk.now;
  if (view === "status") {
    if (!deps.blob) return json({ kitchen: { open: 0, done: 0 }, todos: 0, ready: false });
    const [kitchen, todos] = await Promise.all([new KitchenList(deps.blob).counts(now).catch(() => ({ open: 0, done: 0 })), deps.todos(deps.blob).openCount(now).catch(() => 0)]);
    return json({ kitchen, todos, ready: true });
  }
  if (view !== "list" && view !== "phones") return json({ error: "bad-request" }, 400);
  const signed = await requireSession(request, deps.desk);
  if (!signed.ok) return signed.response;
  if (!deps.blob) return withCookie(json({ error: "not-set-up" }, 503), signed);
  if (view === "list") return withCookie(json({ items: await new KitchenList(deps.blob).items(now) }), signed);
  const phones = new PhoneKeys(deps.blob, await deps.pepper());
  const [list, greet] = await Promise.all([phones.list(), greetState(deps.blob).catch(() => ({ made: null, clips: 0 }))]);
  return withCookie(json({ phones: list, greetings: greet, voice: Boolean(deps.voice?.eleven) }), signed);
}

/** POST /api/haven. */
export async function havenPost(request: Request, deps: HavenDeps): Promise<Response> {
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return json({ error: "bad-request" }, 415);
  if (Number(request.headers.get("content-length") ?? 0) > BODY_MAX) return json({ error: "too-big" }, 413);
  const signed = await requireSession(request, deps.desk);
  if (!signed.ok) return signed.response;
  const reply = (body: unknown, status = 200) => withCookie(json(body, status), signed);
  if (!deps.blob) return reply({ error: "not-set-up" }, 503);
  const raw = await request.text().catch(() => "");
  if (raw.length > BODY_MAX) return reply({ error: "too-big" }, 413);
  let body: Record<string, unknown> = {};
  try {
    const got: unknown = JSON.parse(raw);
    if (got && typeof got === "object" && !Array.isArray(got)) body = got as Record<string, unknown>;
  } catch {
    return reply({ error: "bad-request" }, 400);
  }
  const now = deps.desk.now;
  if (body.action === "tick") {
    if (typeof body.done !== "boolean") return reply({ error: "bad-request" }, 400);
    const ok = await new KitchenList(deps.blob).tick(body.id, body.done, now);
    return ok ? reply({ ok: true }) : reply({ error: "not-found" }, 404);
  }
  if (body.action === "remove" || body.action === "undo-remove") {
    const list = new KitchenList(deps.blob);
    const ok = body.action === "remove" ? await list.remove(body.id, now) : await list.restore(body.id, now);
    return ok ? reply({ ok: true }) : reply({ error: "not-found" }, 404);
  }
  if (body.action === "instacart") {
    const sent = await sendToInstacart({ fetch: deps.fetch ?? fetch, config: deps.instacart ?? null, blob: deps.blob, now, log: deps.log }, await new KitchenList(deps.blob).items(now));
    if (sent.ok) return reply({ ok: true, url: sent.url, items: sent.items });
    return reply({ error: sent.error }, sent.error === "not-set-up" ? 503 : sent.error === "empty" ? 409 : 502);
  }
  const phones = new PhoneKeys(deps.blob, await deps.pepper());
  if (body.action === "add-phone") {
    const made = await phones.add(body.label, now);
    if (!made) return reply({ error: "too-many" }, 409);
    // The phone's label and id only: the key is in this answer and nowhere else, ever.
    deps.log(`haven: phone ${made.phone.id} added`);
    return reply({ phone: made.phone, key: made.key });
  }
  if (body.action === "revoke-phone") {
    const ok = await phones.revoke(body.id, now);
    if (ok) {
      deps.log("haven: a phone was revoked");
      await new PhoneConvo(deps.blob).forget(String(body.id)).catch(() => undefined);
    }
    return ok ? reply({ ok: true }) : reply({ error: "not-found" }, 404);
  }
  if (body.action === "make-greetings") {
    if (!deps.voice) return reply({ error: "no-voice" }, 503);
    const made = await makeGreetings({ ...deps.voice, blob: deps.blob }, now).catch(() => ({ error: "eleven" as const }));
    return "error" in made ? reply(made, made.error === "over-budget" ? 429 : 503) : reply(made);
  }
  return reply({ error: "bad-request" }, 400);
}

/** GET /api/hey-skippy: a greeting clip. */
export async function greeting(_request: Request, deps: HavenDeps): Promise<Response> {
  if (!deps.blob) return json({ error: "not-found" }, 404);
  const bytes = await greetClip(deps.blob, deps.random()).catch(() => null);
  if (!bytes) return json({ error: "not-found" }, 404);
  return new Response(bytes as Uint8Array<ArrayBuffer>, { status: 200, headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "Content-Length": String(bytes.length) } });
}

/* ── The handlers Azure registers ── */

export const captureRoute = {
  POST: (request: Request) => capture(request, liveDeps()),
  GET: (request: Request) => captureAudio(request, liveDeps()),
};
export const havenRoute = {
  GET: (request: Request) => havenGet(request, liveDeps()),
  POST: (request: Request) => havenPost(request, liveDeps()),
};
export const greetRoute = { GET: (request: Request) => greeting(request, liveDeps()) };
