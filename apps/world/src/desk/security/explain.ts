import type { SecurityFeed } from "./feed.ts";
import type { EvalAreaId } from "./model.ts";

/**
 * What each item on Systems > Security and Systems > Compliance is, in plain English (issue #90): the pop-over that
 * opens when you hover, focus or tap it. Each says what the thing is, which part of C.E.O. it touches, and why it
 * matters. The facts come from docs/THREAT-MODEL.md, docs/SECURITY.md, docs/FOUNDRY.md and the code, and the
 * framework lines from the public definitions (OWASP, NIST, Google, OpenSSF). No status lives here (the pages show
 * that from the doc and the live feed), and nothing about an open hole beyond what the threat model already says.
 * explain.test.ts fails if anything the pages show has no entry.
 */

export interface Explain {
  /** What it is. */
  what: string;
  /** Which part of C.E.O. it touches. */
  connects: string;
  /** Why it matters. */
  why: string;
}

export type ScanId = SecurityFeed["workflows"][number]["id"];

/** The five scan tiles. */
export const SCAN_EXPLAIN: Record<ScanId, Explain> = {
  checks: {
    what: "The main test run: typecheck, lint, unit tests (the injection evals among them) and a full build, plus a check of every package's signature and known vulnerabilities.",
    connects: "Every pull request and every push to main. A failure on main opens a Foundry fix issue by itself.",
    why: "Whatever lands on main is live in minutes, so this is the gate that keeps broken or tampered code from shipping.",
  },
  codeql: {
    what: "GitHub's code scanner. It reads the TypeScript, JavaScript and workflow files looking for security bugs and code quality problems.",
    connects: "Pushes to main, pull requests and a weekly run. Findings go to the repo's Security tab and onto the changed lines of a pull request.",
    why: "Much of C.E.O. is written by agents, and CodeQL reads their code with the same eyes as anyone's.",
  },
  scorecard: {
    what: "OpenSSF Scorecard, a free outside scanner that grades how the repo itself is run rather than the code in it.",
    connects: "Pushes to main and a weekly run. It looks at the workflows, the rules on main, Dependabot and the security policy.",
    why: "Good code can still be shipped by a sloppy process; this is the one check that looks at the process.",
  },
  "dependency-review": {
    what: "A pull request check that lists the packages and actions a change adds or bumps, and fails on a known high or critical vulnerability.",
    connects: "Every pull request, including the upkeep lane's one-at-a-time package bumps.",
    why: "It stops a vulnerable package before it is installed, rather than flagging it after it's live.",
  },
  e2e: {
    what: "The browser tests: the built site opened in a headless Chromium, clicking through the Lattice and the Desk.",
    connects: "Nightly on main, on demand, and on a pull request labelled e2e. They also check that the security headers block nothing the site really loads.",
    why: "Unit tests can pass while the page itself is broken; these see what a visitor sees.",
  },
};

/** The four numbers at the top of Security. */
export type StatId = "passing" | "scorecard" | "evals" | "risks";
export const STAT_EXPLAIN: Record<StatId, Explain> = {
  passing: {
    what: "How many of the scans passed on their last run, out of those that have reported one.",
    connects: "The scan tiles below, read live from GitHub Actions.",
    why: "One number to tell at a glance whether the gates on main are green.",
  },
  scorecard: {
    what: "The OpenSSF Scorecard's overall grade for the repo, out of 10.",
    connects: "The Scorecard panel below, which breaks it down check by check.",
    why: "It tracks how well the repo follows supply-chain good practice, which matters most when agents write the code.",
  },
  evals: {
    what: "How many prompt-injection and data-leak test cases the eval suite runs, and how many pass.",
    connects: "Rivet, the world step and the builder's issue reader, the three places outside text reaches a model or an agent.",
    why: "It proves the defences hold against known attacks on every build; a known gap stays visible as expected-fail until it's fixed.",
  },
  risks: {
    what: "How many of the OWASP Top 10 risks for LLM apps the threat model lists as open, with a tracked fix.",
    connects: "The open risks and roadmap below, and the full mapping on the Compliance page.",
    why: "It's an honest count of what isn't closed yet, so nothing hides behind green scan results.",
  },
};

