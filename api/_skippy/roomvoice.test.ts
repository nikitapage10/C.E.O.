import { describe, expect, it } from "vitest";
import { BlobPreconditionError, type BlobBackend } from "../_blob.ts";
import { MemoryAuthStore } from "../_desk/store.ts";
import { signedInCookie } from "../_desk/testing.ts";
import type { Home } from "../_haven/devices/home.ts";
import { KitchenList } from "../_haven/list.ts";
import { PhoneTodos } from "../_haven/todos.ts";
import { MemoryStoryStore } from "../_world/story.ts";
import { roomAnswer, type Ask, type ChatDeps } from "../skippy.ts";
import { MemoryChatLedger } from "./budget.ts";
import { deskContext } from "./context.ts";
import { MemoryRoomLog, ROOM_SUBMINDS } from "./log.ts";
import { ROOM_SAYS, roomVoicePost, type RoomRouteDeps } from "./roomroute.ts";
import { CLIP_MAX_BYTES, ROOM_STT_MODEL, ROOM_TTS_MODEL, ROOM_VOICES, roomRules, speakRoom, spokenRoom, transcribeRoom } from "./roomvoice.ts";
import { DESK_SUBMINDS, SUBMINDS } from "../../packages/simulator/src/subminds.ts";
import { roomMicOf, voiceTargetOf } from "../../packages/engine/src/voice.ts";
import { SKIPPY_SOUND } from "./voicecrew.ts";
import { ROOM_ROUTES } from "../../apps/world/src/route.ts";

/** Talking to the rooms (#638): the voices, the rules, the spoken cut, ElevenLabs under its cap, and the route. Every key and line is made up. */

const DESK = "a test desk key, not a real one";
const ORIGIN = "https://ceo.test";
const NOW = Date.parse("2026-11-04T18:00:00Z");
const eleven = {
  key: "test-eleven",
  voice: "onwK4e9ZLuTAKqWW03F9",
  budget: 10,
};

function memoryBlob(): BlobBackend {
  const files = new Map<string, Uint8Array>();
  const tags = new Map<string, number>();
  let n = 1;
  return {
    kind: "azureblob",
    get: async (path) =>
      files.has(path)
        ? {
            stream: new Response(files.get(path)!.slice()).body!,
            etag: String(tags.get(path)),
            contentType: "application/octet-stream",
          }
        : null,
    etag: async (path) => (files.has(path) ? String(tags.get(path)) : null),
    put: async (path, body, opts) => {
      if (opts.ifMatch && opts.ifMatch !== String(tags.get(path))) throw new BlobPreconditionError("changed");
      if (!opts.ifMatch && opts.allowOverwrite === false && files.has(path)) throw new BlobPreconditionError("exists");
      files.set(path, typeof body === "string" ? new TextEncoder().encode(body) : body instanceof Uint8Array ? body : new Uint8Array(body));
      tags.set(path, n++);
      return { pathname: path };
    },
    del: async (path) => void files.delete(path),
  };
}

/** A fake ElevenLabs: MP3 bytes for speech, words for a clip; every call kept. */
function fakeEleven(words = "how is the furnace") {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("speech-to-text")) return Response.json({ text: words });
    return new Response(new Uint8Array(4_000).fill(7), {
      headers: { "Content-Type": "audio/mpeg" },
    });
  }) as typeof fetch;
  return { calls, fetcher };
}

