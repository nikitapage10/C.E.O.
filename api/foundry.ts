/**
 * The Desk's Foundry buttons, as a Vercel function. The Desk reads GitHub directly (the repo is public), but picking
 * an idea writes, so it comes through here, where the tokens live in Vercel's environment and never reach the
 * browser.
 *
 * GET  → which pieces are set up: { buttons, wake }.
 * POST → { issue, choice: "build" | "pass" | "revise", note?, key }: "build" approves a morning idea (labels it
 *        `foundry:build`) and wakes the Foundry thread; "pass" closes it as not planned; "revise" posts Nikita's note
 *        on the idea, labels it `foundry:revise` and wakes the Foundry to rewrite it. Only open `foundry:idea` issues.
 *        { choice: "propose", note, key } opens a new idea from Nikita's words for Rusty to shape.
 *
 * Environment (Vercel → Settings → Environment Variables):
 *   FOUNDRY_DESK_KEY       a passphrase Nikita types once on the Desk; without it nobody else can press the buttons
 *   FOUNDRY_ROUTINE_TOKEN  the wake routine's API token (same as the GitHub secret)
 *   FOUNDRY_ROUTINE_ID     the wake routine (same as the GitHub secret); defaults to the Foundry's routine
 *   CLAUDE_API_KEY         optional (ANTHROPIC_API_KEY works too): lets Rusty shape a proposed or revised idea on the spot (a pitch, a size and a
 *                          builder, in a few seconds, on Claude Haiku), instead of waiting for the hourly check.
 *                          Shaping only, never code (code runs on Claude Code); capped at $10 a month.
 *   FOUNDRY_GITHUB_TOKEN   optional: a fine-grained token for this repo with Issues read and write. With it, a
 *                          click changes the issue at once; without it, the click wakes the Foundry thread and the
 *                          thread makes the change on GitHub itself a moment later.
 *
 * Every click is sent to the Foundry thread as a "Desk:" line in the wake text, which the thread reads as a task.
 */

const DEFAULT_ROUTINE_ID = "trig_01StEu8pfVzyZpiRQjLDyTmP";

import Anthropic from "@anthropic-ai/sdk";
import { timingSafeEqual } from "node:crypto";

const REPO = "nikitapage10/C.E.O.";
const GH = `https://api.github.com/repos/${REPO}`;

const env = (name: string): string => process.env[name] ?? "";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

function keyMatches(given: string): boolean {
  const want = Buffer.from(env("FOUNDRY_DESK_KEY"));
  const got = Buffer.from(given);
  return want.length > 0 && want.length === got.length && timingSafeEqual(want, got);
}

async function github(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${GH}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env("FOUNDRY_GITHUB_TOKEN")}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
  });
}

const routineId = () => env("FOUNDRY_ROUTINE_ID") || DEFAULT_ROUTINE_ID;
const canWake = () => Boolean(env("FOUNDRY_ROUTINE_TOKEN"));
const canWrite = () => Boolean(env("FOUNDRY_GITHUB_TOKEN"));
const claudeKey = () => env("CLAUDE_API_KEY") || env("ANTHROPIC_API_KEY");
const canShape = () => Boolean(claudeKey());

/** Rusty's quick pass on an idea: what the Desk card shows and who builds it. */
export interface Shape {
  title: string;
  pitch: string;
  size: "small" | "medium" | "large";
  builder: "Rusty" | "Rocky";
}

const SHAPE_MODEL = "claude-haiku-5-5";

const SHAPE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    pitch: { type: "string" },
    size: { type: "string", enum: ["small", "medium", "large"] },
    builder: { type: "string", enum: ["Rusty", "Rocky"] },
  },
  required: ["title", "pitch", "size", "builder"],
  additionalProperties: false,
} as const;

const SHAPE_PROMPT = `You shape feature ideas for C.E.O., Nikita's web app: a Desk dashboard plus "the Lattice", a 3D world of rooms where AI agents (the Syntherion) work, with a coding crew in the Foundry room. Nikita describes an idea, often by voice, rambling. Turn it into a card:
- title: "Idea: " plus a short plain name for it (under 70 characters), in Nikita's own words where possible.
- pitch: two or three plain sentences: what changes and what Nikita will see. Keep every request Nikita made; add nothing they didn't ask for.
- size: small (one area, an hour or so), medium (a few files or one feature), or large (several systems).
- builder: "Rusty" (Sonnet) for simple, well-scoped work like moving, renaming or restyling things; "Rocky" (Opus) for anything substantial, open-ended or design-heavy, or that would clearly benefit from the stronger model. Lean towards Rocky when unsure.
Nikita often dictates, so fix obvious speech-to-text slips using C.E.O.'s own words: subminds (Skippy's room leads), Skippy, Rivet, Rusty, Rocky, the Desk, the Lattice, the Foundry, Relay, the Spire, the Exchange, the Green, the Archive, the Break Room, the Boiler Room, the Workshop.
Reply with the card as JSON: title, pitch, size, builder.`;

