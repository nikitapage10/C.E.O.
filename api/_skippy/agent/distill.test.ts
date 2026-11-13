import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { MemoryChatLedger } from "../budget.ts";
import { DISTILL_MODEL, distill } from "./distill.ts";
import { MemoryMemory, coreBlock } from "./memory.ts";

const NOW = Date.parse("2026-11-13T11:00:00Z");
const reply = (body: unknown) => ({ content: [{ type: "text", text: JSON.stringify(body) }], usage: { input_tokens: 2000, output_tokens: 300 } }) as unknown as Anthropic.Message;

async function withTurns() {
  const memory = new MemoryMemory();
  await memory.setCore("Nikita lives near Denver.");
  await memory.journal({ at: "", via: "talk", q: "I'm thinking about moving into product management", a: "Bold, monkey." }, NOW - 3_600_000);
  await memory.journal({ at: "", via: "desk", q: "My trainer says I'm close to my goal", a: "Impressive." }, NOW - 1_800_000);
  return memory;
}

describe("Skippy learns from conversations (#1126)", () => {
  it("keeps new facts, a refreshed card and things to ask, refusing what memory never keeps", async () => {
    const memory = await withTurns();
    const ledger = new MemoryChatLedger();
    const seen: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const got = await distill({
      memory,
      ledger,
      spent: async () => 0,
      env: {},
      now: NOW,
      call: async (p) => {
        seen.push(p);
        return reply({
          facts: [
            { text: "Nikita is thinking about moving into product management.", topic: "work" },
            { text: "Nikita earns $200,000 a year.", topic: "money" },
          ],
          core: "Nikita lives near Denver and is eyeing product management.",
          curious: ["What draws you to product over audit?"],
        });
      },
    });
    expect(got).toMatchObject({ state: "learned", facts: 1, refused: 1, core: true, curious: 1 });
    expect(seen[0]!.model).toBe(DISTILL_MODEL);
    expect(JSON.stringify(seen[0]!.messages)).toContain("product management");
    const m = await memory.load();
    expect(m.facts.map((f) => [f.text, f.source])).toEqual([["Nikita is thinking about moving into product management.", "distiller"]]);
    expect(m.core).toMatch(/product management/);
    expect(coreBlock(m)).toMatch(/Things you'd like to learn about him.*product over audit/);
    expect(m.distilledAt).toBeTruthy();
    expect((await ledger.load()) as object).not.toEqual({});
  });

  it("calls no model on a night with nothing new, or when Skippy's month is spent", async () => {
    const memory = await withTurns();
    let calls = 0;
    const call = async () => {
      calls++;
      return reply({ facts: [], core: "", curious: [] });
    };
    const base = { memory, ledger: new MemoryChatLedger(), env: {}, now: NOW, call };
    expect(await distill({ ...base, spent: async () => 1_000 })).toEqual({ state: "capped" });
    expect(await distill({ ...base, spent: async () => 0 })).toMatchObject({ state: "learned", facts: 0, core: false });
    expect(await distill({ ...base, spent: async () => 0 })).toEqual({ state: "nothing-new" });
    expect(calls).toBe(1);
  });
});
