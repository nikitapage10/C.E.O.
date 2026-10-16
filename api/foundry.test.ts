import { describe, expect, it } from "vitest";
import { GET, MAX_QUESTIONS, autoEligible, riskLine, stoppedLabels, undoLabels, answerBlock, answeredRounds, questionOf, readShape, shapeInput, shapedBody, shapedLabels, shapedLine, tidyQuestion } from "./foundry.ts";
import { readBody } from "../apps/world/src/foundry.ts";

const card = { title: "Idea: Ask first", pitch: "Ask before queuing.", size: "medium", short: "Asking first", builder: "Rusty", model: "Sonnet" } as const;

describe("readShape (the decision output)", () => {
  it("reads a card with no question: most ideas need none", () => {
    const shape = readShape({ ...card });
    expect(shape).toMatchObject({ title: "Idea: Ask first", builder: "Rusty", model: "Sonnet" });
    expect(shape).not.toHaveProperty("question");
  });
  it("keeps a question, one line and trimmed", () => {
    expect(readShape({ ...card, question: "  Which page\n should it go on?  " })?.question).toBe("Which page should it go on?");
  });
  it("ignores an empty or non-string question", () => {
    expect(readShape({ ...card, question: "   " })).not.toHaveProperty("question");
    expect(readShape({ ...card, question: 7 })).not.toHaveProperty("question");
  });
  it("drops the question when asking is no longer allowed", () => {
    expect(readShape({ ...card, question: "Again?" }, false)).not.toHaveProperty("question");
  });
  it("is null when the answer isn't a card", () => {
    expect(readShape(null)).toBeNull();
    expect(readShape({ pitch: "x" })).toBeNull();
  });
  it("caps a long question", () => {
    expect(tidyQuestion("x".repeat(400))).toHaveLength(240);
  });
});

describe("the issue body and labels", () => {
  const asked = readShape({ ...card, question: "Should it also work on the phone?" })!;
  const ready = readShape({ ...card })!;

  it("writes a Question line the Desk can read back, and credits Rivet", () => {
    const body = shapedBody(asked, "ask first");
    expect(body).toContain("**Question:** Should it also work on the phone?");
    expect(body).toContain("_Shaped by Rivet on the Desk");
    expect(body).not.toContain("Rusty on the Desk");
    expect(readBody(body).question).toBe("Should it also work on the phone?");
    expect(questionOf(body)).toBe("Should it also work on the phone?");
  });
  it("has no Question line when the card is ready", () => {
    const body = shapedBody(ready, "ask first");
    expect(body).not.toContain("**Question:**");
    expect(questionOf(body)).toBe("");
    expect(body).toContain("From Nikita (on the Desk):");
  });
  it("keeps an idea with a question off the build queue", () => {
    const labels = shapedLabels(["foundry", "foundry:idea", "foundry:revise"], asked);
    expect(labels).toEqual(["foundry", "foundry:idea", "foundry:question"]);
    expect(labels).not.toContain("foundry:build");
    expect(labels).not.toContain("foundry:revise");
  });
  it("drops foundry:question once the card is ready", () => {
    expect(shapedLabels(["foundry", "foundry:idea", "foundry:question"], ready)).toEqual(["foundry", "foundry:idea"]);
  });
  it("trail names Rivet and the decision", () => {
    expect(shapedLine(asked, 1200, null)).toMatch(/^\*\*Trail · Shaped:\*\* Rivet on Claude Haiku .* Decision: asking Nikita first/);
    expect(shapedLine(ready, 1200, null, "answer")).toContain("Reshaped with Nikita's answer by Rivet");
    expect(shapedLine(ready, 1200, null, "notes")).toContain("Reshaped with Nikita's notes by Rivet");
    expect(shapedLine(ready, 1200, null)).toContain("Decision: ready for Nikita's pick.");
  });
  it("carries answered rounds on the body", () => {
    const block = answerBlock("Which page?", "The Foundry page.\nOn top.");
    const body = shapedBody(ready, "ask first", [], `\n\n${block}`);
    expect(answeredRounds(body)).toEqual([block]);
    const two = shapedBody(ready, "ask first", [], `\n\n${block}\n\n${answerBlock("Phone too?", "Yes")}`);
    expect(answeredRounds(two)).toHaveLength(2);
  });
});