/** Rusty shapes the idea in a few seconds; null when Claude isn't set up or doesn't answer in time. */
export async function shapeIdea(words: string, current?: string): Promise<Shape | null> {
  if (!canShape()) return null;
  const input = current ? `The idea as it stands:\n${current}\n\nNikita's notes to revise it with:\n${words}` : words;
  const client = new Anthropic({ apiKey: claudeKey(), timeout: 12_000, maxRetries: 1 });
  try {
    const res = await client.messages.create({
      model: SHAPE_MODEL,
      max_tokens: 1024,
      thinking: { type: "disabled" },
      output_config: { effort: "low", format: { type: "json_schema", schema: SHAPE_SCHEMA } },
      system: SHAPE_PROMPT,
      messages: [{ role: "user", content: input }],
    });
    const text = res.content.find((block) => block.type === "text");
    if (!text || text.type !== "text") return null;
    const raw = JSON.parse(text.text) as Partial<Shape>;
    if (typeof raw.title !== "string" || typeof raw.pitch !== "string") return null;
    const title = raw.title.startsWith("Idea:") ? raw.title : `Idea: ${raw.title}`;
    return {
      title: title.slice(0, 90),
      pitch: raw.pitch.trim(),
      size: raw.size === "small" || raw.size === "large" ? raw.size : "medium",
      builder: raw.builder === "Rusty" ? "Rusty" : "Rocky",
    };
  } catch {
    return null;
  }
}

function shapedBody(shape: Shape, words: string): string {
  return `**Pitch:** ${shape.pitch}\n**Size:** ${shape.size}\n**Builder:** ${shape.builder}\n\n**From Nikita (on the Desk):**\n\n${words}\n\n_Shaped by Rusty on the Desk (${SHAPE_MODEL}). It waits for Nikita's pick like any idea._`;
}

