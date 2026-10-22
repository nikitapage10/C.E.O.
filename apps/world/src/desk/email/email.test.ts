import { describe, expect, it } from "vitest";
import { emptyEmailStatus } from "../../../../../api/_email/status.ts";
import { emailLine, linkOf, readItem, readView } from "./email.ts";

const NOW = Date.UTC(2026, 9, 22, 18);
const live = { ...emptyEmailStatus(NOW, "listening"), gmail: "connected" as const, needsYou: 2, fyi: 3, lastCheck: NOW };

describe("the email agent on the Desk", () => {
  it("says where it stands in a few words, never a figure from a mail", () => {
    expect(emailLine("off", null)).toBe("Email: on the Azure copy");
    expect(emailLine("live", emptyEmailStatus(NOW))).toBe("Email: waiting for its keys");
    expect(emailLine("live", { ...emptyEmailStatus(NOW, "listening") })).toBe("Email: waiting for Gmail");
    expect(emailLine("live", { ...live, agent: "paused" })).toBe("Email agent paused: monthly cap reached");
    expect(emailLine("live", live)).toBe("2 emails need you");
    expect(emailLine("live", { ...live, needsYou: 1 })).toBe("1 email needs you");
  });

  it("lights the Gmail pipe from the counts", () => {
    expect(linkOf(null)).toBe("off");
    expect(linkOf(live)).toBe("ok");
    expect(linkOf({ ...live, agent: "paused" })).toBe("slow");
    expect(linkOf({ ...live, gmail: "refused" })).toBe("down");
  });

  it("reads the private view defensively", () => {
    const item = { id: "18a1b2c3d4e5f601", at: NOW, from: "A sender", subject: "A subject", kind: "needs-you", summary: "s", action: "a", advice: "x", draft: "d", done: false };
    expect(readItem(item)).toEqual(item);
    expect(readItem({ ...item, id: "javascript:alert(1)" })).toBeNull();
    expect(readItem({ ...item, kind: "urgent" })).toBeNull();
    const view = readView({ ok: true, status: live, canConnect: true, items: [item, { bad: true }], spend: { usd: 0.12, budget: 10 } });
    expect(view?.items).toHaveLength(1);
    expect(readView({ ok: true, status: { ...live, subject: "x" }, canConnect: true, items: [], spend: { usd: 0, budget: 10 } })).toBeNull();
  });
});
