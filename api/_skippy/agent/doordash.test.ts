/**
 * Skippy's DoorDash cart in the agent (#1207). Nikita, 2026-11-18 03:59Z, typed in the Desk's chat: "add the empanadas
 * from the usual spot"; Skippy said "yeah, we'll do that on DoorDash" and nothing reached the cart. The quick pass read
 * his usuals, its last round may not call a tool, and it answered with a promise no tool kept. Every store, item and
 * total here is made up.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { SKIPPY_PROMPT } from "../prompt.ts";
import type { DoorDashTools, TurnWho } from "../../_haven/doordash/voice.ts";
import { claimsDoorDash } from "../../_haven/doordash/voice.ts";
import { AGENT_RULES, FAST_MODEL, FAST_RULES, TALK_MODEL, runAgent, type CallModel } from "./loop.ts";
import { MemoryMemory } from "./memory.ts";
import { MemoryPending } from "./pending.ts";
import { ALL_TOOLS, WORDS_RUN, apiTools, callTool, type ToolHost } from "./tools.ts";
import { spokenAdd } from "./words.ts";

const NOW = Date.parse("2026-11-18T04:00:00Z");
type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
const usage = { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const msg = (content: unknown[], stop: string, model = TALK_MODEL) => ({ id: "m", type: "message", role: "assistant", model, content, stop_reason: stop, usage }) as unknown as Anthropic.Beta.Messages.BetaMessage;
const fastJson = (reply: string, deeper: string) => msg([{ type: "text", text: JSON.stringify({ reply, actions: [], room: "haven", needs: "none", deeper }) }], "end_turn", FAST_MODEL);
const answer = (reply: string) => msg([{ type: "text", text: JSON.stringify({ reply, actions: [], room: "haven", needs: "none" }) }], "end_turn");

function script(steps: ((p: Params) => Anthropic.Beta.Messages.BetaMessage)[]): { call: CallModel; calls: Params[] } {
  const calls: Params[] = [];
  return {
    calls,
    call: async (p) => {
      calls.push(structuredClone(p));
      const step = steps.shift();
      if (!step) throw new Error("no more steps");
      return { ...step(p), model: p.model };
    },
  };
}

/** A DoorDash that records what reached the cart. */
function fakeDoorDash() {
  const cart: string[] = [];
  const dd: DoorDashTools = {
    search: async () => "Stores near home: La Esquina.",
    usuals: async () => "His usuals: La Esquina (last time: 3 Beef Empanadas), ordered 6 times.",
    status: async () => "No DoorDash order placed from the Desk in the last day and a half.",
    recent: async () => "Recent DoorDash orders: La Esquina.",
    cart: async () => (cart.length ? `His DoorDash cart in the Kitchen: ${cart.join(", ")} at La Esquina.` : "His DoorDash cart is empty."),
    addToCart: async (input, who) => {
      cart.push(...(input.items ?? ["his last order"]));
      const text = `Added ${(input.items ?? []).join(", ")} from La Esquina to your DoorDash cart: $14.50 so far. It's in your DoorDash cart in the Kitchen; nothing is ordered.`;
      if (who) who.outcome = text;
      return { ok: true, text, did: "Added to the DoorDash cart" };
    },
    prepare: async () => ({ ok: false, text: "not in this test" }),
    confirm: async () => ({ ok: false, text: "not in this test" }),
    turnStarted: async () => undefined,
    heard: async () => undefined,
  };
  return { dd, cart };
}

function host(dd: DoorDashTools, who?: TurnWho): ToolHost {
  return { read: async () => "", memory: new MemoryMemory(), skipTerms: [], now: NOW, doordash: dd, ...(who && { who }) } as unknown as ToolHost;
}

const SAID = "add the empanadas from the usual spot";