describe("the rooms' voices (#638)", () => {
  it("covers every Desk page with a lead, with the same one as the mic and hands-free: Skippy himself on Today", () => {
    const rooms = [...ROOM_ROUTES, "foundry", "relay", "haven"];
    for (const room of rooms) expect(ROOM_VOICES[room]?.submind, room).toBe(roomMicOf(room)?.submind);
    for (const room of [...rooms, "today"]) expect(ROOM_VOICES[room]?.submind, room).toBe(voiceTargetOf(room)?.submind);
    expect(Object.keys(ROOM_VOICES).sort()).toEqual([...new Set([...rooms, "today"])].sort());
    expect(roomMicOf("today")).toBeNull();
    expect(ROOM_VOICES.today).toMatchObject({
      submind: "skippy",
      log: null,
      sound: SKIPPY_SOUND,
    });
  });

  it("on Today, Skippy answers as himself, still short and never the plumbing", () => {
    const r = roomRules(ROOM_VOICES.today!);
    expect(r).toContain("as yourself");
    expect(r).not.toContain("submind for");
    expect(r).toContain("Never say crew, team, thread, Builder or Kernel");
  });

  it("names each submind as the one list does", () => {
    for (const v of Object.values(ROOM_VOICES)) {
      if (v.submind === "skippy") continue;
      const s = [...SUBMINDS, ...DESK_SUBMINDS].find((m) => m.id === v.submind)!;
      expect(v.name, v.room).toBe(s.name);
      if (v.log) expect(ROOM_SUBMINDS[v.log].id).toBe(v.submind);
    }
  });

  it("the Haven's Steward is a Desk-only submind, active, in warm amber", () => {
    expect(DESK_SUBMINDS.find((m) => m.id === "hearth")).toEqual({
      id: "hearth",
      name: "The Steward",
      room: "haven",
      colour: "#f2a65a",
      job: "Steward",
      active: true,
    });
    expect(ROOM_SUBMINDS.haven).toEqual({
      id: "hearth",
      name: "The Steward",
      active: true,
    });
  });

  it("tells the chat: answer as the submind, no greeting, short, never the plumbing", () => {
    const r = roomRules(ROOM_VOICES.haven!);
    expect(r).toContain("The Steward");
    expect(r).toMatch(/No greeting, no sign-on, no introduction/);
    expect(r).toMatch(/One or two short spoken sentences/);
    expect(r).toMatch(/Never say crew, team, thread, Builder or Kernel/);
    expect(r).toContain('"room" to "haven"');
  });

  it("cuts an answer to two spoken sentences and drops any that name the plumbing", () => {
    expect(spokenRoom("The cat ate at six. The vacuum is docked. The litter box is clean.", false)).toBe("The cat ate at six. The vacuum is docked.");
    expect(spokenRoom("I asked the crew. The cat ate at six.", false)).toBe("The cat ate at six.");
    expect(spokenRoom("The deeper me will dig. Handed to Skippy's thread.", true)).toBe("The deeper me will dig. I'll put the rest on the Desk.");
  });
});

describe("ElevenLabs on the room mic (#638)", () => {
  it("speaks with Flash in the one voice, bent the submind's way, and counts it against the one cap", async () => {
    const ledger = new MemoryStoryStore();
    const { calls, fetcher } = fakeEleven();
    const mp3 = await speakRoom("The cat ate at six.", ROOM_VOICES.haven!.sound, eleven, ledger, NOW, fetcher);
    expect(mp3?.length).toBe(4_000);
    expect(calls[0]!.url).toContain(`/text-to-speech/${eleven.voice}?output_format=mp3_`);
    const body = JSON.parse(String(calls[0]!.init?.body)) as {
      model_id: string;
      voice_settings: { speed: number };
    };
    expect(body.model_id).toBe(ROOM_TTS_MODEL);
    expect(body.voice_settings.speed).toBe(ROOM_VOICES.haven!.sound.speed);
    expect(await ledger.loadSpend()).not.toEqual({});
  });

  it("says nothing past the cap, or without a key", async () => {
    const ledger = new MemoryStoryStore();
    await ledger.addSpend(NOW, { elevenUsd: 10 });
    const { calls, fetcher } = fakeEleven();
    expect(await speakRoom("Hello.", ROOM_VOICES.green!.sound, eleven, ledger, NOW, fetcher)).toBeNull();
    expect(await speakRoom("Hello.", ROOM_VOICES.green!.sound, null, ledger, NOW, fetcher)).toBeNull();
    expect(calls).toEqual([]);
  });

  it("transcribes a short clip with Scribe, and refuses a big one or the wrong type", async () => {
    const ledger = new MemoryStoryStore();
    const { calls, fetcher } = fakeEleven("feed the cat");
    expect(await transcribeRoom(new Uint8Array(2_000), "audio/webm;codecs=opus", eleven, ledger, NOW, fetcher)).toBe("feed the cat");
    expect((calls[0]!.init?.body as FormData).get("model_id")).toBe(ROOM_STT_MODEL);
    expect(await transcribeRoom(new Uint8Array(CLIP_MAX_BYTES + 1), "audio/webm", eleven, ledger, NOW, fetcher)).toBeNull();
    expect(await transcribeRoom(new Uint8Array(2_000), "text/plain", eleven, ledger, NOW, fetcher)).toBeNull();
    expect(calls).toHaveLength(1);
  });
});

