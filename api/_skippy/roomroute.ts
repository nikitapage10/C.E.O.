/**
 * Talking to the rooms (#638): the mic on every Desk room's page. Azure only: azure/src/index.ts registers it behind the
 * site gate like every function. The voices and the ElevenLabs calls are in api/_skippy/roomvoice.ts.
 *
 *   POST /api/skippy-room  { room, text, history?, last?, page? }   passkey session only (requireSession), checked before the
 *                          body is read. `room` is a Desk page with a lead (ROOM_VOICES: Today is Skippy himself), `text` what Nikita said (at
 *                          most 300 characters, the browser's own speech recognition), `history` the room's last few turns
 *                          the browser kept ({ who, text }, never stored here) and `last` which way the room's last ask
 *                          went (a shopping follow-on, "and milk too"), and `page` what the Desk page shows (#926: a hint for "this", never a
 *                          limit; the chat's own `page` check).
 *   POST /api/skippy-room?room=<room>  with an audio body (Content-Type audio/webm, ogg or mp4, at most 512 kB): the same,
 *                          for a browser without speech recognition; ElevenLabs Scribe writes the words first, and the
 *                          clip is never kept.
 *     → 200 { say, kind, audio? }: in the Haven, the Kitchen list and the to-dos' own rules sort shopping and a
 *       to-do first with no model call, as Hey Skippy does (api/_haven/classify.ts). Everything else, on every page,
 *       goes to Skippy's one brain as the room's submind (#926, `roomAnswer` in api/skippy.ts: the rules tier for the
 *       thermostat and the home devices, then the fast tier and deeper, with every room's tools, the same prompt plus
 *       the room's rules, the same budget caps, pace, room log and hand-offs; the turn is kept for the Council marked
 *       `via: "room"`). So "open the wet food feeder" works from the Green as from the Haven. `say` is cut to one or
 *       two spoken sentences; `audio` is `say` in Skippy's voice with the submind's bend (MP3, base64), on every
 *       answer, a refusal or a failure too, left out only past ElevenLabs' cap or when it doesn't answer, so the
 *       answer still shows as a caption.
 *   POST /api/skippy-room  { room, speak }   a room's own intent handler answered in the browser (@ceo/engine/voice):
 *                          only that line (at most 300 characters) read aloud, no model call → 200 { say, kind: "spoken", audio? }.
 *   POST /api/skippy-room  { room: "today", speak, as }   Today's Senate Rotunda (#755): a caption read aloud in Skippy's
 *                          voice bent its member's way (`as` is its seat, "kernel" the chair; api/_skippy/rotundavoice.ts), kept in
 *                          the blob store by hash so each line is made once ever → 200 { say, kind: "spoken", audio?, cached? }.
 *   POST /api/skippy-room  { room: "today", senate: "debate" | "reply" | "join", … }   the Senate's live talk (#910,
 *                          api/_skippy/senatetalk.ts): a new recess argument, the members' answers to Nikita on the
 *                          floor, or his words joined to the argument on the floor (#925), on Claude Haiku under the
 *                          Senate's $10 inside Skippy's month → 200 { debate } | { lines } | { join } | { quiet }. Words on
 *                          the floor ("reply" or "join") go to Skippy's one brain first (#926), with the argument as the
 *                          page: what he can act on or answer ("can you dispense one portion of dry food?") comes back as
 *                          the chair's line → 200 { lines: [{ by: "kernel", text }], skippy: true, audio?, wrote? }; his
 *                          fast tier judges a remark on the debate itself and gives it back to the members' live talk.
 *     → 401 signed-out, 403 cross-site, 400 { say } nothing heard or too long, 413 too big, 415 not JSON or audio,
 *       422 { say, audio? } held by the privacy check, 429 { say, audio? } the chat's pace, 502 { say, audio? }, 503
 *       not-set-up.
 *
 * Nothing Nikita says is logged: a log line says only which room and which way an ask went.
 */