describe("the shaping input", () => {
  it("is just Nikita's words for a new idea, in the idea block", () => {
    expect(shapeInput("add a thing")).toBe("<idea>\nadd a thing\n</idea>");
  });
  it("hands the answer to the question over with the idea as it stands", () => {
    const input = shapeInput("The Foundry page", "Idea: x", { answer: { question: "Which page?", reply: "The Foundry page" } });
    expect(input).toContain("<current_card>\nIdea: x\n</current_card>");
    expect(input).toContain("<rivet_question>\nWhich page?\n</rivet_question>\n<answer>\nThe Foundry page\n</answer>");
  });
  it("puts revise notes in their own block", () => {
    expect(shapeInput("make it blue", "Idea: x")).toContain("<notes>\nmake it blue\n</notes>");
  });
  it("tells Rivet to finish after the last allowed question", () => {
    expect(shapeInput("a", "b", { mayAsk: false })).toContain("Do not ask another question");
    expect(shapeInput("a", "b")).not.toContain("Do not ask another question");
    expect(MAX_QUESTIONS).toBe(2);
  });
});

describe("Rivet's risk read (a suggestion; the Builder decides auto-approval)", () => {
  it("reads risk and the never-list areas, keeping only known ones", () => {
    expect(readShape({ ...card, risk: "low", touches: [] })).toMatchObject({ risk: "low", touches: [] });
    expect(readShape({ ...card, risk: "low", touches: ["secrets", "auth", "secrets", "root-access"] })).toMatchObject({ touches: ["auth", "secrets"] });
  });
  it("never reads a missing or odd risk as low", () => {
    expect(readShape({ ...card })).toMatchObject({ risk: "medium", touches: [] });
    expect(readShape({ ...card, risk: "none", touches: "auth" })).toMatchObject({ risk: "medium", touches: [] });
  });
  it("could auto-approve only small or medium, low or medium risk, nothing on the never-list", () => {
    expect(autoEligible({ size: "small", risk: "low", touches: [] })).toBe(true);
    expect(autoEligible({ size: "medium", risk: "medium", touches: [] })).toBe(true);
    expect(autoEligible({ size: "large", risk: "low", touches: [] })).toBe(false);
    expect(autoEligible({ size: "small", risk: "high", touches: [] })).toBe(false);
    expect(autoEligible({ size: "small", risk: "low", touches: ["spend"] })).toBe(false);
  });
  it("writes a Risk line on the card and the Shaped step", () => {
    const low = readShape({ ...card, size: "small", risk: "low", touches: [] })!;
    const auth = readShape({ ...card, size: "small", risk: "low", touches: ["auth"] })!;
    expect(riskLine(low)).toBe("**Risk:** low · could be auto-approved; the Builder decides");
    expect(riskLine(auth)).toBe("**Risk:** low (touches sign-in or auth) · waits for Nikita");
    expect(shapedBody(auth, "w")).toContain("**Builder:** Rusty (Sonnet)\n**Risk:** low (touches sign-in or auth) · waits for Nikita\n");
    expect(shapedLine(low, 1000, null)).toContain("Risk: low (could be auto-approved; the Builder decides).");
    expect(shapedLine(auth, 1000, null)).toContain("Risk: low, touches sign-in or auth (waits for Nikita).");
  });
  it("puts a stopped auto-approved build back as an idea, out of everyone's hands", () => {
    expect(stoppedLabels(["foundry", "foundry:build", "foundry:auto", "foundry:working", "foundry:paused"])).toEqual(["foundry", "foundry:idea"]);
  });
});

describe("Undo from the Changelog", () => {
  it("reopens a shipped change in the fix lane, keeps foundry:shipped, and drops leftover work labels", () => {
    expect(undoLabels(["foundry", "foundry:build", "foundry:auto", "foundry:shipped", "foundry:working"])).toEqual(["foundry", "foundry:build", "foundry:auto", "foundry:shipped", "foundry:fix", "foundry:undo"]);
  });
  it("adds each label once", () => {
    expect(undoLabels(["foundry", "foundry:fix", "foundry:shipped", "foundry:undo"])).toEqual(["foundry", "foundry:fix", "foundry:shipped", "foundry:undo"]);
  });
});

describe("the setup list (#164)", () => {
  it("is for the signed-in Desk only: a visitor without a session gets no posture", async () => {
    const res = await GET(new Request("https://ceo.example/api/foundry?setup"));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await res.text()).not.toMatch(/"items"/);
  });
});