/** The repo's security switches, by the feed's feature id. */
export const FEATURE_EXPLAIN: Record<string, Explain> = {
  "secret-scanning": {
    what: "GitHub watches every push for keys and tokens committed by mistake.",
    connects: "The whole repo. C.E.O.'s real keys live only in Vercel's environment, never in git.",
    why: "The repo is public, so a leaked key would be readable by anyone within seconds.",
  },
  "push-protection": {
    what: "The stricter half of secret scanning: a push that contains a recognised key is blocked before it lands.",
    connects: "Every push, by Nikita or by the Foundry's agents.",
    why: "Blocking a leak beats finding one, because a public key has to be rotated the moment it's out.",
  },
  "dependabot-alerts": {
    what: "GitHub flags any package C.E.O. depends on that has a published vulnerability.",
    connects: "The npm packages in the lockfile and the GitHub Actions the workflows use.",
    why: "Most code that runs in C.E.O. is other people's; this is how we hear when some of it turns out to be unsafe.",
  },
  "dependabot-updates": {
    what: "Dependabot opens a pull request that bumps a vulnerable package to a fixed version.",
    connects: "The same packages and actions, through pull requests labelled dependencies that go through Checks.",
    why: "It turns an alert into a ready fix, so a known hole doesn't sit waiting.",
  },
  "private-reporting": {
    what: "Lets anyone report a vulnerability privately through the repo's Security tab instead of a public issue.",
    connects: "The security policy, which asks reporters to use it.",
    why: "On a public repo, a public bug report would show attackers the hole before it's fixed.",
  },
};

/** A switch the feed adds before this list knows it: the general point, never a guess at what it does. */
export function featureExplain(id: string): Explain {
  return (
    FEATURE_EXPLAIN[id] ?? {
      what: "One of GitHub's security settings for the repo.",
      connects: "The repo on GitHub; the Security tab shows the detail.",
      why: "Each switch closes one way for a mistake or an attacker to get in.",
    }
  );
}

/** The two alert counts. Counts only: the page never shows an open alert's details. */
export const ALERT_EXPLAIN: Record<keyof SecurityFeed["alerts"], Explain> = {
  codeScanning: {
    what: "How many findings from CodeQL and Scorecard are open and how many were fixed.",
    connects: "The repo's Security tab, where the details stay; this page shows only the counts.",
    why: "A rising open count means fixes are falling behind the scans.",
  },
  dependabot: {
    what: "How many vulnerable-package alerts are open and how many were fixed.",
    connects: "The npm packages and GitHub Actions C.E.O. depends on.",
    why: "Each open one is a known weakness in code C.E.O. runs, until it's bumped.",
  },
};

/**
 * OpenSSF Scorecard's checks, by the name Scorecard gives them. A check Scorecard adds later still shows, with its
 * own one-line description (scorecardFallback).
 */