import { pickBlob, type BlobBackend } from "../_blob.js";
import { requireSession, withCookie, type DeskDeps } from "../_desk/session.js";
import { pickAuthStore } from "../_desk/store.js";
import { privateParts } from "../_privacy.js";
import { classify, sayAdded, sayTodo, type Capture } from "../_haven/classify.js";
import { listOf } from "../_haven/list.js";
import { PhoneTodos, type TodoSink } from "../_haven/todos.js";
import { elevenFromEnv, pickStoryStore, type ElevenConfig, type StoryStore } from "../_world/story.js";
import { roomAnswer, type PhoneTurn, type RoomTurn } from "../skippy.js";
import { ROOM_SUBMINDS, isNeeds } from "./log.js";
import { castVoiceOf, ROTUNDA_SAY_MAX, speakCast } from "./rotundavoice.js";
import { BlobChatLedger, KERNEL_LEDGER_PATH, skippyBudget } from "./budget.js";
import { BlobTopicStore, chairQuips, floorReply, joinDebate, liveAsk, newDebate, readSeats, type SenateDeps } from "./senatetalk.js";
import {
  CLIP_MAX_BYTES,
  CLIP_TYPES,
  ROOM_SAY_MAX,
  ROOM_VOICES,
  roomRules,
  roomVoiceOf,
  speakRoom,
  spokenRoom,
  transcribeRoom,
  type RoomVoice,
} from "./roomvoice.js";

/** The longest words taken (the phone's own cap). */
export const ROOM_TEXT_MAX = 300;
/** The most a JSON body may be (bytes): the words, the history, the page's lines and the screen's metadata. */
const BODY_MAX = 12 * 1024;
/** The header a clip's screen metadata rides in (#1027): its JSON, URI-encoded. */
export const SCREEN_HEADER = "x-ceo-screen";
/** The most of the page's lines taken (the chat's own `page` cap, api/_skippy/prompt.ts readPage, applies after). */
const PAGE_MAX = 1_600;
/** The turns the browser may send back, at most. */
const HISTORY_MAX = 6;

type Env = Record<string, string | undefined>;

export interface RoomRouteDeps {
  desk: DeskDeps;
  blob: BlobBackend | null;
  eleven: ElevenConfig | null;
  ledger: Pick<StoryStore, "loadSpend" | "addSpend"> | null;
  /** Desk Skippy's chat, as the room's submind (api/skippy.ts). */
  skippy: (text: string, history: { who: "nikita" | "skippy"; text: string }[], passkey: string, room: RoomTurn) => Promise<PhoneTurn>;
  todos: (blob: BlobBackend) => TodoSink;
  fetcher: typeof fetch;
  log: (line: string) => void;
  /** The Senate's live talk (#910), or null when it isn't set up here. */
  senate?: (() => SenateDeps) | null;
}

export function liveDeps(env: Env = process.env): RoomRouteDeps {
  return {
    desk: {
      deskKey: env.FOUNDRY_DESK_KEY ?? "",
      store: pickAuthStore(env),
      now: Date.now(),
    },
    blob: pickBlob(env),
    eleven: elevenFromEnv(env),
    ledger: pickStoryStore(env),
    skippy: (text, history, passkey, room) => roomAnswer(text, history, passkey, room),
    todos: (blob) => new PhoneTodos(blob),
    fetcher: (input, init) => fetch(input, init),
    log: (line) => console.log(line),
    senate: () => {
      const blob = pickBlob(env);
      return {
        chat: blob ? new BlobChatLedger(blob) : null,
        kernel: blob ? new BlobChatLedger(blob, KERNEL_LEDGER_PATH) : null,
        topics: blob ? new BlobTopicStore(blob) : null,
        ask: liveAsk(),
        budget: skippyBudget(env.SKIPPY_BUDGET_USD),
        now: Date.now(),
        log: (line) => console.log(line),
      };
    },
  };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
      ...headers,
    },
  });
}

/** What the submind says when the chat couldn't answer. Short, spoken, in no one's costume. */
export const ROOM_SAYS: Record<NonNullable<PhoneTurn["error"]>, string> = {
  private: "That sounded private, so I didn't send it anywhere.",
  "slow-down": "Slow down, monkey. Give me a minute.",
  "not-set-up": "My chat isn't switched on here yet.",
  model: "My magnificent mind hiccupped. Try again in a bit.",
  text: "Texts need Skippy's chat, so you can see the draft before anything goes.",
};
const STATUS: Record<NonNullable<PhoneTurn["error"]>, number> = {
  private: 422,
  "slow-down": 429,
  "not-set-up": 503,
  model: 502,
  text: 200,
};

const KINDS: readonly Capture["kind"][] = ["shopping", "todo", "device", "skippy"];
const readLast = (v: unknown): Capture["kind"] | null => ((KINDS as readonly unknown[]).includes(v) ? (v as Capture["kind"]) : null);

function readHistory(v: unknown): { who: "nikita" | "skippy"; text: string }[] {
  return (
    (Array.isArray(v) ? v : [])
      .filter(
        (t): t is { who: "nikita" | "skippy"; text: string } =>
          !!t && typeof t === "object" && (t.who === "nikita" || t.who === "skippy") && typeof t.text === "string",
      )
      .slice(-HISTORY_MAX)
      .map((t) => ({
        who: t.who,
        text: t.text.replace(/\s+/g, " ").trim().slice(0, 600),
      }))
      // A turn that looks private is left out, so it can't hold up the next ask.
      .filter((t) => t.text && privateParts(t.text).length === 0)
  );
}

