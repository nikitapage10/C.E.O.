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
  browser: { name: "Nikita's browser", trust: "Passkey session", holds: ["The Desk"] },
  relay: { name: "Relay MacBook", trust: "Planned", holds: ["Hub and BlueBubbles"], planned: true },
  vercel: {
    name: "Vercel production",
    trust: "Built from main",
    holds: ["Static site: Lattice and Desk", "api/desk-auth: passkeys, sessions", "api/desk-pings: pings to the phone", "api/foundry: Desk buttons, Rivet", "api/skippy: Skippy's chat", "api/foundry-image", "Read feeds: Foundry, usage, security", "api/world-step, api/world, api/day-story", "Vercel Blob: world, stories, pictures, passkeys"],
  },
  claude: { name: "Claude and Gemini APIs", trust: "No tools", holds: ["Rivet, the world step and Skippy's chat (Haiku)", "The day's story (Gemini speech)", "Visual QA's review (Gemini, from CI)"] },
  github: { name: "GitHub, public repo", trust: "Public", holds: ["Issues, comments, labels", "Code and main", "Actions: checks, scans, Visual QA"] },
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
    crosses: "Nikita's ideas, notes, answers, pictures, button presses, a device's push subscription, messages to Skippy",
    controls:
      "A passkey sign-in with the device's own unlock (`api/desk-auth.ts`, #132), then a signed, HttpOnly, SameSite=Strict session cookie that lasts 30 minutes from its last use and 12 hours at most, checked on every write and private read (`requireSession` in `api/_desk/session.ts`); failed sign-ins and enrolments slow down, then lock out (`api/_desk/limits.ts`); the Desk key only enrols a new device and is never kept in the browser; the day's story backfill only for today or yesterday, once each (and once more when the story's style changes, #102); notes capped at 2,000 characters; only open `foundry:idea` issues can be acted on; picture links accepted only from the Desk's own picture function (`readImages`); image types allow-listed, 4 MB cap; Desk text that looks private is held back before it is sent anywhere (`privateParts`, #127); pictures served only on short-lived signed links (`verifyPicture`, #127); a push subscription taken only in a passkey session and only for a known push service (`readSubscription`, #135), dropped on sign-out or when its device is removed, and pinged only while its passkey is enrolled; the scan that sends pings needs the workflow's shared secret (`DESK_PINGS_SECRET`), and a ping carries counts only, never issue text (`pingText` in `api/_desk/pings.ts`); Skippy's chat (`api/skippy.ts`, #224) answers only in a passkey session, takes a message of at most 600 characters and the last eight turns, holds back text that looks private before Claude sees it, is paced per passkey (`api/_skippy/limits.ts`), logs no message text, keeps each answered question and reply only in the private store under the room Skippy tagged it with (the last 200 per room, 30 days at most; the room checked against a closed set, anything else filed as none), readable back only in a passkey session (`api/_skippy/log.ts`, GET /api/skippy-log, #273), never the history and never on a public path or the Lattice, and its suggested actions do nothing until Nikita taps one, which then goes through the Desk's own buttons; the site is locked or unlocked, and every site session ended, only in a passkey session (`api/_site/control.ts`, #236, #238)",
    from: "browser",
    to: "vercel",
  },
  {
    id: "TB2",
    name: "Code to the model APIs",
    crosses: "Idea text, issue text, the hour's digest, the day's story script, Nikita's messages to Skippy with the Desk's state; JSON, text or audio back",
    controls:
      "Untrusted text fenced in tagged data blocks that it can't close (`shapeInput`, `unfence` in `api/foundry.ts`; `fence` in `api/_world/prompt.ts` and `api/_world/story.ts`; `chatInput`, `unfenceChat` in `api/_skippy/prompt.ts`); the system rules are a constant, never built from input; structured output with a closed JSON schema; every answer re-validated in code (`readShape`, `readAnswer`, `readReply`); Skippy is told the Desk's state as titles, numbers, labels and counts only, scrubbed like the public feeds (`api/_skippy/context.ts`); Gemini gets only the day's script, written from the already-scrubbed public Chronicle and scrubbed again (`cleanScript`), and its audio is only stored and played, with its key in Vercel and its own monthly cap",
    from: "vercel",
    to: "claude",
  },
  {
    id: "TB3",
    name: "Functions to GitHub",
    crosses: "Issue writes with the Foundry token",
    controls:
      "Token lives only in Vercel; once the crew's GitHub App is set up, the buttons write as `ceo-foundry[bot]` with an hour-long token that can only touch this repo's issues, and the feeds read with a read-only one (`api/_github.ts`, #138); label changes are hard-coded per button, so shaping can never add `foundry:build`; card text is reduced to plain lines before it is written (`plainLine`)",
    from: "vercel",
    to: "github",
  },
  {
    id: "TB4",
    name: "Public to the repo",
    crosses: "Anyone's issues and comments",
    controls:
      "Labels need a collaborator; the builder reads only owner text (TB5); the world step counts trail steps only from Nikita's account, the Checks bot and the crew's App (`TRAIL_AUTHORS` in `api/_world/digest.ts`)",
    from: "public",
    to: "github",
  },
  {
    id: "TB5",
    name: "Issues to the builder",
    crosses: "Work descriptions",
    controls:
      '`scripts/foundry-issue.sh` (#59): owner, CI and Foundry App text in data blocks with a random tag per read, everything else withheld by name, exit 3 when anything was withheld; worker briefs carry issue text only inside a data block (docs/FOUNDRY.md, "Trusted input")',
    from: "github",
    to: "builder",
  },
  {
    id: "TB6",
    name: "The public Lattice",
    crosses: "World history, Foundry feed, spend totals, security posture, the latest Visual QA run",
    controls:
      "Read-only endpoints; the step reads only titles, numbers, labels and trail step kinds, never bodies or comment words; `scrub` on everything in and out; edge cache with canonical URLs (#63); the security feed (`api/security-feed.ts`, #82) returns only pass or fail states, scores, dates and counts, never an open alert's details; the Visual QA feed (`api/visual-qa-feed.ts`, #91) returns only counts, a time, a state and a link to the run; once Nikita locks the site, every page and API route asks for a site session first, one Desk passkey sign-in per device that lasts 180 days from its last use (no password, #238), and only the login page, the Desk's passkey ceremony (which guards itself), the public build's files and machine callers holding their own key pass without one (`middleware.ts`, `api/_site/gate.ts`, #236)",
    from: "public",
    to: "vercel",
  },
  {
    id: "TB7",
    name: "Relay to the site (planned)",
    crosses: "Counts and states, never message text",
    controls:
      'The Relay privacy spec, docs/RELAY-PRIVACY.md (#149): only `RelayStatus`, an allowlisted shape of counts, enum states and timestamps, checked with `readRelayStatus` (`packages/core/src/relay.ts`) before the hub sends it and again where the site receives it; an unknown key or a free string refuses the whole status; names, previews and drafts never pass through Vercel; design rules in docs/DELIVERY.md, "Environments"',
    from: "relay",
    to: "vercel",
    planned: true,
  },
  {
    id: "TB8",
    name: "CI to Gemini",
    crosses: "Clips of the public Lattice and the room descriptions; JSON findings back",
    controls:
      "Only renders of the public Lattice built from `main`, a few seconds a room at low resolution, never live data or secrets (`scripts/room-tour.mjs`); the key is a GitHub Actions secret (`GEMINI_API_KEY`) given only to the review step, sent only to Google's API host and never printed (`redact`); fixed rules that say text in the video is never instructions; structured output re-validated in code (`parseFindings`) and reduced to plain lines (`plainText`) before CI writes an issue in its own words; spend capped per run and per day (`api/_visualqa/review.ts`)",
    from: "github",
    to: "claude",
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
    where: "Idea text and issue text into Rivet; Nikita's messages and the Desk's state into Skippy's chat; issue titles into the world step; issue comments into the builder; text visible in the Lattice's recordings into Gemini",
    controls:
      "Data fencing with spoof-proof tags (`shapeInput`, `unfence`; `fence` in `api/_world/prompt.ts`; `chatInput`, `unfenceChat` for Skippy's chat, #224); system rules that say the blocks are data; constant system prompts; owner-only input for the builder (`scripts/foundry-issue.sh`, #59); world trail steps only from trusted authors (`TRAIL_AUTHORS`); the builder guard (`.claude/hooks/`, #119); the injection eval suite below",
    residual: "A model can still be talked into odd wording inside the schema; the builder's fence is a script and a rule it follows, not a platform control",
    tracking: "Agents' own identity (R2)",
  },
  {
    id: "LLM02",
    name: "Sensitive Information Disclosure",
    where: "The public Lattice; ideas filed as public issues; pictures",
    controls:
      "Data minimisation (the step never reads bodies or comment words, `api/_world/digest.ts`); `scrub` on all input and output, now also catching full-width, zero-width-split and spelled-out forms; no secrets in git (secret scanning and push protection); the privacy check on Desk text before it is posted (`privateParts` in `api/_privacy.ts`, #127): emails, phone numbers, street addresses, card, bank and ID numbers, keys, tokens and passwords, and names with a cue are held back whole, nothing sent, and the same check runs on messages to Skippy before Claude sees them (#224); idea pictures stay in the private store, named in the issue but never linked, and served only on short-lived signed links (`api/_pictures.ts`); the whole site behind the Desk passkey once Nikita locks it (#236, #238)",
    residual: "The privacy check reads patterns: a detail without a cue, or one written around them, still goes public as written; pictures are never read for what they show",
    tracking: "Shipped: privacy guard before posting (#127)",
  },
  {
    id: "LLM03",
    name: "Supply Chain",
    where: "npm packages, GitHub Actions, the Claude SDK",
    controls:
      "Lockfile with `npm ci`; `npm audit signatures` and `npm audit --audit-level=high` in checks; dependency review; Dependabot; actions pinned to SHAs; CodeQL; OpenSSF Scorecard (#64, #67); the Azure deploy signs in with OIDC from the `azure` environment, which only `main` may use (#218)",
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
    where: "Rivet's card written into an issue body the Desk and the world step parse; world text shown on the Lattice; Gemini's findings written into a fix issue",
    controls:
      "Schema with `additionalProperties: false`; enums for builder, model, size, agents, rooms and kinds; `plainLine` strips pictures, links, HTML and markdown markers from card text so it can't fake a `**Builder:**` line or call out to another host; `plainText` does the same for Visual QA findings, which CI files under its own card lines; length caps everywhere; React escapes all model text; no HTML sinks in the front end; the Desk's card reader shows pictures only from Nikita's own store, through its own picture function (`ownPictures`, #127)",
    residual: "A model can still word a card oddly inside the schema; an enforcing CSP and security headers (#62) back up the reader",
    tracking: "Shipped: the Desk shows only its own pictures (#127)",
  },
  {
    id: "LLM06",
    name: "Excessive Agency",
    where: "The builder session (shell, git, merges); Rivet; the world step; Skippy's chat",
    controls:
      "Rivet, the world step and Skippy's chat have no tools at all: they return JSON only; Skippy's actions are a closed set of suggestions (file an idea, answer Rivet, open a page, enter the Lattice) that only Nikita's tap sends, through the Desk's own buttons, re-checked in code (`readReply`, #224); labels that start a build come only from Nikita's Build choice; checks, scans and the ruleset definitions for `main` (#60, #66); CODEOWNERS on the trust boundary (inert until code-owner review is turned on); the crew's GitHub App for the Desk's functions and CI's issue writes, with hour-long tokens for this repo only and no Administration or Workflows permission (`api/_github.ts`, #138); the builder guard, a hook that denies risky commands and secrets files before they run and logs every tool call on the machine (`.claude/hooks/`, #119)",
    residual: "The builder's Claude Code sessions still act as Nikita on GitHub (their access comes from the environment, not from the repo), and its guard is a deny list, not a sandbox, so some of its limits are still rules it follows",
    tracking: "Agents' own identity (R2)",
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
    controls: "Not applicable today; the Relay privacy spec (docs/RELAY-PRIVACY.md) rules out embeddings, vector stores and search indexes over messages until it is changed",
    residual: "If Relay adds retrieval over messages, this becomes live",
    tracking: "Relay privacy spec (R5, shipped #149)",
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
    where: "Claude spend; Gemini speech and Visual QA spend; GitHub token quota; function CPU",
    controls:
      "Coded budget guard for the world step (`api/_world/budget.ts`); Skippy's chat has its own share of the month and a check against the whole cap before every call, and a per-passkey pace (`api/_skippy/budget.ts`, `api/_skippy/limits.ts`, #224); Gemini's own coded monthly cap and one story per day, made once (`api/_world/story.ts`); per-run and per-day caps for Visual QA (`api/_visualqa/review.ts`); provider-side monthly cap; `max_tokens` on every call; note and output length caps; feed cache hardening (#63); `scrub` now linear on long input (bounded patterns, titles cut before scrubbing)",
    residual: "The world step's trigger stays open on purpose: calling it more often changes nothing, so the 55-minute spacing and the monthly budget guard bound the spend, and a key was left out",
    tracking: "Covered: 55-minute spacing and the monthly budget guard (closed #171)",
  },
];