describe("Desk Skippy's chat as the room's submind (#638)", () => {
  async function chatDeps(answer: unknown) {
    const store = new MemoryAuthStore();
    const log = new MemoryRoomLog();
    const asked: string[] = [];
    const ask: Ask = async (system) => (
      asked.push(system),
      {
        answer,
        usage: { input_tokens: 10, output_tokens: 5 },
        model: "claude-sonnet-5-5",
      }
    );
    const deps: ChatDeps = {
      deskKey: DESK,
      store,
      ledger: new MemoryChatLedger(),
      ask,
      log,
      world: async () => null,
      desk: async () => deskContext([], [], null, null),
      now: NOW,
      env: {},
    };
    return { deps, log, asked };
  }

  it("answers in the room's rules and keeps the turn under the room, by its submind, for the Council", async () => {
    const { deps, log, asked } = await chatDeps({
      reply: "Nothing's leaking. Yet.",
      actions: [],
      room: "none",
      needs: "none",
    });
    const v = ROOM_VOICES.boiler!;
    const turn = await roomAnswer("anything broken", [], "pk1", { rules: roomRules(v), log: "boiler", by: "soot" }, deps);
    expect(turn).toEqual({
      reply: "Nothing's leaking. Yet.",
      handedOff: false,
    });
    expect(asked[0]).toContain("The Pessimist");
    const [kept] = await log.list("boiler", NOW);
    expect(kept).toMatchObject({
      via: "room",
      by: "soot",
      question: "anything broken",
      room: "boiler",
    });
  });

  it("points a hand-off to the submind at the page's own room", async () => {
    const { deps, log } = await chatDeps({
      reply: "Let me dig.",
      actions: [],
      room: "green",
      needs: "submind",
    });
    const turn = await roomAnswer("what's on the list", [], "pk1", { rules: roomRules(ROOM_VOICES.haven!), log: "haven", by: "hearth" }, deps);
    expect(turn.handedOff).toBe(true);
    const [kept] = await log.list("haven", NOW);
    expect(kept).toMatchObject({ needs: "hearth", via: "room" });
    expect(await log.list("green", NOW)).toEqual([]);
  });

  it("holds back private-looking words before the model sees them", async () => {
    const { deps, asked } = await chatDeps({
      reply: "x",
      actions: [],
      room: "none",
    });
    expect((await roomAnswer("my card is 4111 1111 1111 1111", [], "pk1", { rules: "", log: null, by: null }, deps)).error).toBe("private");
    expect(asked).toEqual([]);
  });
});