/** The words as said, one line. */
const tidyText = (v: unknown) =>
  typeof v === "string"
    ? v
        .normalize("NFKC")
        .replace(/\p{Cc}/gu, " ")
        .replace(/\s+/g, " ")
        .trim()
    : "";

/** POST /api/skippy-room. */
export async function roomVoicePost(request: Request, deps: RoomRouteDeps): Promise<Response> {
  const type = (request.headers.get("content-type") ?? "").toLowerCase();
  const audio = CLIP_TYPES.test(type);
  if (!audio && !type.startsWith("application/json")) return json({ error: "bad-request" }, 415);
  if (Number(request.headers.get("content-length") ?? 0) > (audio ? CLIP_MAX_BYTES : BODY_MAX)) return json({ error: "too-big" }, 413);
  // Only in a passkey session, checked before the body is read: without one nothing goes anywhere.
  const signed = await requireSession(request, deps.desk);
  if (!signed.ok) return signed.response;
  const res = await answer(request, deps, signed.passkey.id, audio, type).catch(() => json({ say: "Something broke on my end. Try again in a bit." }, 502));
  return withCookie(res, signed);
}

async function answer(request: Request, deps: RoomRouteDeps, passkey: string, audio: boolean, type: string): Promise<Response> {
  const now = deps.desk.now;
  let voice: RoomVoice | null;
  let text: string;
  let history: { who: "nikita" | "skippy"; text: string }[] = [];
  let last: Capture["kind"] | null = null;
  // What the page shows (#926): a hint for "this" and "that one", never a filter on what he can do.
  let page = "";
  // What Nikita is looking at (#1027): the screen's metadata, and the screenshot's id once Skippy asked to look.
  let screen: unknown;
  let shot = "";
  let look = true;
  if (audio) {
    voice = roomVoiceOf(new URL(request.url).searchParams.get("room"));
    if (!voice) return json({ error: "bad-request" }, 400);
    const clip = new Uint8Array(await request.arrayBuffer());
    if (clip.length > CLIP_MAX_BYTES) return json({ error: "too-big" }, 413);
    text = tidyText(await transcribeRoom(clip, type, deps.eleven, deps.ledger, now, deps.fetcher));
    const header = request.headers.get(SCREEN_HEADER) ?? "";
    if (header && header.length <= 6_000) {
      try {
        screen = decodeURIComponent(header);
      } catch {
        screen = undefined;
      }
    }
  } else {
    const raw = await request.text().catch(() => "");
    if (raw.length > BODY_MAX) return json({ error: "too-big" }, 413);
    let body: Record<string, unknown> = {};
    try {
      const got: unknown = JSON.parse(raw);
      if (got && typeof got === "object" && !Array.isArray(got)) body = got as Record<string, unknown>;
    } catch {
      return json({ error: "bad-request" }, 400);
    }
    voice = roomVoiceOf(body.room);
    if (!voice) return json({ error: "bad-request" }, 400);
    // A room's own intent handler answered in the browser (@ceo/engine/voice): only its line read aloud, no model call.
    // Today's Rotunda (#755): a caption read aloud in Skippy's voice, bent its member's way, cached once ever (rotundavoice.ts).
    if (body.speak !== undefined && body.text === undefined && body.as !== undefined && voice.room === "today") return speakAs(body.as, tidyText(body.speak), deps);
    // The Senate's live talk (#910): a new argument, or the members answering Nikita on the floor.
    if (voice.room === "today" && (body.senate === "debate" || body.senate === "reply" || body.senate === "join")) {
      // Words on the floor (#926): Skippy's one brain hears them first, with the argument as the page, and judges
      // (its fast tier, not word lists): a request or a question is his, answered as the chair's line; only a remark on
      // the debate itself goes on to the members' live talk, joined to the argument (#925) or answered in kind (#910).
      const said = body.senate !== "debate" ? tidyText(body.said).slice(0, ROOM_TEXT_MAX) : "";
      if (said) {
        const chair = await chairAnswers(said, body, deps, passkey);
        if (chair) return chair;
      }
      const sd = deps.senate?.();
      if (!sd) return json({ quiet: "off" });
      return json(body.senate === "debate" ? await newDebate(body, sd) : body.senate === "join" ? await joinDebate(body, sd) : await floorReply(body, sd));
    }
    if (body.speak !== undefined && body.text === undefined) return speakOnly(voice, tidyText(body.speak), deps);
    text = tidyText(body.text);
    history = readHistory(body.history);
    page = typeof body.page === "string" ? body.page.slice(0, PAGE_MAX) : "";
    screen = body.screen;
    shot = typeof body.shot === "string" ? body.shot.slice(0, 40) : "";
    look = body.look !== false;
    last = readLast(body.last);
  }
  if (!text) return json({ say: "I didn't catch anything. Try again." }, 400);
  if (text.length > ROOM_TEXT_MAX) return json({ say: "That's too long for me. Keep it to a sentence or two." }, 400);

  // The Haven's list and to-do rules first, with no model call (Hey Skippy's own, api/_haven/classify.ts). Only in the
  // Haven: in the Green "add Tre Tucker" is a waiver claim, not shopping. A device ask is the brain's, on every page.
  const ruled: Capture = voice.room === "haven" ? classify(text, last) : { kind: "skippy", text };
  const sorted: Capture = ruled.kind === "shopping" || ruled.kind === "todo" ? ruled : { kind: "skippy", text };
  let say: string;
  let status = 200;
  // The tools that changed something on the submind's turn (#698): the page reads itself again.
  let wrote: { wrote: string[]; did: string[] } | null = null;
  let deviceTurn = false;
  if (sorted.kind === "shopping" && deps.blob) {
    // Things to buy (#735) when the words said so; the Kitchen list otherwise.
    const { added, already } = await listOf(deps.blob, sorted.list ?? "kitchen").add(sorted.items, now);
    say = sayAdded(added, already, sorted.list);
    if (added.length) wrote = { wrote: [sorted.list === "buy" ? "buy_add" : "kitchen_add"], did: [] };
  } else if (sorted.kind === "todo" && deps.blob) {
    const todo = await deps.todos(deps.blob).addTodo(sorted.text, now);
    say = sayTodo(todo.text, todo.due, now);
  } else {
    const sub = voice.log ? ROOM_SUBMINDS[voice.log] : null;
    const turn = await onceMore(() =>
      deps.skippy(text, history, passkey, {
        rules: roomRules(voice),
        log: voice.log,
        by: sub && isNeeds(sub.id) ? sub.id : null,
        ...(page && { page }),
        ...(screen !== undefined && { screen }),
        ...(shot && { shot }),
        ...(!look && { look: false }),
      }),
    );
    // Skippy asked to look at the screen (#1027): the browser captures the page and sends the words again with the shot
    // (a clip's words come back with it, so they aren't transcribed twice). Nothing is said yet.
    if (turn.needScreen) return json({ needScreen: true, text, kind: "skippy" });
    say = turn.error ? ROOM_SAYS[turn.error] : spokenRoom(turn.reply, turn.handedOff);
    status = turn.error ? STATUS[turn.error] : 200;
    if (!turn.error && turn.wrote?.length) wrote = { wrote: turn.wrote, did: turn.did ?? [] };
    // The rules tier ran a device (#926): said as a device ask, as before.
    if (!turn.error && turn.tier === "rules" && turn.wrote?.includes("home_device")) deviceTurn = true;
  }
  const kind = sorted.kind === "shopping" || sorted.kind === "todo" ? (deps.blob ? sorted.kind : "skippy") : deviceTurn ? "device" : sorted.kind;
  // Which room and which way, never what was said.
  deps.log(`room voice: ${voice.room} ${kind}${audio ? " (clip)" : ""}`);
  // Every answer in his voice when the sound is on (#926): a refusal or a failure too, with its status.
  const spoken = await speakRoom(say, voice.sound, deps.eleven, deps.ledger, now, deps.fetcher);
  const voiced = spoken ? { audio: Buffer.from(spoken).toString("base64") } : {};
  if (status !== 200) return json({ say, kind, ...voiced }, status);
  return json({
    say,
    kind,
    ...wrote,
    ...voiced,
  });
}

