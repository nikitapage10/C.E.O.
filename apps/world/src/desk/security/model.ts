import evalsJson from "./evals.json";

/**
 * The threat model as data, for the Desk's Security and Compliance pages (#82). Every text here is copied word for
 * word from docs/THREAT-MODEL.md, and model.test.ts fails the moment the two drift apart, so the page never says
 * more (or less) than the doc. The eval counts come from evals.json, which `npm run security:evals` writes by
 * running the suite itself; a test fails when it falls behind.
 *
 * Only posture lives here: controls, statuses, counts and tracking references. Open holes get one plain line and a
 * reference, never a recipe, exactly as in the doc.
 */

export type ZoneId = "public" | "browser" | "vercel" | "claude" | "github" | "builder" | "relay";

/** The boxes of the data-flow diagram (docs/THREAT-MODEL.md, "Data flow and trust boundaries"). */
export const ZONES: Record<ZoneId, { name: string; trust: string; holds: string[]; planned?: boolean }> = {
  public: { name: "Public internet", trust: "Untrusted", holds: ["Anyone on GitHub", "Lattice viewers"] },
  browser: { name: "Nikita's browser", trust: "Holds the Desk key", holds: ["The Desk"] },
  relay: { name: "Relay MacBook", trust: "Planned", holds: ["Hub and BlueBubbles"], planned: true },
  vercel: {
    name: "Vercel production",
    trust: "Built from main",
    holds: ["Static site: Lattice and Desk", "api/foundry: Desk buttons, Rivet", "api/foundry-image", "Read feeds: Foundry, usage, security", "api/world-step, api/world, api/day-story", "Vercel Blob: world state, stories, pictures"],
  },
  claude: { name: "Claude and Gemini APIs", trust: "No tools", holds: ["Rivet and the world step (Haiku)", "The day's story (Gemini speech)"] },
  github: { name: "GitHub, public repo", trust: "Public", holds: ["Issues, comments, labels", "Code and main", "Actions: checks and scans"] },
  builder: { name: "Claude Code sessions", trust: "Checked, not trusted", holds: ["The Builder and workers"] },
};

export interface Boundary {
  id: string;
  name: string;
  /** What crosses it, as the doc says. */
  crosses: string;
  /** The controls, as the doc says (one cell, `;`-separated). */
  controls: string;
  from: ZoneId;
  to: ZoneId;
  planned?: boolean;
}

export const BOUNDARIES: Boundary[] = [
  {
    id: "TB1",
    name: "Desk to functions",
    crosses: "Nikita's ideas, notes, answers, pictures, button presses",
    controls:
      "Desk key compared in constant time (`api/foundry.ts`, `api/foundry-image.ts`, `api/day-story.ts`); the day's story backfill only for today or yesterday, once each; notes capped at 2,000 characters; only open `foundry:idea` issues can be acted on; picture links accepted only from the Desk's own picture function (`readImages`); image types allow-listed, 4 MB cap",
    from: "browser",
    to: "vercel",
  },
  {
    id: "TB2",
    name: "Code to the model APIs",
    crosses: "Idea text, issue text, the hour's digest, the day's story script; JSON, text or audio back",
    controls:
      "Untrusted text fenced in tagged data blocks that it can't close (`shapeInput`, `unfence` in `api/foundry.ts`; `fence` in `api/_world/prompt.ts` and `api/_world/story.ts`); the system rules are a constant, never built from input; structured output with a closed JSON schema; every answer re-validated in code (`readShape`, `readAnswer`); Gemini gets only the day's script, written from the already-scrubbed public Chronicle and scrubbed again (`cleanScript`), and its audio is only stored and played, with its key in Vercel and its own monthly cap",
    from: "vercel",
    to: "claude",
  },
  {
    id: "TB3",
    name: "Functions to GitHub",
    crosses: "Issue writes with the Foundry token",
    controls:
      "Token lives only in Vercel; label changes are hard-coded per button, so shaping can never add `foundry:build`; card text is reduced to plain lines before it is written (`plainLine`)",
    from: "vercel",
    to: "github",
  },
  {
    id: "TB4",
    name: "Public to the repo",
    crosses: "Anyone's issues and comments",
    controls:
      "Labels need a collaborator; the builder reads only owner text (TB5); the world step counts trail steps only from Nikita's account and the Checks bot (`TRAIL_AUTHORS` in `api/_world/digest.ts`)",
    from: "public",
    to: "github",
  },
  {
    id: "TB5",
    name: "Issues to the builder",
    crosses: "Work descriptions",
    controls:
      '`scripts/foundry-issue.sh` (#59): owner and CI text in data blocks with a random tag per read, everything else withheld by name, exit 3 when anything was withheld; worker briefs carry issue text only inside a data block (docs/FOUNDRY.md, "Trusted input")',
    from: "github",
    to: "builder",
  },
  {
    id: "TB6",
    name: "The public Lattice",
    crosses: "World history, Foundry feed, spend totals, security posture",
    controls:
      "Read-only endpoints; the step reads only titles, numbers, labels and trail step kinds, never bodies or comment words; `scrub` on everything in and out; edge cache with canonical URLs (#63); the security feed (`api/security-feed.ts`, #82) returns only pass or fail states, scores, dates and counts, never an open alert's details",
    from: "public",
    to: "vercel",
  },
  {
    id: "TB7",
    name: "Relay to the site (planned)",
    crosses: "Counts and states, never message text",
    controls: 'Design rules in docs/DELIVERY.md, "Environments"; the full privacy spec is roadmap R5',
    from: "relay",
    to: "vercel",
    planned: true,
  },
];

