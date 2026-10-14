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
`api/foundry-image.ts` serves one only on a link signed with the Desk key that lasts minutes (`api/_pictures.ts`):
the Desk signs its own links in the browser, and Rivet's shaping call gets one that lasts five. The Desk's idea cards
show pictures only from that store, through that function, never from another host.

## Keys and settings in Vercel

Every secret lives only in Vercel's environment (Project, Settings, Environment Variables), never in the repo or the
browser, and no function logs or returns one. Which environments get each is in [DELIVERY.md](DELIVERY.md),
"Environments".

| Variable | What it is for | Without it |
| --- | --- | --- |
| `CLAUDE_API_KEY` | Claude Haiku: Rivet's shaping, the world step's hours, the day's story script | Shaping is off; hours and scripts come from the agents' own lines |
| `GEMINI_API_KEY` | Gemini's text to speech: the day's story, read aloud (#95). Sent only in a request header, with only the day's scrubbed script | No audio; the Chronicle says so |
| `GEMINI_BUDGET_USD` | Gemini's monthly cap, enforced in code (`api/_world/story.ts`); default 5, never above 10 | $5 |
| `FOUNDRY_APP_ID`, `FOUNDRY_APP_PRIVATE_KEY` | The crew's GitHub App (#138, below): every function mints its own hour-long token for this repo, as `ceo-foundry[bot]`. Production only | The functions use `FOUNDRY_GITHUB_TOKEN`, as before |
| `FOUNDRY_APP_INSTALLATION_ID` | Optional: the App's installation, to skip one lookup | Looked up once per warm function |
| `FOUNDRY_GITHUB_TOKEN` | The fallback until the App is set up: a fine-grained token that acts as Nikita. The Desk's buttons write issues with it; the feeds read with it | With the App set, nothing is lost; without either, buttons say "not set up" and the feeds read anonymously |
| `FOUNDRY_DESK_KEY` | The Desk's passphrase, compared in constant time | Buttons and the story backfill say "not set up" |
| `WORLD_BUDGET_USD` | The world's share of the $10 Claude cap (default 6) | $6 |
| `WORLD_STORE` | Which store the world uses (`blob`, `supabase`, `memory`) | `blob` |
| `BLOB_STORE_ID` | Set by Vercel when the private Blob store is connected; signed in with Vercel's OIDC token | The world isn't saved |

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

These live in the repo's Actions secrets (Settings > Secrets and variables > Actions) rather than in Vercel, because
only a workflow uses them. Workflows never print them.

| Secret | What it is for | Without it |
| --- | --- | --- |
| `FOUNDRY_APP_ID`, `FOUNDRY_APP_PRIVATE_KEY` | The crew's GitHub App (#138, below). Only the two `report` jobs (`checks.yml`, `visual-qa.yml`) use them, to open fix issues as `ceo-foundry[bot]` with a token that can only write issues and is revoked when the job ends | Those jobs write with the built-in token, as before |
| `GEMINI_API_KEY` | Visual QA's review step only (`.github/workflows/visual-qa.yml`, #91): clips of the public Lattice go to Gemini. Sent only to Google's API host in a header, never printed; spend capped in code at $0.50 a run and eight pushed runs a day. The same name in Vercel is the separate key for the day's story (above) | The tour still records; the review is skipped |

## The crew's own identity

The crew has its own GitHub identity (#138, R2 in [THREAT-MODEL.md](THREAT-MODEL.md)): a GitHub App called
`ceo-foundry`, installed on this repo only, that acts as `ceo-foundry[bot]`. Once it is set up:

- **Every Vercel function that talks to GitHub** mints its own token from the App's key (`api/_github.ts`): a JSON Web
  Token signed with the key, exchanged for an installation token for this repo only, kept until five minutes before
  it expires (GitHub gives them an hour). The Desk's buttons get a token that can only write issues; the feeds and the
  world step get one that can only read. Production only: previews get no App key.
- **CI's fix issues** (`checks.yml` and `visual-qa.yml`, the `report` jobs) come from the App too, on a token that can
  only write issues and is revoked when the job ends. No workflow's permissions changed.
- **The Foundry's readers trust it like the Desk**: `scripts/foundry-issue.sh` shows its words in their own block,
  and the world step counts its trail steps. Look-alike accounts are still withheld.
- **Until then, and whenever GitHub won't mint a token**, everything works exactly as before, on
  `FOUNDRY_GITHUB_TOKEN` in Vercel and the built-in token in CI. A failed mint is retried after a minute and logs
  only GitHub's status code.

What it doesn't change: the Foundry's Claude Code sessions push, open pull requests and merge with the GitHub
access their environment gives them, which is Nikita's account today. That is set where the sessions run, not in this
repo, so their work still shows as Nikita's (DELIVERY.md, section 10).

**Setup, once (Nikita).** About five minutes on a Mac with the GitHub CLI (`gh`) signed in as `nikitapage10`.

1. **Create the App.** Open https://github.com/settings/apps/new (your picture, top right > Settings > Developer
   settings > GitHub Apps > New GitHub App).
   - **GitHub App name:** `ceo-foundry`, exactly: the code trusts `ceo-foundry[bot]` by name. (If GitHub says the
     name is taken, stop and tell the Foundry which name you picked; a small change follows it in `api/_github.ts` and the two
     `scripts/foundry-*.sh` readers.)
   - **Homepage URL:** `https://github.com/nikitapage10/C.E.O.`
   - **Identifying and authorizing users:** leave every box unticked and the Callback URL empty.
   - **Webhook:** untick **Active**.
   - **Permissions > Repository permissions:** Actions: Read-only. Checks: Read-only. Code scanning alerts:
     Read-only. Contents: Read and write. Dependabot alerts: Read-only. Issues: Read and write. Metadata: Read-only
     (GitHub sets it). Pull requests: Read and write. Leave everything else on No access, **above all Administration
     and Workflows**, so the App can't change settings, rulesets or CI. No Organization or Account permissions.
   - **Where can this GitHub App be installed?** Only on this account.
   - **Create GitHub App.**
2. **Make its key.** On the page that opens, note the **App ID** near the top (a number). Scroll to
   **Private keys** > **Generate a private key**. A file `ceo-foundry.<date>.private-key.pem` lands in Downloads.
3. **Install it on this repo only.** Left sidebar > **Install App** > **Install** next to `nikitapage10` > **Only
   select repositories** > `C.E.O.` > **Install**.
4. **Paste 1, in Terminal.** Paste this, replace `000000` with the App ID, press Return. It sets both GitHub Actions
   secrets and puts the two Vercel lines on your clipboard (the key as one base64 line); it prints neither.

   ```sh
   APP_ID=000000; KEY="$(ls -t ~/Downloads/ceo-foundry*.private-key.pem | head -1)"; gh secret set FOUNDRY_APP_ID -R nikitapage10/C.E.O. --body "$APP_ID" && gh secret set FOUNDRY_APP_PRIVATE_KEY -R nikitapage10/C.E.O. < "$KEY" && printf 'FOUNDRY_APP_ID=%s\nFOUNDRY_APP_PRIVATE_KEY=%s\n' "$APP_ID" "$(base64 < "$KEY" | tr -d '\n')" | pbcopy && echo "GitHub secrets set; the Vercel lines are on the clipboard."
   ```

5. **Paste 2, in Vercel.** The project > **Settings** > **Environment Variables**. Click into the first **Key** field
   and press ⌘V: Vercel splits the two lines into two variables. Under **Environments**, tick **Production** only
   (untick Preview and Development). **Save**. Then **Deployments** > the top Production deployment > **⋯** >
   **Redeploy**, so the functions pick them up.
6. **Check it, then retire the old token.** The next Desk button you press leaves its trail comment on GitHub as
   `ceo-foundry[bot]` instead of you. Once it does, delete `FOUNDRY_GITHUB_TOKEN` in Vercel (Environment Variables > ⋯ >
   Remove) and revoke it on GitHub (Settings > Developer settings > Personal access tokens > Fine-grained tokens), so
   no long-lived token that acts as you is left. Delete the `.pem` from Downloads; GitHub can make a new key any time.

To rotate the key: the App's page > Private keys > Generate a private key, run steps 4 and 5 again, then delete the
old key on the same page.

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