describe("Skippy's DoorDash cart (#1207)", () => {
  it("never lets the quick pass answer a DoorDash add with a promise no tool kept: it hands up and the add runs", async () => {
    const { dd, cart } = fakeDoorDash();
    const who: TurnWho = { principal: "passkey-1", channel: "desk", turn: "t1", said: SAID };
    const s = script([
      // The quick pass reads his usuals, then (its last round may not call a tool) promises the add.
      () => msg([{ type: "tool_use", id: "u1", name: "doordash_usuals", input: {} }], "tool_use", FAST_MODEL),
      () => fastJson("Yeah, we'll do that on DoorDash.", "no"),
      // The deeper self does it with the tool.
      () => msg([{ type: "tool_use", id: "a1", name: "doordash_add_to_cart", input: { items: ["Beef Empanadas"] } }], "tool_use"),
      () => answer("Done, monkey."),
    ]);
    const r = await runAgent(s.call, SKIPPY_PROMPT, `<message>\n${SAID}\n</message>`, { surface: "desk", message: SAID, core: "", host: host(dd, who), pending: new MemoryPending() });
    expect((r.answer as { reply?: string } | null)?.reply).not.toBe("Yeah, we'll do that on DoorDash.");
    expect(s.calls.map((c) => c.model)).toEqual([FAST_MODEL, FAST_MODEL, TALK_MODEL, TALK_MODEL]);
    expect(cart).toEqual(["Beef Empanadas"]);
    expect(r.wrote).toContain("doordash_add_to_cart");
    expect(who.outcome).toMatch(/^Added Beef Empanadas from La Esquina to your DoorDash cart: \$14\.50 so far/);
  });

  it("names DoorDash in the quick pass's Desk lane, and the usual spot as his DoorDash usual, never the world", () => {
    expect(FAST_RULES).toMatch(/DoorDash/);
    expect(FAST_RULES).toMatch(/usual spot/);
    expect(AGENT_RULES).toMatch(/doordash_add_to_cart/);
  });

  it("has an add-to-cart tool that runs on his own words to add, and a cart read", async () => {
    const add = ALL_TOOLS.find((t) => t.name === "doordash_add_to_cart");
    expect(add).toMatchObject({ effect: "write", confirm: true });
    expect(WORDS_RUN.has("doordash_add_to_cart")).toBe(true);
    expect(ALL_TOOLS.find((t) => t.name === "doordash_cart")).toMatchObject({ effect: "read" });
    expect(apiTools(ALL_TOOLS).find((t) => t.name === "doordash_add_to_cart")!.description).toMatch(/never prices or places/i);

    for (const yes of [SAID, "Add 2 beef empanadas from La Esquina", "get me my usual from the empanada place", "order the empanadas from my usual spot", "put tacos in my DoorDash cart", "can you add the empanadas from the usual spot?"]) expect(spokenAdd(yes), yes).toBe(true);
    for (const no of ["what's in my cart?", "what did I get last time from the usual spot?", "is the empanada place open?", "how much are empanadas there?", "don't add anything"]) expect(spokenAdd(no), no).toBe(false);

    // Typed, his words asked: it runs at once. A question: the Yes card, so nothing is added unasked.
    const { dd, cart } = fakeDoorDash();
    const ran = await callTool("doordash_add_to_cart", { items: ["Beef Empanadas"] }, host(dd), { pending: new MemoryPending(), surface: "desk", said: SAID });
    expect(ran).toMatchObject({ ok: true, did: "Added to the DoorDash cart" });
    const asked = await callTool("doordash_add_to_cart", { items: ["Churros"] }, host(dd), { pending: new MemoryPending(), surface: "desk", said: "what's good at the usual spot?" });
    expect("confirm" in asked && asked.confirm).toBeTruthy();
    // Said out loud as a question: nothing runs.
    const spoken = await callTool("doordash_add_to_cart", { items: ["Churros"] }, host(dd), { pending: new MemoryPending(), surface: "spoken", said: "what's good at the usual spot?" });
    expect(spoken.ok).toBe(false);
    expect(cart).toEqual(["Beef Empanadas"]);
  });

  it("knows a reply that claims a DoorDash add or order from one that doesn't", () => {
    for (const claim of ["Yeah, we'll do that on DoorDash.", "Added the empanadas to your DoorDash cart.", "I'll add those on DoorDash now.", "On it: empanadas from La Esquina, it's in your cart.", "I've placed your DoorDash order.", "Your empanadas are in your DoorDash cart."]) expect(claimsDoorDash(claim), claim).toBe(true);
    for (const plain of ["Your DoorDash order is nearly there; DoorDash says 10 minutes.", "Your usual on DoorDash is La Esquina: three beef empanadas last time.", "La Esquina is open on DoorDash, about 30 minutes.", "Tap Yes and I'll add the picks to your King Soopers cart.", "Garlic's on the Kitchen list."]) expect(claimsDoorDash(plain), plain).toBe(false);
  });
});
