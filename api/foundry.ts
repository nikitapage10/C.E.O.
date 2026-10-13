/**
 * The Desk's Foundry buttons, as a Vercel function. The Desk reads GitHub directly (the repo is public), but picking
 * an idea writes, so it comes through here, where the tokens live in Vercel's environment and never reach the
 * browser.
 *
 * GET  → which pieces are set up: { buttons, direct, shape }.
 * POST → { issue, choice: "build" | "pass" | "revise", note?, key }: "build" approves a morning idea (labels it
 *        `foundry:build`); "pass" shelves it (closed as not planned); "revise" posts Nikita's note on the idea and
 *        labels it `foundry:revise` for Rusty to rewrite. Only open `foundry:idea` issues.
 *        { choice: "propose", note, key } opens a new idea from Nikita's words for Rusty to shape.
 *        The answer comes back as soon as GitHub has the change; Rusty's shaping finishes in the background.
 *
 * The Foundry thread picks up approved builds and unshaped ideas at its hourly queue check (docs/FOUNDRY.md).
 *
 * Environment (Vercel → Settings → Environment Variables):
 *   FOUNDRY_DESK_KEY       a passphrase Nikita types once on the Desk; without it nobody else can press the buttons
 *   FOUNDRY_GITHUB_TOKEN   a fine-grained token for this repo with Issues read and write: the buttons need it
 *   CLAUDE_API_KEY         optional (ANTHROPIC_API_KEY works too): Rusty shapes a proposed or revised idea on the spot
 *                          (a pitch, a size and a builder, in a second or two, on Claude Haiku) instead of at the
 *                          hourly check. Shaping only, never code (code runs on Claude Code); capped at $10 a month.
 */

import Anthropic from "@anthropic-ai/sdk";
import { waitUntil } from "@vercel/functions";
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
      max_tokens: 400,
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

/**
 * Rusty's background pass: shape the idea and rewrite the issue as a card. When shaping fails the issue keeps
 * `foundry:revise` and the hourly check shapes it instead.
 */
async function shapeInto(issue: number, text: string, labels: string[], current?: string, words = text, extra = ""): Promise<void> {
  const shape = await shapeIdea(text, current);
  if (!shape) return;
  await github(`/issues/${issue}`, { method: "PATCH", body: JSON.stringify({ title: shape.title, body: shapedBody(shape, words) + extra, labels }) }).catch(() => null);
}

function shapedBody(shape: Shape, words: string): string {
  return `**Pitch:** ${shape.pitch}\n**Size:** ${shape.size}\n**Builder:** ${shape.builder}\n\n**From Nikita (on the Desk):**\n\n${words}\n\n_Shaped by Rusty on the Desk (${SHAPE_MODEL}). It waits for Nikita's pick like any idea._`;
}

export function GET(): Response {
  return json({
    /** The buttons work when the key is set and a click can reach GitHub. */
    buttons: Boolean(env("FOUNDRY_DESK_KEY")) && canWrite(),
    direct: canWrite(),
    /** True when Rusty shapes proposed and revised ideas on the spot. */
    shape: canShape(),
  });
}

export async function POST(request: Request): Promise<Response> {
  if (!env("FOUNDRY_DESK_KEY") || !canWrite()) return json({ error: "not-set-up" }, 503);
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

  if (choice === "propose") {
    // The card goes up in Nikita's words at once; Rusty shapes it in the background when Claude is set up, and the
    // hourly check shapes it otherwise.
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
    if (canShape()) waitUntil(shapeInto(made.number, text, ["foundry", "foundry:idea"]));
    return json({ ok: true, issue: made.number, shaping: canShape() });
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
    const res = await github(`/issues/${issue}`, { method: "PATCH", body: JSON.stringify({ labels: [...new Set([...labels, "foundry:revise"])] }) });
    if (!res.ok) return json({ error: "github" }, 502);
    await github(`/issues/${issue}/comments`, { method: "POST", body: JSON.stringify({ body: `Nikita's notes from the Desk:\n\n${quoted}` }) });
    if (canShape()) {
      const words = /\*\*From Nikita \(on the Desk\):\*\*\n\n([\s\S]*?)\n\n(?:_Shaped|Rusty shapes)/.exec(current.body ?? "")?.[1] ?? "";
      const extra = `\n\n**Revised with Nikita's notes:**\n\n${quoted}`;
      waitUntil(shapeInto(issue, text, labels.filter((l) => l !== "foundry:revise"), `${current.title}\n\n${current.body ?? ""}`, words || "(from the morning ideas)", extra));
    }
    return json({ ok: true, shaping: canShape() });
  }

  const next = [...labels.filter((l) => l !== "foundry:idea" && l !== "foundry:revise"), "foundry:build"];
  const res = await github(`/issues/${issue}`, { method: "PATCH", body: JSON.stringify({ labels: next }) });
  if (!res.ok) return json({ error: "github" }, 502);
  await github(`/issues/${issue}/comments`, { method: "POST", body: JSON.stringify({ body: "Approved for building (picked on the Desk)." }) });
  return json({ ok: true });
}
