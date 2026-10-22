# Threat model

How C.E.O. handles the risks of putting language models and coding agents to work on a public repo: where the
trust boundaries are, what each AI risk looks like here, which control answers it, and what is still open. Issue
#65, from the security review of 2026-10-13 (#58). Status as of 2026-10-14.

This page describes controls and residual risk. Holes that are still open get one plain line and a tracking
reference, never a recipe. To report a vulnerability, use the repo's Security tab (see [SECURITY.md](SECURITY.md)).

The Desk shows this page as data on Systems > Security and Systems > Compliance (`/systems/security`,
`/systems/compliance`, #82), next to the live scan results. The Desk reads its tables from
`apps/world/src/desk/security/model.ts`, which copies them word for word; a test fails when the two drift apart, so
change both together.

## What C.E.O. is, in one paragraph

C.E.O. is a web app on Vercel with two faces: **the Desk**, Nikita's dashboard, and **the Lattice**, a public 3D
world of AI agents. Two models are called from code, both Claude Haiku: **Rivet** shapes an idea Nikita types or
dictates on the Desk into a card (pitch, size, builder), and the **world step** writes one hour of the Lattice's
history from the Foundry's real work (and, once a day, the script of **the day's story**). Google's Gemini is used
twice: **Gemini's text to speech** (#95) turns that script into speech, getting only the script, written from the
already-scrubbed public Chronicle, and returning audio; and **Visual QA** (#91), in CI only, sends a few seconds of
each room of the built Lattice to Gemini after every push to `main`, and CI turns the blockers it flags into fix
issues. Code is written by **the Foundry**, a Claude Code builder session (the Builder,
Skippy's submind) and its workers (Rusty, Rocky), which read GitHub issues, open branches and pull requests, and
ship to `main`, which Vercel deploys to production. **Relay**, a hub on an always-on MacBook that will read
messages, is designed but not built yet; its privacy rules come first, in [RELAY-PRIVACY.md](RELAY-PRIVACY.md).

## Data flow and trust boundaries

```mermaid
flowchart LR
  subgraph PUB["Public internet: untrusted"]
    anyone["Anyone on GitHub<br/>issues and comments"]
    viewer["Lattice viewers"]
  end
  subgraph NIK["Nikita's browser"]
    desk["Desk<br/>passkey session"]
  end
  subgraph VER["Vercel production, built from main"]
    site["Static site<br/>Lattice and Desk"]
    fFoundry["api/foundry<br/>Desk buttons, Rivet"]
    fImage["api/foundry-image"]
    fAuth["api/desk-auth<br/>passkeys, sessions"]
    fPings["api/desk-pings<br/>pings to the phone"]
    fFeed["api/foundry-feed<br/>api/foundry-usage<br/>api/security-feed<br/>api/visual-qa-feed"]
    fStep["api/world-step<br/>api/world<br/>api/day-story"]
  end
  blob[("Vercel Blob<br/>world state, stories, pictures,<br/>passkeys' public keys, ping subscriptions")]
  push["Push services<br/>Apple, Google, Mozilla, Microsoft"]
  claude["Claude API<br/>Haiku"]
  gemini["Gemini API<br/>speech, Visual QA"]
  subgraph GH["GitHub, public repo"]
    issues["Issues, comments, labels"]
    repo["Code and main"]
    actions["Actions: checks, CodeQL,<br/>dependency review, Scorecard,<br/>hourly world-step trigger,<br/>Desk pings trigger, Visual QA"]
  end
  subgraph CC["Claude Code cloud sessions"]
    builder["Builder and workers"]
  end
  subgraph MAC["Relay MacBook, planned"]
    hub["Hub and BlueBubbles<br/>messages, contacts"]
  end
  openai["OpenAI API"]

  desk -- "TB1: ideas, notes, pictures, session" --> fFoundry
  desk -- "TB1: passkey sign-in" --> fAuth
  fAuth --> blob
  desk -- "TB1" --> fImage
  fImage --> blob
  fFoundry -- "TB2: idea in fenced blocks" --> claude
  claude -- "TB2: JSON card, re-checked" --> fFoundry
  fFoundry -- "TB3: Foundry token" --> issues
  anyone -- "TB4: untrusted text" --> issues
  issues -- "TB5: owner text only" --> builder
  builder -- "branches, PRs" --> repo
  repo -- "checks and scans" --> actions
  repo -- "deploy" --> site
  actions -- "hourly POST" --> fStep
  issues -- "titles, trail kinds" --> fStep
  fStep -- "TB2: fenced digest" --> claude
  fStep -- "TB2: scrubbed script" --> gemini
  desk -- "TB1: story backfill, session" --> fStep
  fStep --> blob
  viewer -- "TB6: read only" --> site
  site --> fFeed
  fFeed -- "cached reads" --> issues
  hub -. "TB7: counts and states only" .-> site
  hub -. "drafts" .-> openai
  actions -- "TB8: room clips" --> gemini
  gemini -- "TB8: JSON findings, re-checked" --> actions
  actions -- "fix issues, CI text" --> issues
  desk -- "TB1: push subscription, session" --> fPings
  actions -- "scan, shared secret" --> fPings
  issues -- "labels, read in the function" --> fPings
  fPings --> blob
  fPings -- "encrypted counts only" --> push
  push -- "ping" --> desk
```

| Boundary | What crosses it | Controls |
| --- | --- | --- |
| **TB1** Desk to functions | Nikita's ideas, notes, answers, pictures, button presses, a device's push subscription | A passkey sign-in with the device's own unlock (`api/desk-auth.ts`, #132), then a signed, HttpOnly, SameSite=Strict session cookie that lasts 30 minutes from its last use and 12 hours at most, checked on every write and private read (`requireSession` in `api/_desk/session.ts`); failed sign-ins and enrolments slow down, then lock out (`api/_desk/limits.ts`); the Desk key only enrols a new device and is never kept in the browser; the day's story backfill only for today or yesterday, once each (and once more when the story's style changes, #102); notes capped at 2,000 characters; only open `foundry:idea` issues can be acted on; picture links accepted only from the Desk's own picture function (`readImages`); image types allow-listed, 4 MB cap; Desk text that looks private is held back before it is sent anywhere (`privateParts`, #127); pictures served only on short-lived signed links (`verifyPicture`, #127); a push subscription taken only in a passkey session and only for a known push service (`readSubscription`, #135), dropped on sign-out or when its device is removed, and pinged only while its passkey is enrolled; the scan that sends pings needs the workflow's shared secret (`DESK_PINGS_SECRET`), and a ping carries counts only, never issue text (`pingText` in `api/_desk/pings.ts`) |
| **TB2** Code to the model APIs | Idea text, issue text, the hour's digest, the day's story script; JSON, text or audio back | Untrusted text fenced in tagged data blocks that it can't close (`shapeInput`, `unfence` in `api/foundry.ts`; `fence` in `api/_world/prompt.ts` and `api/_world/story.ts`); the system rules are a constant, never built from input; structured output with a closed JSON schema; every answer re-validated in code (`readShape`, `readAnswer`); Gemini gets only the day's script, written from the already-scrubbed public Chronicle and scrubbed again (`cleanScript`), and its audio is only stored and played, with its key in Vercel and its own monthly cap |
| **TB3** Functions to GitHub | Issue writes with the Foundry token | Token lives only in Vercel; once the crew's GitHub App is set up, the buttons write as `ceo-foundry[bot]` with an hour-long token that can only touch this repo's issues, and the feeds read with a read-only one (`api/_github.ts`, #138); label changes are hard-coded per button, so shaping can never add `foundry:build`; card text is reduced to plain lines before it is written (`plainLine`) |
| **TB4** Public to the repo | Anyone's issues and comments | Labels need a collaborator; the builder reads only owner text (TB5); the world step counts trail steps only from Nikita's account, the Checks bot and the crew's App (`TRAIL_AUTHORS` in `api/_world/digest.ts`) |
| **TB5** Issues to the builder | Work descriptions | `scripts/foundry-issue.sh` (#59): owner, CI and Foundry App text in data blocks with a random tag per read, everything else withheld by name, exit 3 when anything was withheld; worker briefs carry issue text only inside a data block (docs/FOUNDRY.md, "Trusted input") |
| **TB6** The public Lattice | World history, Foundry feed, spend totals, security posture, the latest Visual QA run | Read-only endpoints; the step reads only titles, numbers, labels and trail step kinds, never bodies or comment words; `scrub` on everything in and out; edge cache with canonical URLs (#63); the security feed (`api/security-feed.ts`, #82) returns only pass or fail states, scores, dates and counts, never an open alert's details; the Visual QA feed (`api/visual-qa-feed.ts`, #91) returns only counts, a time, a state and a link to the run |
| **TB7** Relay to the site (planned) | Counts and states, never message text | The Relay privacy spec, docs/RELAY-PRIVACY.md (#149): only `RelayStatus`, an allowlisted shape of counts, enum states and timestamps, checked with `readRelayStatus` (`packages/core/src/relay.ts`) before the hub sends it and again where the site receives it; an unknown key or a free string refuses the whole status; names, previews and drafts never pass through Vercel; design rules in docs/DELIVERY.md, "Environments" |
| **TB8** CI to Gemini | Clips of the public Lattice and the room descriptions; JSON findings back | Only renders of the public Lattice built from `main`, a few seconds a room at low resolution, never live data or secrets (`scripts/room-tour.mjs`); the key is a GitHub Actions secret (`GEMINI_API_KEY`) given only to the review step, sent only to Google's API host and never printed (`redact`); fixed rules that say text in the video is never instructions; structured output re-validated in code (`parseFindings`) and reduced to plain lines (`plainText`) before CI writes an issue in its own words; spend capped per run and per day (`api/_visualqa/review.ts`) |

Code reaches production through its own boundary: a change lands on `main` (by pull request for the Foundry's
lanes, by direct push for chat work today) and Vercel ships it. A second copy on Azure (#214, #216, #218) is
deployed from the same `main` by the "Deploy to Azure" workflow, which signs in with OIDC from the repo's `azure`
environment (only `main` may use it), so no Azure password or key is stored in GitHub. The controls on that path are in
[DELIVERY.md](DELIVERY.md) and [SECURITY.md](SECURITY.md): checks, CodeQL, dependency review, Scorecard, Dependabot,
secret scanning, pinned actions, least-privilege workflows and npm provenance checks (#64, #66, #67).

## Assets

| Asset | Where it lives | Why it matters |
| --- | --- | --- |
| Production code and `main` | GitHub, Vercel | Whatever lands on `main` is live in minutes |
| Claude API key | Vercel environment | Spend (capped at $10 a month at the provider) |
| Gemini API key | Vercel environment (speech) and a GitHub Actions secret (Visual QA), both `GEMINI_API_KEY` | Speech spend (capped in code by `GEMINI_BUDGET_USD`, $5 a month by default, never above $10); Visual QA spend (capped in code at $0.50 a run and eight pushed runs a day) |
| Foundry GitHub token | Vercel environment | Writes issues as Nikita; the fallback until the crew's App is set up (#138), then deleted |
| The crew's App key | Vercel environment (Production only) and a GitHub Actions secret | Mints hour-long tokens for this repo only, as `ceo-foundry[bot]`: issues, pull requests and code, never settings or CI |
| Desk key | Vercel environment only; typed once per device to enrol its passkey (#132) | Enrols a device on the Desk, the human approval gate for builds; the Desk's signing keys are derived from it |
| Desk passkeys | Their private keys stay on Nikita's devices; only the public keys are in Vercel Blob (private) | Sign in to the Desk |
| The Desk's push key (VAPID private key) | Vercel environment only (#135) | Signs pings; with a subscription too, it could put a notification on Nikita's phone, never read anything |
| The pings secret | Vercel environment and a GitHub Actions secret, both `DESK_PINGS_SECRET` | Makes the Desk scan and ping; nothing else |
| Ping subscriptions | Vercel Blob (private), beside the passkeys | Where Nikita's devices get pings; useless without the push key |
| The builder session's GitHub access | Claude Code environment (Nikita's account; set by the environment, not the repo) | Pushes code, merges pull requests |
| The Azure deploy identity (`ceo-github-deploy`) | Microsoft Entra ID, trusted only for GitHub's `azure` environment on `main` (OIDC, no stored key) | Contributor on the Azure copy's resource group and blob writer on its storage: can replace the Azure copy, never Vercel or the subscription |
| The Azure functions' secrets | Azure Key Vault (RBAC), read by the functions' own identity through Key Vault references | The same keys as the Vercel environment, for the Azure copy |
| World state and history | Vercel Blob (private) | The Lattice's memory |
| Nightly backups | Azure Storage `ceo-backups` (private, Cool tier), kept 90 days; deletes and overwrites recoverable for 14 days | A copy of the world's public state, the Azure copy's state and the models; restores either copy |
| Idea pictures | Vercel Blob (private), shown only on short-lived signed links (#127) | May show Nikita's screen |
| Nikita's words | GitHub issues (public) | Dictated, may mention people |
| Messages and contacts (planned) | Relay MacBook only; what may leave it is in [RELAY-PRIVACY.md](RELAY-PRIVACY.md) | The most sensitive data C.E.O. will touch |

## Actors

| Actor | Can do | Trusted for |
| --- | --- | --- |
| Nikita | Everything; presses the Desk buttons; owns the repo | Decisions, and the words that steer the Foundry |
| The Builder and workers | Code, branches, pull requests, merges | Following FOUNDRY.md; their output is checked, not trusted |
| Rivet (Haiku) | Proposes a card | Nothing: its answer is data, re-checked in code |
| World step model (Haiku) | Proposes an hour | Nothing: its answer is data, re-checked in code |
| Gemini speech | Reads the day's script aloud | Nothing: it gets only public, scrubbed text, and its audio is only stored and played |
| Visual QA reviewer (Gemini) | Proposes findings about the Lattice's look | Nothing: its answer is data, re-checked in code; only CI writes the issue, in its own format |
| CI bots | Post check results | Machine output, read as data |
| Anyone on GitHub | Open issues, comment | Nothing |
| Lattice visitors | Read the public site | Nothing |
| A compromised dependency or action | Runs at install, build or CI time | Nothing: pinned, signed, scanned |

## OWASP Top 10 for LLM Applications (2025)

| Risk | Where it applies in C.E.O. | Controls in place | Residual risk | Tracking |
| --- | --- | --- | --- | --- |
| **LLM01 Prompt Injection** | Idea text and issue text into Rivet; issue titles into the world step; issue comments into the builder; text visible in the Lattice's recordings into Gemini | Data fencing with spoof-proof tags (`shapeInput`, `unfence`; `fence` in `api/_world/prompt.ts`); system rules that say the blocks are data; constant system prompts; owner-only input for the builder (`scripts/foundry-issue.sh`, #59); world trail steps only from trusted authors (`TRAIL_AUTHORS`); the builder guard (`.claude/hooks/`, #119); the injection eval suite below | A model can still be talked into odd wording inside the schema; the builder's fence is a script and a rule it follows, not a platform control | Agents' own identity (R2) |
| **LLM02 Sensitive Information Disclosure** | The public Lattice; ideas filed as public issues; pictures | Data minimisation (the step never reads bodies or comment words, `api/_world/digest.ts`); `scrub` on all input and output, now also catching full-width, zero-width-split and spelled-out forms; no secrets in git (secret scanning and push protection); the privacy check on Desk text before it is posted (`privateParts` in `api/_privacy.ts`, #127): emails, phone numbers, street addresses, card, bank and ID numbers, keys, tokens and passwords, and names with a cue are held back whole, nothing sent; idea pictures stay in the private store, named in the issue but never linked, and served only on short-lived signed links (`api/_pictures.ts`) | The privacy check reads patterns: a detail without a cue, or one written around them, still goes public as written; pictures are never read for what they show | Shipped: privacy guard before posting (#127) |
| **LLM03 Supply Chain** | npm packages, GitHub Actions, the Claude SDK | Lockfile with `npm ci`; `npm audit signatures` and `npm audit --audit-level=high` in checks; dependency review; Dependabot; actions pinned to SHAs; CodeQL; OpenSSF Scorecard (#64, #67); the Azure deploy signs in with OIDC from the `azure` environment, which only `main` may use (#218) | A malicious release that passes signature checks before it is known | Watched by Dependabot and dependency review |
| **LLM04 Data and Model Poisoning** | No training or fine-tuning; the world step reads back its own last hours | Last hours are re-fenced and re-scrubbed each hour; answers are re-validated before they are saved, so a bad hour can't add agents, rooms or kinds | One odd hour can echo into the next few | Accepted |
| **LLM05 Improper Output Handling** | Rivet's card written into an issue body the Desk and the world step parse; world text shown on the Lattice; Gemini's findings written into a fix issue | Schema with `additionalProperties: false`; enums for builder, model, size, agents, rooms and kinds; `plainLine` strips pictures, links, HTML and markdown markers from card text so it can't fake a `**Builder:**` line or call out to another host; `plainText` does the same for Visual QA findings, which CI files under its own card lines; length caps everywhere; React escapes all model text; no HTML sinks in the front end; the Desk's card reader shows pictures only from Nikita's own store, through its own picture function (`ownPictures`, #127) | A model can still word a card oddly inside the schema; an enforcing CSP and security headers (#62) back up the reader | Shipped: the Desk shows only its own pictures (#127) |
| **LLM06 Excessive Agency** | The builder session (shell, git, merges); Rivet; the world step | Rivet and the world step have no tools at all: they return JSON only; labels that start a build come only from Nikita's Build choice; checks, scans and the ruleset definitions for `main` (#60, #66); CODEOWNERS on the trust boundary (inert until code-owner review is turned on); the crew's GitHub App for the Desk's functions and CI's issue writes, with hour-long tokens for this repo only and no Administration or Workflows permission (`api/_github.ts`, #138); the builder guard, a hook that denies risky commands and secrets files before they run and logs every tool call on the machine (`.claude/hooks/`, #119) | The builder's Claude Code sessions still act as Nikita on GitHub (their access comes from the environment, not from the repo), and its guard is a deny list, not a sandbox, so some of its limits are still rules it follows | Agents' own identity (R2) |
| **LLM07 System Prompt Leakage** | Rivet's and the world step's prompts | Both prompts are public in this repo by design and hold no secrets, keys or private rules; the security comes from code checks, not from the prompt being secret | None beyond what is already public | Accepted |
| **LLM08 Vector and Embedding Weaknesses** | Not used: no retrieval, no vector store | Not applicable today; the Relay privacy spec (docs/RELAY-PRIVACY.md) rules out embeddings, vector stores and search indexes over messages until it is changed | If Relay adds retrieval over messages, this becomes live | Relay privacy spec (R5, shipped #149) |
| **LLM09 Misinformation** | The Historian's hourly summaries; Rivet's pitches | The world step reads only real events and labels the Lattice as a story; Rivet's card is a suggestion that Nikita approves; the Builder confirms builder and model | Off-tone or wrong lines on the Lattice for an hour | Accepted |
| **LLM10 Unbounded Consumption** | Claude spend; Gemini speech and Visual QA spend; GitHub token quota; function CPU | Coded budget guard for the world step (`api/_world/budget.ts`); Gemini's own coded monthly cap and one story per day, made once (`api/_world/story.ts`); per-run and per-day caps for Visual QA (`api/_visualqa/review.ts`); provider-side monthly cap; `max_tokens` on every call; note and output length caps; feed cache hardening (#63); `scrub` now linear on long input (bounded patterns, titles cut before scrubbing) | The world step's trigger stays open on purpose: calling it more often changes nothing, so the 55-minute spacing and the monthly budget guard bound the spend, and a key was left out | Covered: 55-minute spacing and the monthly budget guard (closed #171) |

## Google SAIF

| SAIF core element | In C.E.O. |
| --- | --- |
| Expand strong security foundations to the AI ecosystem | Secrets only in Vercel, Actions secrets and Azure Key Vault; Azure deploys sign in with OIDC, with no stored key (#218); pinned and signed supply chain; CodeQL and dependency review on agent-written code like any other; an enforcing CSP and security headers (#62) |
| Extend detection and response | The Trail on every issue records origin, decision, builder, model and cost of each change; Checks failing on `main` opens a fix issue by itself; Scorecard and code scanning report to the Security tab |
| Automate defenses | The injection eval suite runs on every build; schema-bound output and code re-validation on every model call; Dependabot and secret scanning |
| Harmonize platform controls | One delivery path for every change (DELIVERY.md); rulesets for `main` defined in `.github/rulesets/` (#60); least-privilege workflow permissions |
| Adapt controls | Each review finding became a carded fix with a test; this suite grows with new payloads; gaps it finds are fixed or marked expected-fail until they are |
| Contextualize AI system risks | This page: the model risks are mapped to the business flow they sit in (ideas, builds, the public world, messages) |

## NIST AI RMF

| Function | In C.E.O. |
| --- | --- |
| **Govern** | Who decides is written down (docs/SKIPPY.md); Nikita approves every build on the Desk; the security review (#58) and this page set the policy; CODEOWNERS marks the trust boundary |
| **Map** | The data flow, boundaries, assets and actors above; the OWASP table maps each risk to where it lives |
| **Measure** | The injection eval suite (counts below); spend per call on the Trail and the Desk's usage panel; Scorecard; delivery measures planned in DELIVERY.md |
| **Manage** | Controls per risk with owners and tracking; residual risks and the roadmap below; expected-fail tests keep open gaps visible in every run |

## The injection eval suite

Two files under `api/_security/`, run by `npm test` on every build with no network and no API calls. The models
are stubbed; the payloads go through the real code around them. `npm run security:evals` counts the cases in each
area into `apps/world/src/desk/security/evals.json` for the Desk; a test fails when the counts below or that file
fall behind the suite.

| Area | File | Cases | What it proves |
| --- | --- | --- | --- |
| Rivet's prompt | `injection.test.ts` | 86 | For 21 known payloads (direct, "ignore previous", delimiter spoofing in five forms, role-play, base64, ASCII smuggling, bidi, markdown and HTML exfiltration, fake tool calls, fake card fields, a spoofed owner note, oversized input), the idea stays in its own block in new, revise and answer rounds; the real call sends the same system rules and the idea only as user data, with structured output on |
| Rivet's answer | `injection.test.ts` | 23 | Hostile answers can't add fields or labels, pick an unknown builder or model, smuggle card lines, links, pictures, HTML or scripts, or exceed length caps; non-cards are rejected |
| The Desk's write path | `injection.test.ts` | 53 | With GitHub and Claude stubbed: clicks without a sign-in session touch nothing; a proposed or revised idea never gets `foundry:build`; Stop works only on an open `foundry:auto` build and only sends it back to an idea; Undo works only on a closed, shipped change not already being undone, and only reopens it in the fix lane; foreign picture links are dropped, and the Desk shows only its own pictures; text that looks private is held back before GitHub or Claude hear of it; pictures go into the issue as names and reach Rivet only on short-lived signed links; oversized notes are capped; forged choices and issue numbers are refused; requests go only to the repo's API |
| The world step | `injection.test.ts` | 29 | Hostile titles and stranger comments: system rules unchanged byte for byte, each data block opened and closed once, no stray brackets or invisible characters, only trusted trail authors; secrets in disguise are scrubbed; hostile answers lose unknown agents, rooms, kinds, extra fields and over-limit items; end to end through `runStep`, the saved state is clean |
| The builder's input | `builder-input.test.ts` | 10 | With a stub `gh`: an outsider's and look-alike accounts' text never appears (look-alikes of the crew's App too), exit code 3, a spoofed closing marker closes nothing, owner, CI and the crew's App's text sit in their blocks |

What it doesn't prove: how a live model behaves. A small live eval behind a manual workflow is the next step for
that (not carded yet).

**Gaps the suite found, fixed in the same change (#65):**

- Rivet's card text was written into the issue as the model gave it, so a pitch or short line could carry a fake
  card field or a picture link. Card text is now reduced to plain lines (`plainLine`).
- Rivet's input had no data fence. It now does, with tags that text inside can't close, and rules that say so.
- The world step counted trail-shaped comments from anyone. It now counts only Nikita's account and the Checks bot.
- `scrub` missed full-width, zero-width-split and spelled-out forms, and slowed down sharply on very long input.
  Both fixed.

**Found by the suite, fixed in #127 (R4):** the Desk's card reader showed pictures from any host in idea text
written with the Desk key. It now shows only Nikita's own pictures, from the private store, on short-lived signed
links through its own picture function; its test passes like any other, and nothing in the suite is expected-fail.

## Residual risks and roadmap

| | Item | Closes | Status |
| --- | --- | --- | --- |
| Shipped | Security headers and an enforcing CSP | Output handling defence in depth, clickjacking | #62 |
| R1 | Builder permission hook: narrow shell permissions, deny risky commands, log every tool call | Excessive agency (agent half) | Shipped #119 |
| R2 | The agents' own identity (a GitHub App with short-lived tokens; DELIVERY.md, section 10) | Agents acting as Nikita; previews and audit | Built #138, live once Nikita sets up the App; open: the Claude Code sessions still act as Nikita |
| R3 | Real Desk sign-in (passkey, short session, rate limits) | The static Desk key | Shipped #132 |
| R4 | Privacy guard before posting (check Desk text before it goes public, signed picture links, Desk shows own pictures only) | Desk text and pictures going public | Shipped #127 |
| R5 | Relay privacy spec before the hub is built (what stays on the Mac, what OpenAI and the site may see, retention, the wipe; a counts-only check on the site boundary) | Messages and contacts | Shipped #149 |
| R6 | Key the world step and cap it per hour | World spend | Shipped #171: covered by the 55-minute spacing and the monthly budget guard; no key needed |

**R2, what #138 does and doesn't close.** Once Nikita creates the crew's GitHub App and pastes its key
(SECURITY.md, "The crew's own identity"), every Vercel function that talks to GitHub mints its own hour-long token for
this repo only (`api/_github.ts`): the Desk's buttons can only write issues, the feeds and the world step can only
read. CI's fix issues come from the App too. None of it can change settings, rulesets or workflows. What stays open
is the biggest actor: the Foundry's Claude Code sessions push, open pull requests and merge with the GitHub access
their environment gives them, which is Nikita's today and can't be changed from the repo. Until it can, GitHub can't
tell their work from his, code-owner review can't be required, and the break-glass bypass in DELIVERY.md, section 11,
stays off. DELIVERY.md, section 10, has the details.

Accepted for now: odd wording from a model inside the schema (LLM09), the world's last hours echoing into the next
(LLM04), and public prompts (LLM07). Revisit when Relay comes online, since that adds private data, untrusted
inbound messages and actions taken in Nikita's name.