async function wake(text: string): Promise<boolean> {
  if (!canWake()) return false;
  const res = await fetch(`https://api.anthropic.com/v1/claude_code/routines/${routineId()}/fire`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env("FOUNDRY_ROUTINE_TOKEN")}`,
      "anthropic-beta": "experimental-cc-routine-2026-04-01",
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });
  return res.ok;
}

export function GET(): Response {
  return json({
    /** The buttons work when the key is set and a click can reach GitHub, directly or through the thread. */
    buttons: Boolean(env("FOUNDRY_DESK_KEY")) && (canWrite() || canWake()),
    wake: canWake(),
    /** True when clicks change the issue at once rather than through the thread. */
    direct: canWrite(),
    /** True when Rusty shapes proposed and revised ideas on the spot. */
    shape: canShape(),
  });
}

export async function POST(request: Request): Promise<Response> {
  if (!env("FOUNDRY_DESK_KEY") || !(canWrite() || canWake())) return json({ error: "not-set-up" }, 503);
  let body: { issue?: unknown; choice?: unknown; note?: unknown; key?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "bad-request" }, 400);
  }
  const { issue, choice, note, key } = body;
  if (typeof key !== "string" || !keyMatches(key)) return json({ error: "wrong-key" }, 401);
  const text = typeof note === "string" ? note.trim().slice(0, 2000) : "";
  if ((choice === "revise" || choice === "propose") && !text) return json({ error: "bad-request" }, 400);

  if (!canWrite()) {
    // No GitHub token: the thread does the GitHub side. Say exactly what was clicked.
    const line =
      choice === "propose" ? `Desk: propose a new idea. Nikita's words:\n${text}`
      : typeof issue !== "number" || !Number.isInteger(issue) || issue < 1 ? null
      : choice === "build" ? `Desk: build idea #${issue} (approved).`
      : choice === "pass" ? `Desk: pass on idea #${issue} (shelve it: label foundry:passed, close as not planned).`
      : choice === "revise" ? `Desk: revise idea #${issue}. Nikita's notes:\n${text}`
      : null;
    if (!line) return json({ error: "bad-request" }, 400);
    const woke = await wake(line).catch(() => false);
    return woke ? json({ ok: true, woke, deferred: true }) : json({ error: "wake" }, 502);
  }

  if (choice === "propose") {
    // Rusty shapes it here and now when OpenAI is set up; otherwise the thread shapes it after the wake.
    const shape = await shapeIdea(text);
    if (shape) {
      const res = await github("/issues", { method: "POST", body: JSON.stringify({ title: shape.title, body: shapedBody(shape, text), labels: ["foundry", "foundry:idea"] }) });
      if (!res.ok) return json({ error: "github" }, 502);
      const made = (await res.json()) as { number: number };
      return json({ ok: true, issue: made.number, shaped: true });
    }
    const first = text.split("\n")[0]!.trim();
    const title = `Idea: ${first.length > 80 ? `${first.slice(0, 77)}…` : first}`;
    const res = await github("/issues", {
      method: "POST",
      body: JSON.stringify({
        title,
        body: `**From Nikita (on the Desk):**\n\n${text}\n\nRusty shapes this into a pitch, a size and a builder, then it waits for Nikita's pick like any idea.`,
        labels: ["foundry", "foundry:idea", "foundry:revise"],
      }),
    });
    if (!res.ok) return json({ error: "github" }, 502);
    const made = (await res.json()) as { number: number };
    const woke = await wake(`Nikita proposed idea #${made.number} on the Desk.`).catch(() => false);
    return json({ ok: true, issue: made.number, woke });
  }

  if (typeof issue !== "number" || !Number.isInteger(issue) || issue < 1 || (choice !== "build" && choice !== "pass" && choice !== "revise")) return json({ error: "bad-request" }, 400);

  const found = await github(`/issues/${issue}`);
  if (!found.ok) return json({ error: "not-found" }, 404);
  const current = (await found.json()) as { state: string; title: string; body?: string | null; labels: { name: string }[] };
  const labels = current.labels.map((l) => l.name);
  if (current.state !== "open" || !labels.includes("foundry") || !labels.includes("foundry:idea")) return json({ error: "not-an-open-idea" }, 409);

  if (choice === "pass") {
    // Passed ideas go on the shelf, not in the bin: closed, labelled, and open to a comeback in a new shape.
    await github(`/issues/${issue}/comments`, { method: "POST", body: JSON.stringify({ body: "Not this one, for now (passed on the Desk). On the shelf; Rusty may bring it back in a different shape." }) });
    const res = await github(`/issues/${issue}`, { method: "PATCH", body: JSON.stringify({ state: "closed", state_reason: "not_planned", labels: [...new Set([...labels.filter((l) => l !== "foundry:revise"), "foundry:passed"])] }) });
    return res.ok ? json({ ok: true }) : json({ error: "github" }, 502);
  }

  if (choice === "revise") {
    const quoted = text.split("\n").map((line) => `> ${line}`).join("\n");
    await github(`/issues/${issue}/comments`, { method: "POST", body: JSON.stringify({ body: `Nikita's notes from the Desk:\n\n${quoted}` }) });
    const shape = await shapeIdea(text, `${current.title}\n\n${current.body ?? ""}`);
    if (shape) {
      const words = /\*\*From Nikita \(on the Desk\):\*\*\n\n([\s\S]*?)\n\n(?:_Shaped|Rusty shapes)/.exec(current.body ?? "")?.[1] ?? "";
      const body = `${shapedBody(shape, words || "(from the morning ideas)")}\n\n**Revised with Nikita's notes:**\n\n${quoted}`;
      const res = await github(`/issues/${issue}`, { method: "PATCH", body: JSON.stringify({ title: shape.title, body, labels: labels.filter((l) => l !== "foundry:revise") }) });
      return res.ok ? json({ ok: true, shaped: true }) : json({ error: "github" }, 502);
    }
    const res = await github(`/issues/${issue}`, { method: "PATCH", body: JSON.stringify({ labels: [...new Set([...labels, "foundry:revise"])] }) });
    if (!res.ok) return json({ error: "github" }, 502);
    const woke = await wake(`Idea #${issue} has revision notes from the Desk.`).catch(() => false);
    return json({ ok: true, woke });
  }

  const next = [...labels.filter((l) => l !== "foundry:idea" && l !== "foundry:revise"), "foundry:build"];
  const res = await github(`/issues/${issue}`, { method: "PATCH", body: JSON.stringify({ labels: next }) });
  if (!res.ok) return json({ error: "github" }, 502);
  await github(`/issues/${issue}/comments`, { method: "POST", body: JSON.stringify({ body: "Approved for building (picked on the Desk)." }) });
  const woke = await wake(`Idea #${issue} was approved on the Desk.`).catch(() => false);
  return json({ ok: true, woke });
}