export const SCORECARD_EXPLAIN: Record<string, Explain> = {
  "Binary-Artifacts": {
    what: "Looks for compiled programs checked into the repo, which can't be reviewed like source code.",
    connects: "Everything checked into the repo.",
    why: "A binary could hide anything; source can be read and scanned.",
  },
  "Branch-Protection": {
    what: "Checks whether main is protected by rules: no force-pushes, required checks, reviews.",
    connects: "main, which Vercel builds production from, and the rulesets defined for it.",
    why: "Whatever lands on main goes live, so the rules on it are the last line before production.",
  },
  "CI-Tests": {
    what: "Checks that changes run automated tests before they merge.",
    connects: "The Checks workflow on pull requests.",
    why: "Tests catch breakage before users do.",
  },
  "CII-Best-Practices": {
    what: "Checks whether the project holds an OpenSSF Best Practices badge, a self-assessment of how it's run.",
    connects: "The project as a whole.",
    why: "The badge is a public signal of good process; it's a lower priority for a one-owner app than for a library.",
  },
  "Code-Review": {
    what: "Checks how often changes are reviewed by a person before they merge.",
    connects: "Pull requests into main, where the Foundry's work lands.",
    why: "A second pair of eyes catches what the author, human or agent, missed.",
  },
  Contributors: {
    what: "Counts contributors from different organisations, as a sign of a wider community.",
    connects: "Who commits to the repo.",
    why: "It matters for shared libraries; a personal app with an agent crew scores low here by nature.",
  },
  "Dangerous-Workflow": {
    what: "Looks for GitHub Actions patterns that let outside pull requests run code with the repo's secrets.",
    connects: "The workflows in the repo.",
    why: "A dangerous workflow can hand an attacker the repo's tokens.",
  },
  "Dependency-Update-Tool": {
    what: "Checks that a tool keeps dependencies up to date.",
    connects: "Dependabot, which proposes package and action bumps.",
    why: "Old packages collect known vulnerabilities.",
  },
  Fuzzing: {
    what: "Checks whether the code is fuzzed: fed huge amounts of random input to find crashes.",
    connects: "C.E.O.'s input handling. Its injection eval suite tests known hostile inputs instead, which is not a fuzzer.",
    why: "Fuzzing finds the bugs nobody thought to test for.",
  },
  License: {
    what: "Checks that the repo declares a licence.",
    connects: "The repo's licence file.",
    why: "It tells others what they may do with the code.",
  },
  Maintained: {
    what: "Checks for recent commits and issue activity over the last 90 days.",
    connects: "The repo's history, which the Foundry adds to as it ships.",
    why: "An abandoned project stops getting security fixes.",
  },
  Packaging: {
    what: "Checks whether the project publishes packages through an automated workflow.",
    connects: "Package publishing. C.E.O. is a deployed web app, not a published package.",
    why: "Automated publishing is harder to tamper with than a release built on someone's laptop.",
  },
  "Pinned-Dependencies": {
    what: "Checks that workflows and builds use exact, pinned versions rather than moving tags.",
    connects: "The GitHub Actions, each pinned to a full commit SHA, and the npm lockfile.",
    why: "A moved tag can silently change what runs; a pinned SHA can't.",
  },
  SAST: {
    what: "Checks that a static analysis tool scans the code on every change.",
    connects: "CodeQL, which scans every push to main and every pull request.",
    why: "It finds security bugs in code before it runs.",
  },
  SBOM: {
    what: "Checks whether the project publishes a software bill of materials, a list of everything it's built from.",
    connects: "C.E.O.'s dependencies, which the lockfile records.",
    why: "An SBOM lets others check quickly whether they're exposed when a package turns out to be bad.",
  },
  "Security-Policy": {
    what: "Checks for a security policy telling people how to report a vulnerability.",
    connects: "The repo's SECURITY.md, which points to private reporting.",
    why: "Without one, a finder might post the hole in public.",
  },
  "Signed-Releases": {
    what: "Checks that published releases are cryptographically signed.",
    connects: "GitHub releases. C.E.O. ships by deploying main to Vercel rather than cutting releases.",
    why: "A signature proves a download is the one the project made.",
  },
  "Token-Permissions": {
    what: "Checks that workflows start with read-only tokens and grant write access only where needed.",
    connects: "The GitHub Actions workflows, which each start read-only.",
    why: "If a step is ever compromised, a read-only token limits what it can do.",
  },
  Vulnerabilities: {
    what: "Checks the project's dependencies against the public database of known vulnerabilities.",
    connects: "The packages in the lockfile, the same ones Dependabot and npm audit watch.",
    why: "A known vulnerability is the easiest kind for an attacker to use.",
  },
  Webhooks: {
    what: "Checks that any webhooks the repo sends are protected with a secret.",
    connects: "The repo's webhook settings.",
    why: "An unprotected webhook can be spoofed.",
  },
};