/** The Senate as the page Skippy hears the floor's words on: in session, and the argument's motion and last lines. */
export function senatePage(body: Record<string, unknown>): string {
  const motion = tidyText(body.motion).slice(0, 200);
  const lines = (Array.isArray(body.lines) ? body.lines : [])
    .slice(-4)
    .map((l) => (l && typeof l === "object" ? (l as Record<string, unknown>) : {}))
    .map((l) => `${tidyText(l.by).slice(0, 20)}: ${tidyText(l.text).slice(0, 200)}`)
    .filter((l) => !privateParts(l).length);
  return ["The Senate is in session: the subminds argue a motion on the floor, and Nikita holds Space to speak.", motion && !privateParts(motion).length ? `The argument on: ${motion}` : "", ...lines].filter(Boolean).join("\n");
}

/**
 * A turn whose model failed is asked once more before the hiccup line is said (#952, Nikita 02:30Z: one failed call on
 * the Senate's floor came straight back as "My magnificent mind hiccupped"). Only a model failure: a refusal for
 * privacy, the pace or the month is final.
 */
export async function onceMore(ask: () => Promise<PhoneTurn>): Promise<PhoneTurn> {
  const failed = (): PhoneTurn => ({ reply: "", handedOff: false, error: "model" });
  const first = await ask().catch(failed);
  return first.error === "model" ? ask().catch(failed) : first;
}

