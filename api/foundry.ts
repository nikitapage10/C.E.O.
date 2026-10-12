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
 *   FOUNDRY_GITHUB_TOKEN   a fine-grained token for this repo with Issues: read and write
 *   FOUNDRY_ROUTINE_ID     the Foundry's wake routine (same as the GitHub secret)
 *   FOUNDRY_ROUTINE_TOKEN  that routine's API token (same as the GitHub secret)
 */

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

async function wake(text: string): Promise<boolean> {
  if (!env("FOUNDRY_ROUTINE_ID") || !env("FOUNDRY_ROUTINE_TOKEN")) return false;
  const res = await fetch(`https://api.anthropic.com/v1/claude_code/routines/${env("FOUNDRY_ROUTINE_ID")}/fire`, {
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
    buttons: Boolean(env("FOUNDRY_DESK_KEY") && env("FOUNDRY_GITHUB_TOKEN")),
    wake: Boolean(env("FOUNDRY_ROUTINE_ID") && env("FOUNDRY_ROUTINE_TOKEN")),
  });
}

export async function POST(request: Request): Promise<Response> {
  if (!env("FOUNDRY_DESK_KEY") || !env("FOUNDRY_GITHUB_TOKEN")) return json({ error: "not-set-up" }, 503);
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
  const current = (await found.json()) as { state: string; title: string; labels: { name: string }[] };
  const labels = current.labels.map((l) => l.name);
  if (current.state !== "open" || !labels.includes("foundry") || !labels.includes("foundry:idea")) return json({ error: "not-an-open-idea" }, 409);

  if (choice === "pass") {
    await github(`/issues/${issue}/comments`, { method: "POST", body: JSON.stringify({ body: "Not this one (picked on the Desk)." }) });
    const res = await github(`/issues/${issue}`, { method: "PATCH", body: JSON.stringify({ state: "closed", state_reason: "not_planned" }) });
    return res.ok ? json({ ok: true }) : json({ error: "github" }, 502);
  }

  if (choice === "revise") {
    const quoted = text.split("\n").map((line) => `> ${line}`).join("\n");
    await github(`/issues/${issue}/comments`, { method: "POST", body: JSON.stringify({ body: `Nikita's notes from the Desk:\n\n${quoted}` }) });
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