/** A Scorecard check the list above doesn't know yet: Scorecard's own one-liner, and the general point. */
export function scorecardExplain(name: string, short: string): Explain {
  return (
    SCORECARD_EXPLAIN[name] ?? {
      what: short || "One of OpenSSF Scorecard's checks on how the repo is run.",
      connects: "How the repo is run on GitHub.",
      why: "Each check is one piece of supply-chain good practice; together they make the overall score.",
    }
  );
}

/** The OWASP Top 10 for LLM Applications (2025), by risk id: the public definition and where it sits in C.E.O. */
export const OWASP_EXPLAIN: Record<string, Explain> = {
  LLM01: {
    what: "Text that tricks a model into ignoring its instructions, either typed straight in or hidden inside content it reads.",
    connects: "Rivet reading Nikita's ideas, the world step reading issue titles, and the builder reading issues.",
    why: "C.E.O. feeds outside text to models and to agents that write code, so this is the risk the eval suite is built around.",
  },
  LLM02: {
    what: "A model or app revealing private data it shouldn't: keys, personal details, private words.",
    connects: "The public Lattice, ideas filed as public issues, and pictures sent from the Desk.",
    why: "The repo and the Lattice are public, so anything that slips out is out for good.",
  },
  LLM03: {
    what: "Weak links in the third-party code, models and tools an AI app is built from.",
    connects: "npm packages, GitHub Actions and the Claude SDK.",
    why: "A poisoned package runs with the same power as C.E.O.'s own code.",
  },
  LLM04: {
    what: "Bad data slipped into what a model learns from or reads back, to skew what it says.",
    connects: "C.E.O. trains no models; the world step reads back its own last few hours.",
    why: "One bad hour of history could echo into the next ones if it weren't re-checked.",
  },
  LLM05: {
    what: "Trusting a model's answer too much: passing it on as code, HTML or commands without checking it.",
    connects: "Rivet's card written into an issue, and world text shown on the Lattice.",
    why: "A model's answer is untrusted input; treated as safe, it could inject links or fake fields.",
  },
  LLM06: {
    what: "Giving a model or agent more tools, permissions or freedom than its job needs.",
    connects: "The builder session, which has a shell, git and merges; Rivet and the world step have no tools at all.",
    why: "An agent that can push code can do real damage if it's misled, so its limits matter more than any model's.",
  },
  LLM07: {
    what: "A model's hidden instructions leaking, and with them any secrets or rules they hold.",
    connects: "Rivet's and the world step's prompts, which are public in the repo by design.",
    why: "Security that relies on a secret prompt breaks the moment it leaks; C.E.O.'s relies on code checks instead.",
  },
  LLM08: {
    what: "Weaknesses in retrieval: the vector stores and embeddings that let a model look things up.",
    connects: "Nothing yet. C.E.O. has no retrieval; Relay could add it over messages.",
    why: "If retrieval arrives over private messages, it becomes a way to leak or poison them.",
  },
  LLM09: {
    what: "A model stating false or misleading things with confidence.",
    connects: "The Historian's hourly summaries on the Lattice and Rivet's pitches on the Desk.",
    why: "People act on what they read; here a person approves every card and the Lattice is labelled as a story.",
  },
  LLM10: {
    what: "A model or app being run so much that it burns money, quota or compute.",
    connects: "Claude spend, the GitHub token's quota, and the functions' CPU.",
    why: "Every call costs money, and a runaway loop or a flood of requests could run up the bill or lock the Desk out.",
  },
};