/**
 * The chair takes words from the Senate's floor himself (#926): Skippy's one brain as Today, the same tools, caps and
 * privacy check as any room's mic, answered in the shape the floor already voices (`{ lines }`, the chair's line).
 */
async function chairAnswers(said: string, body: Record<string, unknown>, deps: RoomRouteDeps, passkey: string): Promise<Response | null> {
  const today = ROOM_VOICES.today!;
  const turn = await onceMore(() => deps.skippy(said, [], passkey, { rules: roomRules(today), log: today.log, by: null, page: senatePage(body), floor: true }));
  // A remark on the argument: the members answer it.
  if (turn.floor) return null;
  const text = turn.error ? ROOM_SAYS[turn.error] : spokenRoom(turn.reply, turn.handedOff);
  deps.log(`room voice: today senate-skippy${turn.error ? ` ${turn.error}` : ""}`);
  const wrote = !turn.error && turn.wrote?.length ? { wrote: turn.wrote, did: turn.did ?? [] } : {};
  // The Senate's floor asks for text (#1104, `voice: false`): his answer shows written, unspoken, and a member or two
  // may chime in underneath with a quip (never on a failed turn).
  if (body.voice === false) {
    const sd = turn.error ? null : deps.senate?.();
    const quips = sd ? await chairQuips(said, text, readSeats(body.seated), sd).catch(() => []) : [];
    return json({ lines: [{ by: "kernel", text }], skippy: true, ...(quips.length && { quips }), ...wrote });
  }
  // Said in his own voice, as any answer is (#926); past the cap, read.
  const spoken = privateParts(text).length ? null : await speakRoom(text, today.sound, deps.eleven, deps.ledger, deps.desk.now, deps.fetcher);
  return json({ lines: [{ by: "kernel", text }], skippy: true, ...(spoken && { audio: Buffer.from(spoken).toString("base64") }), ...wrote });
}

/**
 * A room's own answer read aloud (#638): `{ room, speak }`, the line a room's intent handler gave in the browser. The
 * same voice and cap as any answer; a line that looks private comes back unspoken.
 */
async function speakOnly(voice: RoomVoice, say: string, deps: RoomRouteDeps): Promise<Response> {
  if (!say) return json({ error: "bad-request" }, 400);
  if (say.length > ROOM_SAY_MAX) return json({ error: "too-long" }, 400);
  deps.log(`room voice: ${voice.room} spoken`);
  if (privateParts(say).length) return json({ say, kind: "spoken" });
  const spoken = await speakRoom(say, voice.sound, deps.eleven, deps.ledger, deps.desk.now, deps.fetcher);
  return json({
    say,
    kind: "spoken",
    ...(spoken && { audio: Buffer.from(spoken).toString("base64") }),
  });
}

/**
 * A Rotunda caption read aloud (#755): `{ room: "today", speak, as }`, `as` the member's seat ("kernel" is the chair).
 * From the cache when it has been said before; else made once under the cap and the Rotunda's share. A line that looks
 * private is never sent.
 */
async function speakAs(as: unknown, say: string, deps: RoomRouteDeps): Promise<Response> {
  if (!castVoiceOf(as)) return json({ error: "bad-request" }, 400);
  if (!say) return json({ error: "bad-request" }, 400);
  if (say.length > ROTUNDA_SAY_MAX) return json({ error: "too-long" }, 400);
  if (privateParts(say).length) return json({ say, kind: "spoken" });
  const got = await speakCast(as as string, say, { blob: deps.blob, eleven: deps.eleven, ledger: deps.ledger, now: deps.desk.now, fetcher: deps.fetcher });
  return json({ say, kind: "spoken", ...(got && { audio: Buffer.from(got.audio).toString("base64"), cached: got.cached }) });
}

/** The rooms with a voice, for the contract test and the docs. */
export const VOICE_ROOMS = Object.keys(ROOM_VOICES);

/* ── The handler Azure registers ── */

export const route = {
  POST: (request: Request) => roomVoicePost(request, liveDeps()),
};
