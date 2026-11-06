// The Skippy probe's battery and grading (#955), apart from the runner (scripts/skippy-probe.mjs) so the tests can
// hold it. The upkeep run starts with it: real asks, the way Nikita says them, sent to live Skippy as a dry run
// (api/_skippy/probe.ts: no device moves, nothing is kept, and only a verdict comes back, never the reply's words).
//
// Every run sends every ask the rules answer (no model, so free) and MODEL_PER_RUN of the asks that need a model,
// taking turns by run number, so a run costs a few cents at most and the whole battery is covered every few runs.
// Past Skippy's warn line the server skips the model asks itself.

/** How many model cases a run sends (the rules' cases are free and all go). */
export const MODEL_PER_RUN = 2;

/** Time budgets by who answers, in ms, measured at the probe (network included). */
export const BUDGET_MS = { rules: 8_000, fast: 15_000, talk: 35_000, hard: 60_000, web: 45_000 };

/** The longest reply a spoken surface should get, and a typed one. */
export const MAX_CHARS = { spoken: 420, typed: 900 };

/**
 * The battery. `kind`: a question must only read (nothing written, nothing waiting for a tap); an order must be
 * understood as that very action (`expect`, recorded by the dry run, never sent); a web ask must search. `rules`: the
 * rules tier must answer it (no model). `home`: a home ask, which Skippy answers himself, never hands off. The words
 * are spoken fillers and odd phrasings on purpose. Nothing private: the asks are public in this repo.
 */
export const CASES = [
  // The rules' asks: free, every run.
  { id: "vacuum-schedule", surface: "phone", asks: ["yeah um when's the vacuum's next schedule"], kind: "question", rules: true, home: true },
  { id: "vacuum-schedule-polite", surface: "desk", asks: ["can you tell me what the vacuum cleaner's next schedule is gonna be?"], kind: "question", rules: true, home: true },
  { id: "wet-food-cycle", surface: "phone", asks: ["um so when is the next wet food cycle"], kind: "question", rules: true, home: true },
  { id: "apartment-temp", surface: "call", asks: ["what's the temperature in my apartment"], kind: "question", rules: true, home: true },
  { id: "feed-order-phone", surface: "phone", asks: ["okay feed the cat one portion"], kind: "order", expect: "home.feeder.feed", rules: true, home: true },
  { id: "feed-order-desk", surface: "desk", asks: ["feed the cat one portion"], kind: "order", expect: "home.feeder.feed", rules: true, home: true },
  // The model's asks: MODEL_PER_RUN a run, in turn.
  { id: "web-news", surface: "desk", asks: ["what's the big tech news today?"], kind: "web" },
  { id: "follow-up", surface: "desk", asks: ["who won the last Super Bowl?", "and who did they beat?"], kind: "question" },
  { id: "odd-litter", surface: "phone", asks: ["skippy my guy, the litter thing, has it like, done its business today"], kind: "question", home: true },
  { id: "lights-question", surface: "call", asks: ["are any of the lights on right now"], kind: "question", home: true },
  { id: "odd-plate", surface: "phone", asks: ["uh so what's, um, on my plate today, like the big stuff"], kind: "question" },
  { id: "foundry-fire", surface: "desk", asks: ["anything on fire in the foundry right now?"], kind: "question" },
  { id: "call-weather", surface: "call", asks: ["hey so like is it gonna rain in Denver tomorrow or what"], kind: "web" },
];

/** This run's cases: every rules case, then MODEL_PER_RUN model cases in turn by run number. */
export function pickCases(run, cases = CASES, perRun = MODEL_PER_RUN) {
  const free = cases.filter((c) => c.rules);
  const paid = cases.filter((c) => !c.rules);
  const n = Number.isFinite(run) && run > 0 ? Math.floor(run) : 0;
  const picked = [];
  for (let i = 0; i < Math.min(perRun, paid.length); i++) picked.push(paid[(n * perRun + i) % paid.length]);
  return [...free, ...picked];
}

const spoken = (surface) => surface !== "desk";

/**
 * One turn's failures by the fixed rules, as short ids. `turn` is what api/_skippy/probe.ts sends back for one ask,
 * `ms` the time the probe measured, `first` whether this is the case's first ask (an order's or a web ask's
 * expectation is on its first ask; the rest is on every ask).
 */
