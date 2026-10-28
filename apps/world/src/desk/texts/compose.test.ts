import { afterEach, describe, expect, it, vi } from "vitest";
import { SAID_WINDOW_MS, phaseOf, saidSend, sendWords, spokenMask, useCompose, type Compose } from "./compose.ts";
import { useTexts, type TextCard, type TextRequestView } from "./texts.ts";

/**
 * The text card on the Desk (#536): nothing sends without a tap on that exact card, or Nikita's own spoken "send" for
 * the very text Skippy was handed to read aloud. Every name and text here is made up.
 */

const NOW = Date.parse("2026-10-28T15:00:00Z");
const CARD = "aaaabbbbccccdddd";
const card = (over: Partial<TextCard> = {}): TextCard => ({ id: CARD, state: "ready", name: "Riley Test", mask: "ending 0123", channel: "iMessage", draft: { text: "Running 10 late, sorry!", at: NOW - 1_000 }, choices: [], at: NOW - 1_000, ...over });
const base = (over: Partial<Compose> = {}): Compose => ({ key: "k1", via: "talk", who: "Riley", gist: "running late", card: CARD, phase: "drafting", note: "", text: "", draftAt: 0, version: 0, readVersion: -1, readAt: 0, saidVersion: -1, saidAt: 0, rid: null, since: NOW, ...over });

/** The store with one card on screen, the site's view as given, and fetch recorded. */
function onScreen(over: Partial<Compose> = {}, unlocked = true) {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  const posts: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") posts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ ok: true, rid: "f".repeat(24), until: NOW + 600_000 }), { status: 200, headers: { "content-type": "application/json" } });
  });
  useTexts.setState({ view: { ready: true, paired: true, pairedAt: NOW, lastSeen: NOW, unlockedUntil: unlocked ? Date.now() + 3_600_000 : null, items: [], cards: [card()], textsAt: NOW, requests: [], spend: { usd: 0, budget: 10 } }, refresh: async () => undefined });
  useCompose.setState({ items: { k1: base(over) } });
  useCompose.getState().sync();
  return { posts, c: () => useCompose.getState().items.k1! };
}

/** Moves the clock on (Date only: fetch and timers stay real), so a "send" comes after the read. */
const later = (ms = 1_000) => vi.setSystemTime(Date.now() + ms);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useCompose.setState({ items: {} });
});

describe("a spoken send", () => {
  it("is only a whole-line yes: never a question, a redirect, a keep, or a no", () => {
    for (const yes of ["Send", "send it", "Yes, send it.", "go ahead and send", "ok send", "Okay, send it now", "send it please!", "Yeah send it"]) expect(saidSend(yes), yes).toBe(true);
    for (const no of [
      "don't send it", "do not send", "no, wait, change it before you send", "send it later", "hold on", "cancel", "yes", "sounds good", "stop, don't send",
      "Did you send it?", "Shall I send it?", "Send it?", "Who will you send it to?", "Send it to Sam instead", "Can you send it to my brother", "I'll send it myself", "I’ll send it myself",
      "send it to Jordan", "send it and then call her",
    ]) expect(saidSend(no), no).toBe(false);
  });

  it("reads a mask aloud without ever holding more than it shows", () => {
    expect(spokenMask("ending 0123")).toBe("the number ending 0 1 2 3");
    expect(spokenMask("r•••@e•••.com")).toBe("the address starting with r at e, dot com");
    expect(spokenMask(null)).toBe("");
  });
});