/** The roadmap rows, by id. */
export const ROADMAP_EXPLAIN: Record<string, Explain> = {
  Shipped: {
    what: "Rules the site sends with every page that tell the browser what it may load and run, and stop it being framed.",
    connects: "Every page of the Desk and the Lattice, served from Vercel.",
    why: "If a stray script ever got into a page, the browser would refuse to run it.",
  },
  R1: {
    what: "A hook that checks every command and file the builder touches before it runs: risky commands and key files are denied, and every tool call is logged on the machine.",
    connects: "The Foundry's Claude Code sessions, the builder and its workers.",
    why: "The builder's worst slips (wiping a folder, pushing to main, printing a key, changing the repo's protection) are now rules it can't break, not only rules it follows.",
  },
  R2: {
    what: "A GitHub App for the crew, ceo-foundry, whose tokens last an hour and reach only this repo, so the Desk's buttons, the feeds and CI's fix issues act as the Foundry rather than as Nikita. It can't touch settings or workflows.",
    connects: "The Desk's functions and CI today, once Nikita sets the App up. The Claude Code sessions' pushes and merges still use Nikita's access, which their environment sets, not the repo.",
    why: "Separate identities make the agents' actions auditable and let the repo's rules treat them differently, and a token that leaks is useless within the hour.",
  },
  R3: {
    what: "A real sign-in for the Desk: a passkey on Nikita's PC or phone, a session that lasts 30 minutes from its last use and 12 hours at most, and wrong tries slowed down, then locked out.",
    connects: "The Desk's buttons, picture uploads and the day's story, which used to take one typed key and now need a passkey session.",
    why: "The Desk is the approval gate for every build; the old key is now only for enrolling a new device, and never stays in the browser.",
  },
  R4: {
    what: "A check that reads Desk text before it is posted and holds back emails, phone numbers, addresses, card and account numbers, keys and names. Idea pictures stay private, on links that last minutes.",
    connects: "Ideas, notes and answers filed as public issues, the pictures attached to them, and the Desk's idea cards.",
    why: "What Nikita types or dictates would otherwise go public as written; now a slip is caught before it does, and the Desk shows only Nikita's own pictures.",
  },
  R5: {
    what: "A privacy spec for Relay written before its hub is built.",
    connects: "Relay, the planned hub that will read messages and contacts.",
    why: "Messages are the most sensitive data C.E.O. will touch, so the rules come first.",
  },
  R6: {
    what: "A key on the world step's trigger and a cap on how often it can run each hour.",
    connects: "The hourly world step that writes the Lattice's history with Claude.",
    why: "It bounds what the world step can spend.",
  },
};

/** The eval suite's areas. */
export const EVAL_EXPLAIN: Record<EvalAreaId, Explain> = {
  "rivet-prompt": {
    what: "Known prompt-injection payloads thrown at the prompt Rivet builds from an idea.",
    connects: "Rivet, the Haiku model that shapes Nikita's ideas into cards on the Desk.",
    why: "It proves the idea always stays fenced in as data, however it's dressed up.",
  },
  "rivet-answer": {
    what: "Hostile answers, as if Rivet had been fooled, fed to the code that reads its cards.",
    connects: "The code between Rivet and GitHub issues.",
    why: "Even if the model is tricked, its answer can't add labels, links or fields.",
  },
  "desk-write": {
    what: "Forged and oversized requests sent to the Desk's write path, with GitHub and Claude stubbed out.",
    connects: "The Desk's buttons and the function behind them.",
    why: "It proves a click without a sign-in session touches nothing and an idea can't start a build without Nikita's choice.",
  },
  "world-step": {
    what: "Hostile issue titles, stranger comments and bad answers run through the hourly world step.",
    connects: "The world step that writes the public Lattice's history.",
    why: "The Lattice is public, so what it saves has to stay clean of injected text and secrets.",
  },
  "builder-input": {
    what: "Text from outsiders and look-alike accounts fed to the script the builder reads issues through.",
    connects: "The Foundry's builder, which reads GitHub issues before it writes code.",
    why: "Anyone can comment on a public issue; only the owner's words should steer an agent that writes code.",
  },
};