describe("POST /api/skippy-room (#638)", () => {
  function deps(over: Partial<RoomRouteDeps> = {}, store = new MemoryAuthStore()) {
    const lines: string[] = [];
    const told: { text: string; room: string }[] = [];
    const acted: unknown[] = [];
    const { calls, fetcher } = fakeEleven();
    const blob = memoryBlob();
    const d: RoomRouteDeps = {
      desk: { deskKey: DESK, store, now: NOW },
      blob,
      eleven,
      ledger: new MemoryStoryStore(),
      skippy: async (text, _h, _p, room) => (
        told.push({ text, room: room.log ?? "" }),
        {
          reply: "The furnace is fine, monkey. Two builds running.",
          handedOff: false,
        }
      ),
      todos: (b) => new PhoneTodos(b),
      devices: () =>
        ({
          act: async (r: unknown) => (acted.push(r), { ok: true, say: "Fed the cat one portion." }),
        }) as unknown as Home,
      fetcher,
      log: (l) => lines.push(l),
      ...over,
    };
    return { d, lines, told, acted, calls, blob, store };
  }
  const post = (body: unknown, cookie: string, url = `${ORIGIN}/api/skippy-room`, type = "application/json") =>
    new Request(url, {
      method: "POST",
      headers: { "Content-Type": type, ...(cookie && { Cookie: cookie }) },
      body: typeof body === "string" || body instanceof Uint8Array ? (body as BodyInit) : JSON.stringify(body),
    });

  it("answers only a signed-in Desk", async () => {
    const { d, told } = deps();
    expect((await roomVoicePost(post({ room: "foundry", text: "how's the furnace" }, ""), d)).status).toBe(401);
    expect(told).toEqual([]);
  });

  it("sends the words to the room's submind and answers with the line and its audio, logging none of the words", async () => {
    const { d, told, lines, calls, store } = deps();
    const cookie = await signedInCookie(DESK, NOW, store);
    const res = await roomVoicePost(
      post(
        {
          room: "foundry",
          text: "how's the furnace",
          history: [{ who: "nikita", text: "hi" }],
        },
        cookie,
      ),
      d,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      say: string;
      kind: string;
      audio?: string;
    };
    expect(body.say).toBe("The furnace is fine, monkey. Two builds running.");
    expect(body.kind).toBe("skippy");
    expect(body.audio && Buffer.from(body.audio, "base64").length).toBe(4_000);
    expect(told).toEqual([{ text: "how's the furnace", room: "foundry" }]);
    expect(calls.some((c) => c.url.includes("text-to-speech"))).toBe(true);
    expect(lines).toEqual(["room voice: foundry skippy"]);
    expect(lines.join(" ")).not.toContain("furnace");
  });

  it("on Today, hands-free goes to Skippy himself, kept under whatever room he tags", async () => {
    const { d, store } = deps();
    let got: { rules: string; log: unknown; by: unknown } | null = null;
    d.skippy = async (_t, _h, _p, room) => ((got = room), { reply: "Three things need you.", handedOff: false });
    const cookie = await signedInCookie(DESK, NOW, store);
    const res = await roomVoicePost(post({ room: "today", text: "what needs me" }, cookie), d);
    expect(res.status).toBe(200);
    expect(got).toMatchObject({ log: null, by: null });
    expect(got!.rules).toContain("as yourself");
  });

  it("reads a room's own answer aloud with no model call, and never a private-looking line", async () => {
    const { d, told, calls, lines, store } = deps();
    const cookie = await signedInCookie(DESK, NOW, store);
    const body = (await (await roomVoicePost(post({ room: "relay", speak: "Rule saved: newsletters skip the inbox." }, cookie), d)).json()) as {
      say: string;
      kind: string;
      audio?: string;
    };
    expect(body).toMatchObject({
      say: "Rule saved: newsletters skip the inbox.",
      kind: "spoken",
    });
    expect(body.audio).toBeTruthy();
    expect(told).toEqual([]);
    expect(lines).toEqual(["room voice: relay spoken"]);
    const n = calls.length;
    const held = (await (await roomVoicePost(post({ room: "relay", speak: "Card 4111 1111 1111 1111 is on file." }, cookie), d)).json()) as { audio?: string };
    expect(held.audio).toBeUndefined();
    expect(calls.length).toBe(n);
    expect((await roomVoicePost(post({ room: "relay", speak: "x".repeat(301) }, cookie), d)).status).toBe(400);
  });

  it("in the Haven, a device ask takes Hey Skippy's no-model fast path through the devices' rails", async () => {
    const { d, told, acted, store } = deps();
    const cookie = await signedInCookie(DESK, NOW, store);
    const body = (await (await roomVoicePost(post({ room: "haven", text: "feed the cat" }, cookie), d)).json()) as { say: string; kind: string };
    expect(body).toMatchObject({
      say: "Fed the cat one portion.",
      kind: "device",
    });
    expect(acted).toEqual([
      {
        action: "feeder.feed",
        rooms: undefined,
        via: "desk",
        said: "feed the cat",
      },
    ]);
    expect(told).toEqual([]);
  });

  it("in the Haven, shopping goes on the Kitchen list; elsewhere the same words go to the submind", async () => {
    const { d, told, blob, store } = deps();
    const cookie = await signedInCookie(DESK, NOW, store);
    const body = (await (await roomVoicePost(post({ room: "haven", text: "we need milk and eggs" }, cookie), d)).json()) as { kind: string };
    expect(body.kind).toBe("shopping");
    expect((await new KitchenList(blob).items(NOW)).map((i) => i.name)).toEqual(["milk", "eggs"]);
    await roomVoicePost(post({ room: "green", text: "add Tre Tucker" }, cookie), d);
    expect(told).toEqual([{ text: "add Tre Tucker", room: "green" }]);
  });

  it("refuses a room without a voice, nothing heard, and words that are too long", async () => {
    const { d, store } = deps();
    const cookie = await signedInCookie(DESK, NOW, store);
    expect((await roomVoicePost(post({ room: "lattice", text: "hi" }, cookie), d)).status).toBe(400);
    expect((await roomVoicePost(post({ room: "green", text: "  " }, cookie), d)).status).toBe(400);
    expect((await roomVoicePost(post({ room: "green", text: "x".repeat(301) }, cookie), d)).status).toBe(400);
    expect((await roomVoicePost(post("nope", cookie, undefined, "text/plain"), d)).status).toBe(415);
  });

  it("says why when the chat can't answer, with its status and no audio", async () => {
    const { d, store, calls } = deps({
      skippy: async () => ({ reply: "", handedOff: false, error: "slow-down" }),
    });
    const cookie = await signedInCookie(DESK, NOW, store);
    const res = await roomVoicePost(post({ room: "green", text: "who do I start" }, cookie), d);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      say: ROOM_SAYS["slow-down"],
      kind: "skippy",
    });
    expect(calls).toEqual([]);
  });

  it("takes a clip from a browser without speech recognition: Scribe writes the words, then the same path", async () => {
    const { d, told, calls, store } = deps();
    const cookie = await signedInCookie(DESK, NOW, store);
    const res = await roomVoicePost(post(new Uint8Array(3_000), cookie, `${ORIGIN}/api/skippy-room?room=foundry`, "audio/webm;codecs=opus"), d);
    expect(res.status).toBe(200);
    expect(told).toEqual([{ text: "how is the furnace", room: "foundry" }]);
    expect(calls[0]!.url).toContain("speech-to-text");
  });

  it("still answers in words when ElevenLabs is capped", async () => {
    const ledger = new MemoryStoryStore();
    await ledger.addSpend(NOW, { elevenUsd: 10 });
    const { d, store } = deps({ ledger });
    const cookie = await signedInCookie(DESK, NOW, store);
    const body = (await (await roomVoicePost(post({ room: "exchange", text: "how's my book" }, cookie), d)).json()) as { say: string; audio?: string };
    expect(body.say).toBeTruthy();
    expect(body.audio).toBeUndefined();
  });
});
