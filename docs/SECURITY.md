# Security

C.E.O. is a public repo, and much of its code is written by agents (Claude and the Foundry's crew). Every change,
whoever wrote it, goes through the same scanners before it reaches production. This file is also the repo's
security policy: GitHub reads `SECURITY.md` from the root, `docs/` or `.github/`, and this one is it.

## Reporting a vulnerability

Please report it privately through the repo's Security tab, "Report a vulnerability". Don't open a public issue
for it. We'll reply there.

## Threat model and AI risks

[THREAT-MODEL.md](THREAT-MODEL.md) has the data flow and trust boundaries, how each OWASP Top 10 for LLM
Applications (2025) risk is handled here, the mapping to Google SAIF and the NIST AI RMF, and what is still open.
Its injection eval suite (`api/_security/`) throws known prompt-injection and exfiltration payloads at Rivet's
shaping, the world step and the builder's issue reader on every `npm test`, offline.

The Desk shows all of this without a trip to GitHub, on Systems > Security (`/systems/security`: each scan's last
result, the security switches, alert counts, the Scorecard score, the trust boundaries, the open risks and the eval
counts) and Systems > Compliance (`/systems/compliance`: the OWASP, NIST AI RMF and SAIF mappings). The Desk is
public to read, so its feed (`api/security-feed.ts`) carries posture only: states, scores, dates and counts, never
an open alert's details.

## Privacy before posting

What Nikita types or dictates on the Desk (a suggested idea, revise notes, an answer to Rivet) is written into a
public GitHub issue, so it goes through a privacy check first (`api/_privacy.ts`, #127, R4 in
[THREAT-MODEL.md](THREAT-MODEL.md)). It looks for email addresses, phone numbers, street addresses, card, bank and ID
numbers, keys, tokens and passwords, and people's names where a cue gives them away ("my friend …", "Mrs. …",
"…'s number"), including full-width, zero-width-split and spelled-out forms. On a hit nothing is sent to GitHub or
Claude: the Desk says what kind of thing it found (never the words) and Nikita says it another way. It is a pattern
check with no model call, so it is free and predictable, and a slip it can't see still goes public as written.

Idea pictures stay in the private Vercel Blob store. The issue names them but never links them, and
`api/foundry-image.ts` serves one only on a link that lasts minutes, signed with a key derived from the Desk key
(`api/_pictures.ts`): the function signs the Desk's own links for a signed-in Desk (#132), and Rivet's shaping call
gets one that lasts five. The Desk's idea cards show pictures only from that store, through that function, never
from another host.

## Signing in to the Desk

The Desk's buttons write to the public repo, so they need a real sign-in (#132, R3 in
[THREAT-MODEL.md](THREAT-MODEL.md)). Reading the Desk stays public; writing needs a passkey.

- **Passkeys.** Nikita signs in with a passkey: the device's own fingerprint, face or PIN (Windows Hello, Touch ID,
  Face ID, an Android screen lock). The device keeps the private key; the Desk keeps only the public part (the
  credential's id, its public key, its signature counter and the device's name) in the private Blob store, at
  `desk/auth/passkeys.json`. `api/desk-auth.ts` checks every sign-in with SimpleWebAuthn
  (`@simplewebauthn/server`), a widely used, maintained WebAuthn library: the site, the origin, a one-time
  challenge, the signature, the user check and the counter.
- **Sessions.** A sign-in sets one cookie, HttpOnly, Secure and SameSite=Strict, holding a signed token that names
  the passkey. It lasts 30 minutes from its last use, renews quietly while the Desk is in use, and ends 12 hours after
  the sign-in whatever happens, when a passkey is needed again. Every Desk write checks it
  (`requireSession` in `api/_desk/session.ts`): the idea buttons (`api/foundry.ts`), picture uploads and the Desk's
  own picture links (`api/foundry-image.ts`) and the day's story backfill (`api/day-story.ts`). Requests from another
  site are refused. No caller outside the browser uses these, so nothing accepts the Desk key in their place.
- **Keys.** Every signing key (sessions, sign-in challenges, picture links) is derived from `FOUNDRY_DESK_KEY`,
  stretched with scrypt and split by purpose (`api/_desk/keys.ts`), so no new variable is needed and the Desk key
  itself never signs anything. Make it long and random, like any password manager's suggestion: it is also what an
  offline guess against a captured cookie would have to find.
- **Wrong tries.** Failed sign-ins and enrolments are counted in the Blob store (`api/_desk/limits.ts`), per
  address (as a keyed hash, never the address) and across all addresses. From one address: two free, then a 30 second
  wait, then 2 minutes, then locked for 15 minutes. Across all addresses, enrolment locks for an hour after 8
  failures and sign-in for 15 minutes after 22. The Desk says plainly when it is locked and for how long. A lockout
  never ends a session that is already open.

**Adding a device** (a new PC or phone): open the Desk on it, go to the Foundry tab, press **Add this device**,
give it a name, type the Desk key once, and confirm with the device's fingerprint, face or PIN. It is signed in
straight away, and from then on signs in with the passkey alone. A phone can also use a passkey saved on another
device through the browser's own "use a phone or another device" prompt. Up to ten devices.

