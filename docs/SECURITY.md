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

## Relay's privacy rules

Relay, the planned hub on the MacBook that will read iMessage and SMS, has its privacy rules written before it is
built: [RELAY-PRIVACY.md](RELAY-PRIVACY.md) (#149, R5 in [THREAT-MODEL.md](THREAT-MODEL.md)). Messages, contacts,
drafts and summaries stay on the Mac and leave it only for one trimmed OpenAI call at a time, with names and numbers
replaced by placeholders and `store: false`. The public site gets counts, enum states and timestamps only, in one
allowlisted shape (`RelayStatus` and `readRelayStatus` in `packages/core/src/relay.ts`) that refuses an unknown key
or any free string, and a test holds it to that. Logs hold no content, everything has an end date, and one command
wipes it all.

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

## Pings on the phone

The Desk can sit on a phone's home screen like an app and send one notification when something needs Nikita's call
(#135), instead of an email.

- **Installing.** `apps/world/public/manifest.webmanifest` and the icons in `apps/world/public/desk/` let a phone
  add the Desk to its home screen; it opens straight to the Desk. On an iPhone or iPad: open the Desk in Safari,
  Share, **Add to Home Screen**, then open it from there (iOS only offers notifications to a site on the home
  screen). On Android: Chrome's menu, **Add to Home screen** (or **Install app**).
- **The service worker keeps nothing.** `apps/world/public/sw.js` has no cache: every request goes to the network
  as before, the 3D Lattice and anything private are never stored on the phone, and a page load without a network
  gets a one-line "offline" page. It is registered for the whole site because the Desk lives at `/`.
- **Turning pings on.** Signed in on the device, open the Foundry tab and switch on **Pings on this device**. The
  browser asks to allow notifications and makes a Web Push subscription for the Desk's public key; the Desk sends
  it to `api/desk-pings.ts`, which takes it only in a passkey session (`requireSession`, #132), only from a known
  push service (Apple's, Google's, Mozilla's or Microsoft's), and sends one welcome ping.
- **What is stored.** In the private Blob store beside the passkeys, at `desk/auth/pings.json`: each device's push
  endpoint (a long, unguessable address at its push service), the two public keys the browser made to encrypt pings
  for it, which passkey was signed in when it was turned on, and when; and, for "never twice", a short key per item
  already pinged (`idea:#12`, `question:#12:<hash>`, `blocker:#12`), forgotten once the issue closes. No issue text,
  nothing personal.
- **What a ping says.** Only counts and who is asking, safe on a lock screen anyone might see: "Rivet has a
  question", "3 ideas are waiting for your pick", "A job is blocked and needs you" (`pingText` in
  `api/_desk/pings.ts`). Never a title, a body, a name, an issue number or a link. The words are encrypted for the
  device (RFC 8291), so the push service only ever carries ciphertext. Tapping one opens the Desk's Foundry tab.
- **Who sends.** `.github/workflows/desk-pings.yml` runs when a Foundry issue is opened or relabelled, and every
  hour, and asks `api/desk-pings.ts` to scan with the shared `DESK_PINGS_SECRET`. The function reads the open
  issues itself and decides; the workflow sends nothing about an issue. Pushes are signed with the Desk's VAPID key
  (RFC 8292), which lives only in Vercel.
- **Quiet hours.** None from 10pm to 7am Mountain (`QUIET_HOURS`): the first scan from 7am sends one summary of what
  still needs Nikita, and whatever was handled overnight is dropped.

**Setting up pings** (once, from the PC; nothing to install). In Chrome, open any page, press F12 > **Console**
(type `allow pasting` if Chrome asks), paste this and press Enter. It makes the push key pair and the shared secret
with the browser's own crypto and prints three lines:

```js
const k=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign"]);const b=a=>btoa(String.fromCharCode(...a)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");console.log("DESK_VAPID_PUBLIC_KEY",b(new Uint8Array(await crypto.subtle.exportKey("raw",k.publicKey))));console.log("DESK_VAPID_PRIVATE_KEY",(await crypto.subtle.exportKey("jwk",k.privateKey)).d);console.log("DESK_PINGS_SECRET",b(crypto.getRandomValues(new Uint8Array(32))));
```

Add all three in Vercel (Settings > Environment Variables, Production only), add `DESK_PINGS_SECRET` with the same
value as a GitHub Actions secret (Settings > Secrets and variables > Actions), redeploy, and close the console.

**Turning pings off:** switch off **Pings on this device**, or sign out on that device: either drops its
subscription on the server and in the browser. Removing a device under **Devices** drops its pings too, and pings
only ever go to a device whose passkey is still enrolled. The phone's own settings (Settings, Notifications, C.E.O.
on an iPhone) can mute them as well. **To stop all pings at once**, delete `DESK_PINGS_SECRET` (or the VAPID keys)
in Vercel and redeploy.

## Keys and settings in Vercel

Every secret lives only in Vercel's environment (Project, Settings, Environment Variables), never in the repo or the
browser, and no function logs or returns one. Which environments get each is in [DELIVERY.md](DELIVERY.md),
"Environments".

| Variable | What it is for | Without it |
| --- | --- | --- |
| `CLAUDE_API_KEY` | Claude Haiku: Rivet's shaping, the world step's hours, the day's story script | Shaping is off; hours and scripts come from the agents' own lines |
| `GEMINI_API_KEY` | Gemini's text to speech: the day's story, read aloud (#95). Sent only in a request header, with only the day's scrubbed script | No audio; the Chronicle says so |
| `GEMINI_BUDGET_USD` | Gemini's monthly cap, enforced in code (`api/_world/story.ts`); default 5, never above 10 | $5 |
| `FOUNDRY_DESK_KEY` | The Desk's enrolment secret: typed once per device to add its passkey, and the root every Desk signing key is derived from (#132). Long and random | Sign-in, the buttons and the story backfill say "not set up" |
| `FOUNDRY_APP_ID`, `FOUNDRY_APP_PRIVATE_KEY` | The crew's GitHub App (#138, below): every function mints its own hour-long token for this repo, as `ceo-foundry[bot]`. Production only | The functions use `FOUNDRY_GITHUB_TOKEN`, as before |
| `FOUNDRY_APP_INSTALLATION_ID` | Optional: the App's installation, to skip one lookup | Looked up once per warm function |
| `FOUNDRY_GITHUB_TOKEN` | The fallback until the App is set up: a fine-grained token that acts as Nikita. The Desk's buttons write issues with it; the feeds read with it | With the App set, nothing is lost; without either, buttons say "not set up" and the feeds read anonymously |
| `WORLD_BUDGET_USD` | The world's share of the $10 Claude cap (default 6) | $6 |
| `WORLD_STORE` | Which store the world uses (`blob`, `supabase`, `memory`) | `blob` |
| `BLOB_STORE_ID` | Set by Vercel when the private Blob store is connected; signed in with Vercel's OIDC token | The world isn't saved, and the Desk can't sign in |
| `DESK_VAPID_PUBLIC_KEY`, `DESK_VAPID_PRIVATE_KEY` | The Desk's Web Push key pair (#135): pings are signed with the private key, and browsers subscribe to the public one (public by design, handed to the Desk). Make them with the browser paste in "Setting up pings" below and paste them straight into Vercel. Production only | The switch says pings aren't set up |
| `DESK_VAPID_SUBJECT` | Optional: an `https:` or `mailto:` contact the push services may use about the pings | The site's address |
| `DESK_PINGS_SECRET` | Shared with the Desk pings workflow (the same value as the Actions secret below): only a caller holding it can make the Desk scan and ping. Long and random. Production only | No scans, so no pings |

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
| `DESK_PINGS_SECRET` | The Desk pings workflow (`.github/workflows/desk-pings.yml`, #135): sent only to the site's own `api/desk-pings` in a header, to ask it to scan. The same value as in Vercel; it can make the Desk look for things to ping, nothing else | The workflow skips quietly and no pings go out |
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
4. **GitHub secrets, in the browser.** Open the `.pem` from Downloads in Notepad and copy all of it. On GitHub:
   C.E.O. > **Settings** > **Secrets and variables** > **Actions** > **New repository secret**. Add
   `FOUNDRY_APP_ID` (the App ID) and `FOUNDRY_APP_PRIVATE_KEY` (paste the whole `.pem`, its BEGIN and END lines
   included).
5. **Vercel, in the browser.** The project > **Settings** > **Environment Variables**. Add the same two:
   `FOUNDRY_APP_ID`, and `FOUNDRY_APP_PRIVATE_KEY` with the `.pem` pasted as is (several lines is fine). Under
   **Environments**, tick **Production** only (untick Preview and Development). **Save**. Then **Deployments** >
   the top Production deployment > **⋯** > **Redeploy**, so the functions pick them up.
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

The Desk's pings use `web-push` (#135), the reference Web Push library for Node, kept by Mozilla's web-push-libs
project and used by most Node servers that send browser notifications: it does the payload encryption (RFC 8291) and
the VAPID signature (RFC 8292), both easy to get subtly wrong by hand. It only runs in `api/desk-pings.ts`.

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