export function gradeTurn(c, turn, ms, first = true) {
  const fails = [];
  if (!turn || typeof turn !== "object") return ["no-answer"];
  if (turn.skipped || turn.capped || turn.error === "slow-down") return [];
  if (turn.status !== 200 || turn.error) return [`error:${turn.error ?? turn.status}`];
  for (const f of Array.isArray(turn.flags) ? turn.flags : []) fails.push(`said:${f}`);
  const wrote = (turn.wouldRun?.length ?? 0) + (turn.wrote?.length ?? 0) + (turn.taps ?? 0);
  if (c.kind !== "order" && wrote > 0) fails.push("acted-on-a-question");
  if (c.kind === "order" && first && !(turn.wouldRun ?? []).includes(c.expect)) fails.push("order-not-understood");
  if (c.kind === "order" && first && (turn.wouldRun ?? []).some((w) => w !== c.expect)) fails.push("order-did-more");
  if (c.kind === "web" && first && !(turn.looked ?? []).includes("web")) fails.push("no-web-search");
  if (c.rules && turn.tier !== "rules") fails.push(`not-rules-tier:${turn.tier ?? "none"}`);
  if (c.home && turn.handedOff) fails.push("handed-off-a-home-ask");
  const budget = c.rules ? BUDGET_MS.rules : c.kind === "web" ? BUDGET_MS.web : (BUDGET_MS[turn.tier] ?? BUDGET_MS.talk);
  if (ms > budget) fails.push(`slow:${Math.round(ms / 100) / 10}s>${budget / 1000}s`);
  const max = spoken(c.surface) ? MAX_CHARS.spoken : MAX_CHARS.typed;
  if ((turn.chars ?? 0) > max) fails.push(`long:${turn.chars}>${max}`);
  return fails;
}

/** A case's verdict from the server's turns and the probe's timing: pass, fail (with ids), or skipped. */
export function gradeCase(c, turns, ms) {
  if (!Array.isArray(turns) || !turns.length) return { id: c.id, surface: c.surface, verdict: "fail", fails: ["no-answer"], ms };
  const skipped = turns.find((t) => t.skipped || t.capped || t.error === "slow-down");
  if (skipped) return { id: c.id, surface: c.surface, verdict: "skipped", why: skipped.skipped ?? (skipped.capped ? "capped" : "slow-down"), ms };
  // One ask is timed at the probe (network included); a follow-up's asks each by the server's own time.
  const per = turns.map((t, i) => gradeTurn(c, t, turns.length === 1 ? ms : (t.ms ?? 0), i === 0));
  const fails = [...new Set(per.flatMap((f, i) => f.map((x) => (turns.length > 1 ? `ask${i + 1}:${x}` : x))))];
  if (turns.length < c.asks.length && !fails.length) fails.push(`stopped-after-ask${turns.length}`);
  const last = turns[turns.length - 1];
  return { id: c.id, surface: c.surface, verdict: fails.length ? "fail" : "pass", fails, ms, tier: last.tier, chars: last.chars };
}

/** The run's summary as Markdown: one row per case, no reply text (there is none to show). */
export function summary(results, run) {
  const pass = results.filter((r) => r.verdict === "pass").length;
  const fail = results.filter((r) => r.verdict === "fail").length;
  const skip = results.filter((r) => r.verdict === "skipped").length;
  const rows = results.map((r) => `| \`${r.id}\` | ${r.surface} | ${r.verdict === "pass" ? "pass" : r.verdict === "fail" ? "**fail**" : `skipped (${r.why})`} | ${(r.ms / 1000).toFixed(1)} s | ${r.tier ?? ""} | ${(r.fails ?? []).map((f) => `\`${f}\``).join(" ")} |`);
  return [`### Skippy probe${run ? `, run ${run}` : ""}`, "", `${pass} passed, ${fail} failed, ${skip} skipped.`, "", "| Case | Surface | Verdict | Time | Tier | Failed rules |", "| --- | --- | --- | --- | --- | --- |", ...rows, ""].join("\n");
}

/** The words for the Foundry fix: which cases failed which rules, with the asks (public) and never a reply. */
export function failureBody(results, runUrl) {
  const failed = results.filter((r) => r.verdict === "fail");
  const lines = failed.map((r) => {
    const c = CASES.find((x) => x.id === r.id);
    const asks = c ? c.asks.map((a) => `"${a}"`).join(" then ") : "";
    return `- \`${r.id}\` (${r.surface}${c?.kind ? `, ${c.kind}` : ""}): ${asks}. Failed: ${r.fails.map((f) => `\`${f}\``).join(", ")}. ${(r.ms / 1000).toFixed(1)} s${r.tier ? `, tier ${r.tier}` : ""}.`;
  });
  return [
    `The Skippy probe (#955) found ${failed.length} ask${failed.length === 1 ? "" : "s"} live Skippy got wrong.`,
    "",
    ...lines,
    "",
    `Run: ${runUrl}`,
    "",
    "The rules: `said:<flag>` is a banned phrase (`rephrase`, `sign-in`, `hiccup`, `cant`, `ponder`, `down`, `empty`; api/_skippy/probe.ts `REPLY_RULES`); `acted-on-a-question` means a question would have written or moved something (the dry run stopped it); `order-not-understood` an order that didn't reach its device action; `not-rules-tier` a home ask the rules should answer that went to a model; `slow` and `long` the time and length budgets (scripts/skippy-probe-lib.mjs). The probe never sees Skippy's words, only these verdicts; reproduce on the Desk to read the answer.",
    "",
    "The Foundry picks this up first; see docs/FOUNDRY.md (\"The Skippy probe\").",
  ].join("\n");
}