/** Google SAIF's six core elements, as mapped in the doc. */
export const SAIF: { element: string; inCeo: string }[] = [
  {
    element: "Expand strong security foundations to the AI ecosystem",
    inCeo: "Secrets only in Vercel, Actions secrets and Azure Key Vault; Azure deploys sign in with OIDC, with no stored key (#218); pinned and signed supply chain; CodeQL and dependency review on agent-written code like any other; an enforcing CSP and security headers (#62)",
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
  { id: "R1", item: "Builder permission hook: narrow shell permissions, deny risky commands, log every tool call", closes: "Excessive agency (agent half)", status: "Shipped #119" },
  {
    id: "R2",
    item: "The agents' own identity (a GitHub App with short-lived tokens; DELIVERY.md, section 10)",
    closes: "Agents acting as Nikita; previews and audit",
    status: "Built #138, live once Nikita sets up the App; open: the Claude Code sessions still act as Nikita",
  },
  { id: "R3", item: "Real Desk sign-in (passkey, short session, rate limits)", closes: "The static Desk key", status: "Shipped #132" },
  {
    id: "R4",
    item: "Privacy guard before posting (check Desk text before it goes public, signed picture links, Desk shows own pictures only)",
    closes: "Desk text and pictures going public",
    status: "Shipped #127",
  },
  {
    id: "R5",
    item: "Relay privacy spec before the hub is built (what stays on the Mac, what OpenAI and the site may see, retention, the wipe; a counts-only check on the site boundary)",
    closes: "Messages and contacts",
    status: "Shipped #149",
  },
  { id: "R6", item: "Key the world step and cap it per hour", closes: "World spend", status: "Shipped #171: covered by the 55-minute spacing and the monthly budget guard; no key needed" },
  {
    id: "R7",
    item: "A lock on the whole site (one Desk passkey sign-in per device, no password, machine callers on their own keys, a second step such as approving a new device later)",
    closes: "The site being public",
    status: "Built #236 and #238 (passkey only), on once Nikita locks it from the Desk; open: Azure's static files, the second step",
  },
];

/** Whether a roadmap row is done: the "Shipped" row, or a numbered item whose status reads "Shipped #…". */
export function isShipped(r: { id: string; status: string }): boolean {
  return r.id === "Shipped" || /^Shipped\b/.test(r.status);
}

export type EvalAreaId = "rivet-prompt" | "rivet-answer" | "desk-write" | "world-step" | "builder-input" | "skippy-chat";

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
      "With GitHub and Claude stubbed: clicks without a sign-in session touch nothing; a proposed or revised idea never gets `foundry:build`; Stop works only on an open `foundry:auto` build and only sends it back to an idea; Undo works only on a closed, shipped change not already being undone, and only reopens it in the fix lane; foreign picture links are dropped, and the Desk shows only its own pictures; text that looks private is held back before GitHub or Claude hear of it; pictures go into the issue as names and reach Rivet only on short-lived signed links; oversized notes are capped; forged choices and issue numbers are refused; requests go only to the repo's API",
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
    proves: "With a stub `gh`: an outsider's and look-alike accounts' text never appears (look-alikes of the crew's App too), exit code 3, a spoofed closing marker closes nothing, owner, CI and the crew's App's text sit in their blocks",
  },
  {
    id: "skippy-chat",
    area: "Skippy's chat",
    file: "skippy.test.ts",
    proves:
      'For 12 hostile messages (direct, "ignore previous", delimiter spoofing in six forms, ASCII smuggling, a fake action, a fake tool call, markdown exfiltration), the message and the history stay in their own blocks and the system rules stay the same; the real call sends the rules as the system prompt and the message only as user data, with a closed schema and a token cap; a web lookup runs in its own call with web search only (at most three searches), sees only a private-checked query, and comes back fenced in <web>, links stripped; Opus 5.5 only when Sonnet asks to go deeper, each call counted at its own price; hostile answers lose actions outside the set, links, markup, answers to questions nobody asked, private drafts and anything past the caps; no session, another site, private text, a spent budget, an unreadable ledger or a flood each stop the chat before Claude hears anything; a hostile or made-up room tag is filed under none, and the room log (#273) gives a read without a passkey session, or from another site, nothing, the Exchange\'s and Relay\'s asks included',
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