/** The NIST AI Risk Management Framework's four functions. */
export const NIST_EXPLAIN: Record<"Govern" | "Map" | "Measure" | "Manage", Explain> = {
  Govern: {
    what: "NIST's function for culture and accountability: who decides, which policies apply, who answers for AI risk.",
    connects: "Nikita's approval of every build, the written chain of who decides, and the security review.",
    why: "Without clear ownership, the other three functions have no one to act on them.",
  },
  Map: {
    what: "NIST's function for understanding the context: what the AI system does, where, and what could go wrong.",
    connects: "The data flow, trust boundaries and the OWASP mapping on these pages.",
    why: "You can't defend what you haven't drawn.",
  },
  Measure: {
    what: "NIST's function for testing and tracking AI risk with numbers.",
    connects: "The injection eval counts, Scorecard, and spend per call on the Trail.",
    why: "Measurement shows whether the controls really work, not just that they exist.",
  },
  Manage: {
    what: "NIST's function for acting on risk: prioritising it, treating it and keeping watch.",
    connects: "The controls for each risk, the residual risks and the roadmap.",
    why: "It turns what's been mapped and measured into fixes, in order.",
  },
};

/** Google's Secure AI Framework (SAIF), by its six core elements. */
export const SAIF_EXPLAIN: Record<string, Explain> = {
  "Expand strong security foundations to the AI ecosystem": {
    what: "Apply proven security basics, like secrets handling and supply-chain checks, to AI systems too.",
    connects: "Vercel-held secrets, the pinned and signed supply chain, CodeQL and the security headers.",
    why: "AI apps are still apps: most attacks on them use old tricks.",
  },
  "Extend detection and response": {
    what: "Watch AI systems for trouble and be ready to respond, as you would any system.",
    connects: "The Trail on every issue, the fix issue opened when Checks fails on main, and the Security tab.",
    why: "Some attacks will get through; noticing them fast limits the damage.",
  },
  "Automate defenses": {
    what: "Use automation to keep pace with threats, since AI-driven attacks scale.",
    connects: "The eval suite on every build, schema-checked model answers, Dependabot and secret scanning.",
    why: "Checks that run by themselves on every change don't depend on anyone remembering.",
  },
  "Harmonize platform controls": {
    what: "Use the same controls across the platform, so no path into production is weaker than the others.",
    connects: "One delivery path for every change, the rules for main, and least-privilege workflows.",
    why: "An attacker looks for the one side door; one path means there isn't one.",
  },
  "Adapt controls": {
    what: "Keep tuning defences as you learn, through testing and feedback.",
    connects: "Review findings turned into carded fixes with tests, and an eval suite that grows with new payloads.",
    why: "Attacks on models change fast, so a frozen defence goes stale.",
  },
  "Contextualize AI system risks": {
    what: "Judge AI risk within the business process it sits in, not in isolation.",
    connects: "The threat model, which maps each model risk to ideas, builds, the public world and messages.",
    why: "The same model risk matters more where it can push code or reach private data.",
  },
};

/** The four framework cards at the top of Compliance. */
export type FrameId = "owasp" | "nist" | "saif" | "regulation";
export const FRAME_EXPLAIN: Record<FrameId, Explain> = {
  owasp: {
    what: "The Open Worldwide Application Security Project's list of the ten most critical risks for apps built on large language models, 2025 edition.",
    connects: "Rivet, the world step and the Foundry's builder: everywhere C.E.O. puts a model or an agent to work.",
    why: "It's the most widely used checklist for LLM app security, so mapping to it shows nothing obvious was skipped.",
  },
  nist: {
    what: "The US National Institute of Standards and Technology's voluntary AI Risk Management Framework, built on four functions.",
    connects: "How C.E.O. decides, maps, measures and manages its AI risks as a whole.",
    why: "It frames AI risk as an ongoing process rather than a one-off checklist.",
  },
  saif: {
    what: "Google's Secure AI Framework: six core elements for building and running AI systems securely.",
    connects: "C.E.O.'s security foundations, detection, automation and delivery path.",
    why: "It ties AI risk back to ordinary security engineering, which is where most of C.E.O.'s controls live.",
  },
  regulation: {
    what: "Laws and formal standards on privacy and AI, such as data-protection law.",
    connects: "Nothing mapped yet. Relay, which will read messages, is where it will matter most.",
    why: "Once C.E.O. handles other people's messages, privacy law applies, so the spec comes before the hub.",
  },
};