**Removing a device:** signed in on any device, open **Devices** on the Foundry tab's sign-in bar and press
**Remove** next to it. Its sessions end at once. (Then delete the passkey from that device's own password manager
too, if you have it.) **If a device is lost or the Desk key may have leaked**, change `FOUNDRY_DESK_KEY` in Vercel
and redeploy: every session and picture link ends, and enrolling needs the new key; then remove the lost device.

## Keys and settings in Vercel

Every secret lives only in Vercel's environment (Project, Settings, Environment Variables), never in the repo or the
browser, and no function logs or returns one. Which environments get each is in [DELIVERY.md](DELIVERY.md),
"Environments".

| Variable | What it is for | Without it |
| --- | --- | --- |
| `CLAUDE_API_KEY` | Claude Haiku: Rivet's shaping, the world step's hours, the day's story script | Shaping is off; hours and scripts come from the agents' own lines |
| `GEMINI_API_KEY` | Gemini's text to speech: the day's story, read aloud (#95). Sent only in a request header, with only the day's scrubbed script | No audio; the Chronicle says so |
| `GEMINI_BUDGET_USD` | Gemini's monthly cap, enforced in code (`api/_world/story.ts`); default 5, never above 10 | $5 |
| `FOUNDRY_GITHUB_TOKEN` | The Desk's buttons write issues; the feeds read with it | Buttons say "not set up" |
| `FOUNDRY_DESK_KEY` | The Desk's enrolment secret: typed once per device to add its passkey, and the root every Desk signing key is derived from (#132). Long and random | Sign-in, the buttons and the story backfill say "not set up" |
| `WORLD_BUDGET_USD` | The world's share of the $10 Claude cap (default 6) | $6 |
| `WORLD_STORE` | Which store the world uses (`blob`, `supabase`, `memory`) | `blob` |
| `BLOB_STORE_ID` | Set by Vercel when the private Blob store is connected; signed in with Vercel's OIDC token | The world isn't saved, and the Desk can't sign in |

## What scans the code, and when

| Check | Runs on | What it looks for | Where findings show |
| --- | --- | --- | --- |
| Checks (`.github/workflows/checks.yml`) | Every push to `main`, every pull request, nightly | Typecheck, lint, tests and build, plus `npm audit signatures` (every package's registry signature and provenance) and `npm audit --audit-level=high` (known vulnerabilities rated high or critical) | The pull request's checks; a failure on `main` opens a Foundry fix issue |
| CodeQL (`.github/workflows/codeql.yml`) | Pushes to `main`, pull requests, weekly | Security bugs and code quality problems in the TypeScript, JavaScript and workflow files, using the `security-and-quality` query suite | Security tab, Code scanning; annotations on the changed lines of a pull request |
| Dependency review (`.github/workflows/dependency-review.yml`) | Every pull request | Packages or actions the change adds or bumps that carry a known vulnerability; fails on high or critical | The pull request's checks, with a summary of what changed |
| OpenSSF Scorecard (`.github/workflows/scorecard.yml`) | Pushes to `main`, weekly | How the repo is run: pinned actions, workflow permissions, branch protection, dependency updates | Security tab, Code scanning (category `scorecard`) |
| Dependabot (`.github/dependabot.yml`) | Weekly, and at once for a security fix | Out-of-date or vulnerable npm packages and GitHub Actions | Pull requests labelled `dependencies`; alerts in the Security tab |
| Visual QA (`.github/workflows/visual-qa.yml`) | Every push to `main` | Not a security scan: Gemini watches a clip of each Lattice room for visual bugs. Listed because it is the one workflow that sends data out (renders of the public Lattice only) and holds an outside key | A `foundry:fix` issue per room with a blocker; the run's summary; Systems > Foundry on the Desk |
| Secret scanning | Every push | Keys and tokens committed by mistake; push protection blocks the push | Security tab, Secret scanning |

Every action in the workflows is pinned to a full commit SHA with its version in a comment, so a moved tag can't
change what runs. Dependabot proposes the bumps. Each workflow starts with read-only permissions and grants write
access only to the job that needs it.

## Keys in GitHub Actions

One secret lives in the repo's Actions secrets (Settings > Secrets and variables > Actions) rather than in Vercel,
because only a workflow uses it. Workflows never print it, and the job that holds it has read-only permissions.

| Secret | What it is for | Without it |
| --- | --- | --- |
| `GEMINI_API_KEY` | Visual QA's review step only (`.github/workflows/visual-qa.yml`, #91): clips of the public Lattice go to Gemini. Sent only to Google's API host in a header, never printed; spend capped in code at $0.50 a run and eight pushed runs a day. The same name in Vercel is the separate key for the day's story (above) | The tour still records; the review is skipped |

## Why these tools

GitHub's own tools come first: CodeQL, dependency review, Dependabot and secret scanning cover the code, the
packages and leaked keys, and they're free for a public repo. Where GitHub falls short is grading how the repo
itself is run, so one outside scanner fills that gap: OpenSSF Scorecard, free and run by the Open Source Security
Foundation, needing no secret. A separate secret scanner such as gitleaks would duplicate GitHub's secret scanning
and push protection, so it isn't used.

## Agent-written code

Agent work reaches `main` through the same gates as anyone's. The Foundry's lanes open pull requests (see
[FOUNDRY.md](FOUNDRY.md)), so Checks, CodeQL and dependency review run on them and their findings sit on the pull
request where Nikita reviews it. Work shipped straight from chat is scanned on its push to `main`, and its CodeQL
findings show in the Security tab against that commit.

## The builder guard

Every Claude Code session in this repo (the Builder, Rusty, Rocky and chat work) runs two project hooks from
`.claude/settings.json` (#119, R1 in [THREAT-MODEL.md](THREAT-MODEL.md)). They are a short deny list for slips and
talked-into mistakes, not a sandbox; the PR gates above still decide what reaches `main`.

**Before a tool runs** (`.claude/hooks/guard-hook.mjs`, rules in `.claude/hooks/guard.mjs`), the guard blocks:

- `rm -r` on `/`, the home folder, the repo root or any folder above it
- `git push` that lands on `main` or `master` (by name, `HEAD` while on it, a bare push from it, `--all`, `--mirror`)
- code fetched with `curl` or `wget` and run by a shell or interpreter
- dumping the environment (`env`, `printenv`, `export -p`), echoing a token-named variable, `gh auth token`
- reading or writing key files from the shell or the file tools: `.env` files (not `.env.example`), `~/.ssh`,
  `~/.aws`, private keys (`*.pem`, `id_*`), `.netrc`, `.npmrc`, the GitHub CLI's token file
- `gh` or `curl` writes to GitHub that change repo settings, rulesets, branch protection, secrets and variables,
  collaborators, deploy keys or webhooks, or move `main` directly
- `npm publish` (and pnpm, yarn), and `chmod -R 777`

Everything else passes: npm scripts, git on feature branches, merges, worktrees, `gh api` reads, issue and PR
comments and labels, opening and squash-merging PRs, Playwright and node scripts. A blocked call gets its reason
back, and the agent finds another way or asks Nikita. The guard fails open on its own bugs: if it crashes or can't
read its input, the call goes ahead, so only a rule's decision can stop work.

**After every tool call** (`.claude/hooks/log-tool.mjs`), one JSON line goes to `.claude/logs/tool-calls.jsonl` in
the project folder: the time, the session's first eight characters, the tool, a short summary (the first 200
characters of a command, or a path or pattern) and whether it worked; blocked calls are logged with their reason.
Never file contents, edits, output or environment values, and anything that looks like a key or token is masked.
The log is gitignored, stays on that machine, and is never published or sent anywhere. It rolls over at 5 MB.

**To add a rule**, write a small function in `RULES` in `.claude/hooks/guard.mjs` that returns a reason to block,
and add both blocked and allowed examples to `.claude/hooks/guard.test.mjs` (run by `npm test`), including the
everyday commands it must not catch.

## How upkeep bumps packages

The upkeep lane may bump one dependency at a time. It bumps only packages already in `package.json`; adding a new
package is a build, not upkeep. `npm ci` installs exactly what the lockfile names, and `npm audit signatures`
checks that every installed package carries a valid registry signature, and provenance where the package
publishes it, so a tampered or look-alike package fails the checks. Dependency review then blocks a bump that
brings in a known high or critical vulnerability.

## Settings Nikita switches on

Agents can't change repo settings, so these are clicks for Nikita, once. In the repo, open **Settings**, then
**Advanced Security** in the sidebar (called **Code security** on some accounts).

1. **Dependency graph:** Settings > Advanced Security > Dependency graph > Enable (on by default for public repos;
   dependency review needs it).
2. **Dependabot alerts:** Settings > Advanced Security > Dependabot > Dependabot alerts > Enable.
3. **Dependabot security updates:** Settings > Advanced Security > Dependabot > Dependabot security updates >
   Enable.
4. **Secret scanning:** Settings > Advanced Security > Secret Protection (or Secret scanning) > Enable.
5. **Push protection:** Settings > Advanced Security > Secret Protection > Push protection > Enable.
6. **Private vulnerability reporting:** Settings > Advanced Security > Private vulnerability reporting > Enable.
7. **CodeQL:** nothing to switch on. The workflow is the advanced setup, so leave Settings > Advanced Security >
   Code scanning > CodeQL analysis on "Set up" and don't pick "Default", which would clash with the workflow.
8. **Optional, make the scans required:** Settings > Branches (or Rules > Rulesets) > the rule for `main` >
   Require status checks to pass > add "checks", "Analyze (javascript-typescript)", "Analyze (actions)" and
   "Dependency review".
9. **Visual QA's key (optional):** Settings > Secrets and variables > Actions > New repository secret, named
   `GEMINI_API_KEY`, with a key from Google AI Studio on a paid-tier project (the free tier lets Google use what it is
   sent to improve its products). Until it is set, Visual QA records the clips and skips the review. Setting a
   budget alert on that Google project backs up the caps in code.