/**
 * Where a risk stands. `covered`: controls in place and the rest is watched. `tracked`: controls in place, and a
 * roadmap item takes it further. `open`: a known gap, tracked. `accepted`: accepted for now. `not-applicable`: the
 * feature it is about isn't used.
 */
export type RiskStatus = "covered" | "tracked" | "open" | "accepted" | "not-applicable";

export const RISK_STATUS_LABEL: Record<RiskStatus, string> = {
  covered: "Covered",
  tracked: "Covered, more planned",
  open: "Open, tracked",
  accepted: "Accepted",
  "not-applicable": "Not applicable",
};

/** The status a risk's row implies, from its controls and tracking cells. The doc is the source; this only reads it. */
export function statusOf(controls: string, tracking: string): RiskStatus {
  if (/^Not applicable/.test(controls)) return "not-applicable";
  if (/^Open\b/.test(tracking)) return "open";
  if (/^Accepted\b/.test(tracking)) return "accepted";
  if (/\bR\d\b/.test(tracking)) return "tracked";
  return "covered";
}

/** The roadmap references (R1 to R6) and issue numbers a cell names. */
export function refsOf(text: string): string[] {
  return [...text.matchAll(/\bR\d\b|#\d+/g)].map((m) => m[0]);
}

export interface LlmRisk {
  id: string;
  name: string;
  where: string;
  controls: string;
  residual: string;
  tracking: string;
}

/** OWASP Top 10 for LLM Applications (2025), as mapped in the doc. */
export const OWASP_LLM: LlmRisk[] = [
  {
    id: "LLM01",
    name: "Prompt Injection",
    where: "Idea text and issue text into Rivet; issue titles into the world step; issue comments into the builder",
    controls:
      "Data fencing with spoof-proof tags (`shapeInput`, `unfence`; `fence` in `api/_world/prompt.ts`); system rules that say the blocks are data; constant system prompts; owner-only input for the builder (`scripts/foundry-issue.sh`, #59); world trail steps only from trusted authors (`TRAIL_AUTHORS`); the injection eval suite below",
    residual: "A model can still be talked into odd wording inside the schema; the builder's fence is a script and a rule it follows, not a platform control",
    tracking: "Builder permission hook (R1)",
  },
  {
    id: "LLM02",
    name: "Sensitive Information Disclosure",
    where: "The public Lattice; ideas filed as public issues; pictures",
    controls:
      "Data minimisation (the step never reads bodies or comment words, `api/_world/digest.ts`); `scrub` on all input and output, now also catching full-width, zero-width-split and spelled-out forms; no secrets in git (secret scanning and push protection)",
    residual: "Desk text and pictures go public as written",
    tracking: "Privacy guard before posting (R4)",
  },
  {
    id: "LLM03",
    name: "Supply Chain",
    where: "npm packages, GitHub Actions, the Claude SDK",
    controls:
      "Lockfile with `npm ci`; `npm audit signatures` and `npm audit --audit-level=high` in checks; dependency review; Dependabot; actions pinned to SHAs; CodeQL; OpenSSF Scorecard (#64, #67)",
    residual: "A malicious release that passes signature checks before it is known",
    tracking: "Watched by Dependabot and dependency review",
  },
  {
    id: "LLM04",
    name: "Data and Model Poisoning",
    where: "No training or fine-tuning; the world step reads back its own last hours",
    controls: "Last hours are re-fenced and re-scrubbed each hour; answers are re-validated before they are saved, so a bad hour can't add agents, rooms or kinds",
    residual: "One odd hour can echo into the next few",
    tracking: "Accepted",
  },
  {
    id: "LLM05",
    name: "Improper Output Handling",
    where: "Rivet's card written into an issue body the Desk and the world step parse; world text shown on the Lattice",
    controls:
      "Schema with `additionalProperties: false`; enums for builder, model, size, agents, rooms and kinds; `plainLine` strips pictures, links, HTML and markdown markers from card text so it can't fake a `**Builder:**` line or call out to another host; length caps everywhere; React escapes all model text; no HTML sinks in the front end",
    residual: "The Desk's card reader is more permissive than the card writer for text written with the Desk key; an enforcing CSP and security headers (#62) back it up",
    tracking: "Open, tracked: R4",
  },
  {
    id: "LLM06",
    name: "Excessive Agency",
    where: "The builder session (shell, git, merges); Rivet; the world step",
    controls:
      "Rivet and the world step have no tools at all: they return JSON only; labels that start a build come only from Nikita's Build choice; checks, scans and the ruleset definitions for `main` (#60, #66); CODEOWNERS on the trust boundary (inert until the agents have their own identity)",
    residual: "The builder's shell permissions are broad and it acts as Nikita, so its limits are partly rules it follows",
    tracking: "Builder permission hook (R1); agents' own identity (R2)",
  },
  {
    id: "LLM07",
    name: "System Prompt Leakage",
    where: "Rivet's and the world step's prompts",
    controls: "Both prompts are public in this repo by design and hold no secrets, keys or private rules; the security comes from code checks, not from the prompt being secret",
    residual: "None beyond what is already public",
    tracking: "Accepted",
  },
  {
    id: "LLM08",
    name: "Vector and Embedding Weaknesses",
    where: "Not used: no retrieval, no vector store",
    controls: "Not applicable today",
    residual: "If Relay adds retrieval over messages, this becomes live",
    tracking: "Relay privacy spec (R5)",
  },
  {
    id: "LLM09",
    name: "Misinformation",
    where: "The Historian's hourly summaries; Rivet's pitches",
    controls: "The world step reads only real events and labels the Lattice as a story; Rivet's card is a suggestion that Nikita approves; the Builder confirms builder and model",
    residual: "Off-tone or wrong lines on the Lattice for an hour",
    tracking: "Accepted",
  },
  {
    id: "LLM10",
    name: "Unbounded Consumption",
    where: "Claude spend; Gemini speech spend; GitHub token quota; function CPU",
    controls:
      "Coded budget guard for the world step (`api/_world/budget.ts`); Gemini's own coded monthly cap and one story per day, made once (`api/_world/story.ts`); provider-side monthly cap; `max_tokens` on every call; note and output length caps; feed cache hardening (#63); `scrub` now linear on long input (bounded patterns, titles cut before scrubbing)",
    residual: "The world step's trigger is open and its per-hour cap is a known gap",
    tracking: "Open, tracked: world-step key (R6, #61, not picked)",
  },
];

/** Google SAIF's six core elements, as mapped in the doc. */
export const SAIF: { element: string; inCeo: string }[] = [
  {
    element: "Expand strong security foundations to the AI ecosystem",
    inCeo: "Secrets only in Vercel; pinned and signed supply chain; CodeQL and dependency review on agent-written code like any other; an enforcing CSP and security headers (#62)",
  },
  {
    element: "Extend detection and response",
    inCeo:
      "The Trail on every issue records origin, decision, builder, model and cost of each change; Checks failing on `main` opens a fix issue by itself; Scorecard and code scanning report to the Security tab",
  },
  {
    element: "Automate defenses",
    inCeo: "The injection eval suite runs on every build; schema-bound output and code re-validation on every model call; Dependabot and secret scanning",
  },
  {
    element: "Harmonize platform controls",
    inCeo: "One delivery path for every change (DELIVERY.md); rulesets for `main` defined in `.github/rulesets/` (#60); least-privilege workflow permissions",
  },
  {
    element: "Adapt controls",
    inCeo: "Each review finding became a carded fix with a test; this suite grows with new payloads; gaps it finds are fixed or marked expected-fail until they are",
  },
  {
    element: "Contextualize AI system risks",
    inCeo: "This page: the model risks are mapped to the business flow they sit in (ideas, builds, the public world, messages)",
  },
];

/** NIST AI RMF's four functions, as mapped in the doc. */
export const NIST_AI_RMF: { fn: "Govern" | "Map" | "Measure" | "Manage"; inCeo: string }[] = [
  {
    fn: "Govern",
    inCeo:
      "Who decides is written down (docs/SKIPPY.md); Nikita approves every build on the Desk; the security review (#58) and this page set the policy; CODEOWNERS marks the trust boundary",
  },
  { fn: "Map", inCeo: "The data flow, boundaries, assets and actors above; the OWASP table maps each risk to where it lives" },
  {
    fn: "Measure",
    inCeo: "The injection eval suite (counts below); spend per call on the Trail and the Desk's usage panel; Scorecard; delivery measures planned in DELIVERY.md",
  },
  { fn: "Manage", inCeo: "Controls per risk with owners and tracking; residual risks and the roadmap below; expected-fail tests keep open gaps visible in every run" },
];

/** The residual risks and roadmap, as the doc lists them. */
export const ROADMAP: { id: string; item: string; closes: string; status: string }[] = [
  { id: "Shipped", item: "Security headers and an enforcing CSP", closes: "Output handling defence in depth, clickjacking", status: "#62" },
  { id: "R1", item: "Builder permission hook: narrow shell permissions, deny risky commands, log every tool call", closes: "Excessive agency (agent half)", status: "Not carded" },
  {
    id: "R2",
    item: "The agents' own identity (a GitHub App with short-lived tokens; DELIVERY.md, section 10)",
    closes: "Agents acting as Nikita; previews and audit",
    status: "Not carded",
  },
  { id: "R3", item: "Real Desk sign-in (passkey, short session, rate limits)", closes: "The static Desk key", status: "Not carded" },
  {
    id: "R4",
    item: "Privacy guard before posting (check Desk text before it goes public, signed picture links, Desk shows own pictures only)",
    closes: "Desk text and pictures going public",
    status: "Not carded",
  },
  { id: "R5", item: "Relay privacy spec before the hub is built", closes: "Messages and contacts", status: "Not carded" },
  { id: "R6", item: "Key the world step and cap it per hour", closes: "World spend", status: "#61, not picked by Nikita" },
];

export type EvalAreaId = "rivet-prompt" | "rivet-answer" | "desk-write" | "world-step" | "builder-input";

/** The eval suite's areas, as the doc's table names them; the counts come from evals.json. */
export const EVAL_AREAS: { id: EvalAreaId; area: string; file: string; proves: string }[] = [
  {
    id: "rivet-prompt",
    area: "Rivet's prompt",
    file: "injection.test.ts",
    proves:
      'For 21 known payloads (direct, "ignore previous", delimiter spoofing in five forms, role-play, base64, ASCII smuggling, bidi, markdown and HTML exfiltration, fake tool calls, fake card fields, a spoofed owner note, oversized input), the idea stays in its own block in new, revise and answer rounds; the real call sends the same system rules and the idea only as user data, with structured output on',
  },
  {
    id: "rivet-answer",
    area: "Rivet's answer",
    file: "injection.test.ts",
    proves: "Hostile answers can't add fields or labels, pick an unknown builder or model, smuggle card lines, links, pictures, HTML or scripts, or exceed length caps; non-cards are rejected",
  },
  {
    id: "desk-write",
    area: "The Desk's write path",
    file: "injection.test.ts",
    proves:
      "With GitHub and Claude stubbed: wrong keys touch nothing; a proposed or revised idea never gets `foundry:build`; foreign picture links are dropped; oversized notes are capped; forged choices and issue numbers are refused; requests go only to the repo's API",
  },
  {
    id: "world-step",
    area: "The world step",
    file: "injection.test.ts",
    proves:
      "Hostile titles and stranger comments: system rules unchanged byte for byte, each data block opened and closed once, no stray brackets or invisible characters, only trusted trail authors; secrets in disguise are scrubbed; hostile answers lose unknown agents, rooms, kinds, extra fields and over-limit items; end to end through `runStep`, the saved state is clean",
  },
  {
    id: "builder-input",
    area: "The builder's input",
    file: "builder-input.test.ts",
    proves: "With a stub `gh`: an outsider's and look-alike accounts' text never appears, exit code 3, a spoofed closing marker closes nothing, owner and CI text sit in their blocks",
  },
];

export interface EvalCounts {
  total: number;
  passing: number;
  expectedFail: number;
  areas: { id: EvalAreaId; file: string; cases: number; passing: number; expectedFail: number }[];
}

/** The eval suite's counts, written by `npm run security:evals`. */
export const EVALS = evalsJson as EvalCounts;

/** A cell's `;`-separated parts, ignoring the ones inside brackets: the controls as chips. */
export function partsOf(cell: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of cell) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === ";" && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** OWASP coverage at a glance: how many of the ten sit in each status. */
export function owaspTally(): Record<RiskStatus, number> {
  const tally: Record<RiskStatus, number> = { covered: 0, tracked: 0, open: 0, accepted: 0, "not-applicable": 0 };
  for (const r of OWASP_LLM) tally[statusOf(r.controls, r.tracking)] += 1;
  return tally;
}