describe("the card", () => {
  it("takes Blasto's text and its version from the site", () => {
    const { c } = onScreen();
    expect(c()).toMatchObject({ phase: "ready", text: "Running 10 late, sorry!", draftAt: NOW - 1_000, version: 1 });
  });

  it("sends on a tap, bound to the card and the text on screen", async () => {
    const { posts } = onScreen({ via: "chat" });
    expect(await useCompose.getState().send("k1", { tapped: true })).toBe("sending");
    expect(posts).toEqual([{ action: "send", thread: CARD, draftAt: NOW - 1_000, text: "Running 10 late, sorry!" }]);
  });

  it("on a call, never sends because the agent asked: only after Nikita said send for the version he was read", async () => {
    const { posts, c } = onScreen();
    const store = useCompose.getState();
    expect(await store.send("k1", { said: true })).toBe("unconfirmed");
    store.heard("send it");
    expect(await store.send("k1", { said: true })).toBe("unconfirmed");
    store.readOut("k1");
    later();
    store.heard("hmm, sounds good");
    store.heard("Did you send it?");
    store.heard("Send it to Sam instead");
    expect(await store.send("k1", { said: true })).toBe("unconfirmed");
    store.heard("yes, send it");
    expect(c().saidVersion).toBe(c().version);
    expect(await store.send("k1", { said: true })).toBe("sending");
    expect(posts).toHaveLength(1);
  });

  it("a spoken send counts only after the read, within two minutes of it, and doesn't keep", async () => {
    const { posts } = onScreen();
    const store = useCompose.getState();
    store.readOut("k1");
    store.heard("send", Date.now() - 5_000); // a line from before the read
    expect(await store.send("k1", { said: true })).toBe("unconfirmed");
    later(SAID_WINDOW_MS + 1_000);
    store.heard("send"); // too long after the read
    expect(await store.send("k1", { said: true })).toBe("unconfirmed");
    store.readOut("k1");
    later();
    store.heard("send");
    later(SAID_WINDOW_MS + 1_000); // said in time, but the send comes too late
    expect(await store.send("k1", { said: true })).toBe("unconfirmed");
    expect(posts).toEqual([]);
  });

  it("marks only the card the call is on", async () => {
    const { c } = onScreen();
    useCompose.setState((s) => ({ items: { ...s.items, k0: { ...s.items.k1!, key: "k0", since: NOW - 60_000 } } }));
    const store = useCompose.getState();
    store.readOut("k0");
    store.readOut("k1");
    later();
    store.heard("send it");
    expect(c().saidVersion).toBe(c().version);
    expect(useCompose.getState().items.k0!.saidVersion).toBe(-1);
  });

  it("an edit refreshes the card and asks again: a send said for the old text doesn't carry over", async () => {
    const { posts, c } = onScreen();
    const store = useCompose.getState();
    store.readOut("k1");
    later();
    store.heard("send");
    store.edit("k1", "Running 15 late, sorry!");
    expect(c()).toMatchObject({ text: "Running 15 late, sorry!", version: 2 });
    expect(await store.send("k1", { said: true })).toBe("unconfirmed");
    store.readOut("k1");
    later();
    store.heard("send");
    expect(await store.send("k1", { said: true })).toBe("sending");
    expect(posts[0]).toMatchObject({ text: "Running 15 late, sorry!" });
  });

  it("needs this device's unlock, tapped or said", async () => {
    const { posts } = onScreen({ via: "chat" }, false);
    expect(await useCompose.getState().send("k1", { tapped: true })).toBe("locked");
    expect(posts).toEqual([]);
  });

  it("sends nothing for a card that isn't ready", async () => {
    for (const c of [card({ state: "choices", mask: null, draft: null, choices: [{ pick: "0a0b0c0d", name: "Riley Test", mask: "ending 0123", channel: "SMS" }] }), card({ state: "none", mask: null, draft: null }), card({ state: "off", mask: null, draft: null })]) {
      const { posts } = onScreen({ via: "chat" });
      useTexts.setState((s) => ({ view: { ...s.view!, cards: [c] } }));
      useCompose.setState({ items: { k1: base({ via: "chat" }) } });
      useCompose.getState().sync();
      expect(await useCompose.getState().send("k1", { tapped: true }), c.state).toBe("not-ready");
      expect(posts).toEqual([]);
    }
  });
});

describe("what the card says", () => {
  const req = (state: TextRequestView["state"]): TextRequestView => ({ rid: "f".repeat(24), kind: "send", thread: CARD, text: "", created: NOW, until: NOW + 600_000, state });
  it("follows its send request: on its way, sent, or not sent with Resend", () => {
    const c = base({ phase: "ready", rid: "f".repeat(24) });
    expect(phaseOf(c, card(), req("waiting"), NOW)).toBe("sending");
    expect(phaseOf(c, card(), req("sent"), NOW)).toBe("sent");
    expect(phaseOf(c, card(), req("expired"), NOW)).toBe("unsent");
    expect(sendWords(req("expired"))).toEqual({ text: "Not sent, Mac was offline.", resend: true });
    expect(sendWords(req("failed"))!.resend).toBe(true);
    expect(sendWords(req("refused"))!.resend).toBe(false);
  });

  it("says the Mac didn't answer when no card comes back in time", () => {
    expect(phaseOf(base(), undefined, undefined, NOW + 60_000)).toBe("drafting");
    expect(phaseOf(base(), undefined, undefined, NOW + 4 * 60_000)).toBe("error");
  });
});
