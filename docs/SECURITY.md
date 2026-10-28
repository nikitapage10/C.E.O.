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

Idea pictures stay in the private Azure Blob store (`ceo-state`). The issue names them but never links them, and
`api/foundry-image.ts` serves one only on a link that lasts minutes, signed with a key derived from the Desk key
(`api/_pictures.ts`): the function signs the Desk's own links for a signed-in Desk (#132), and Rivet's shaping call
gets one that lasts five. The Desk's idea cards show pictures only from that store, through that function, never
from another host.

## Relay's privacy rules

Relay's texts line (#535), a hub on the MacBook that reads iMessage and SMS through BlueBubbles, follows
[RELAY-PRIVACY.md](RELAY-PRIVACY.md) (#149, R5 in [THREAT-MODEL.md](THREAT-MODEL.md)). Message text stays on the
Mac except inside one trimmed, placeholdered snippet at a time, which the site passes to Claude with its own Key
Vault key under the texts line's own $10 and never stores; the Mac holds no model key. The hub only calls out, with
a paired token, and listens only on `127.0.0.1` for BlueBubbles' webhook. The public site gets counts, enum states
and timestamps only, in one allowlisted shape (`RelayStatus` and `readRelayStatus` in `packages/core/src/relay.ts`)
that refuses an unknown key or any free string. The signed-in Desk gets a sealed who's-waiting list (names, gists,
drafts) for 7 days at most. A send is a single-use, signed, 10-minute request made only on the Desk, after a passkey
unlock on that device that lasts 72 hours. Logs hold no content, everything has an end date, and one command wipes
the Mac.

## Signing in to the Desk

The Desk's buttons write to the public repo, so they need a real sign-in (#132, R3 in
[THREAT-MODEL.md](THREAT-MODEL.md)). Reading the Desk needs only a site session once the site is locked (below); writing
needs a passkey.

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

**Adding a device** (a new PC or phone; the **Setup** card on Today lists it until two devices can sign in, #164):
open the Desk on it, go to the Foundry tab, press **Add this device**,
give it a name, type the Desk key once, and confirm with the device's fingerprint, face or PIN. It is signed in
straight away, and from then on signs in with the passkey alone. A phone can also use a passkey saved on another
device through the browser's own "use a phone or another device" prompt. Up to ten devices.

**Removing a device:** signed in on any device, open **Devices** on the Foundry tab's sign-in bar and press
**Remove** next to it. Its sessions end at once. (Then delete the passkey from that device's own password manager
too, if you have it.) **If a device is lost or the Desk key may have leaked**, change `foundry-desk-key` in the Key Vault
and restart the Function App: every session and picture link ends, and enrolling needs the new key; then remove the lost device.

## The site lock

Nikita asked on 2026-10-22 for the whole site to stop being public (#236), and then for the Desk passkey to be the
only way in, with no password at all (#238: "I don't want a password on there"). Once the site is locked, every page
(the Desk, the Lattice, every Desk tab) and every `/api` route asks for a site session first; each device signs in
once with the Desk passkey and then stays signed in. **The site is locked by default** (Nikita, 2026-10-22): with
nothing stored, everything but the ways in below shows the login page until a device signs in. It is open only after
**Unlock** on the Desk, which stores `open: true`. With no store connected at all (a local run) there is nothing to
sign in against, so the gate stays off there.

- **Where it runs.** On Azure, the only home since #313, every function is wrapped in the same gate (`withGate` in
  `azure/src/index.ts`; [AZURE.md](AZURE.md), "The site lock on Azure"), and the Static Web App's own files stay
  reachable. On Vercel, while it still runs, Routing Middleware (`middleware.ts` at the repo root, Node.js runtime) runs in front
  of every request, the static pages and files as well as the functions, before `vercel.json`'s rewrites. The
  decision itself is `gateRequest` in `api/_site/gate.ts`, the same code the Azure functions run (below). The two
  routes it adds, `/api/site-login` and `/api/site-password` (the lock's control; the name is kept from #236), are
  rewritten in `vercel.json` into the Desk's sign-in function (`api/desk-auth.ts?site=…`), so the deployment keeps
  its twelve functions.
- **Locking it.** Locked from the start. To lock it again after an **Unlock**: on the Desk, sign in with a passkey,
  open **Site lock**, and press **Lock the site**; a box says how to get back in on any device (below) and asks to confirm.
  Your own browser stays signed in; every other device sees the login page once. The same place has **Sign out
  everywhere else** (every other device's site session ends) and **Unlock** (the site is open again). All of it
  needs a Desk passkey session, from the Desk's own pages (`api/_site/control.ts`); the site session alone can't
  change anything.
- **What is stored.** In the private blob store (`ceo-state`) beside the passkeys, at `desk/site/password.json` (the name is kept
  from #236): `passkey: true` (or `open: true` once unlocked), the date it was locked, and a random session version.
With nothing stored, the default lock uses a fixed session version until the first change. Nothing secret. A record #236
  wrote (a password's hash) reads as locked with the passkey; its hash is ignored and dropped at the next change.
- **The login page** (`api/_site/page.ts`) offers **Sign in with passkey** and, under it, **New device with no
  passkey? Add it** (the Desk key and a name for the device). There is no password field, and the login function
  (`api/_site/login.ts`) takes no password: a posted one is refused and opens nothing. The passkey needs a few lines
  of script, served by the login function itself (`/api/site-login?part=script`, `LOGIN_SCRIPT`) with Subresource
  Integrity, under a CSP that allows only that: `default-src 'none'; script-src 'self'; connect-src 'self';
  style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`. Nothing is inline but
  styles, nothing loads from anywhere else, and the script talks only to `/api/desk-auth`. Without script or
  WebAuthn, the page says a browser with passkeys is needed.
- **The sign-in** is the Desk's own (`api/desk-auth.ts`, "Signing in to the Desk" above): the same challenge, the
  same checks (origin, site, signature, the device's own unlock, the counter) and the same slow-downs and lockouts.
  While the site is locked, a successful `signin` or `enrol` also sets the site cookie (`passkeySiteCookie` in
  `api/_site/login.ts`), so one tap opens both the site (180 days) and the Desk (30 minutes, as before).
- **The session.** One cookie, `__Host-ceo-site`: HttpOnly, Secure, SameSite=Lax, a token signed with HMAC-SHA256
  (`api/_site/session.ts`) that lasts 180 days and slides: used a day or more after its last renewal, it is renewed
  for another 180 days, so a device in use is never asked again. It carries the session version and how it signed in
  (`f: ["passkey"]`); a #236 password cookie is no longer read. **Sign out everywhere else** and locking again make a
  new version, which ends every older cookie (each server instance re-reads the record at least every 20 seconds).
  Lax rather than Strict, so a ping, a bookmark or a link from elsewhere arrives signed in; every write still needs
  the Desk's own Strict passkey session.
- **The key that signs it.** `SITE_SESSION_SECRET` when it is set (at least 32 random characters);
  otherwise derived from the Desk key (`FOUNDRY_DESK_KEY`, stretched with scrypt, purpose `site`, `api/_site/state.ts`),
  so no new variable is needed. Changing either signs every device out of the site.
- **If the store can't be read**, an instance uses the last record it read; with none at all, it fails closed (the
  login page says to try again in a minute), except for the machine callers below.

**Getting in on a new device, and never being locked out.** Locking needs a Desk passkey session, so at least one
device already has a passkey. From then on:

1. **A synced passkey.** A passkey saved in Google Password Manager (Chrome, signed in to the same Google account) is
   on Nikita's other Chrome devices too: **Sign in with passkey** works there at once. Chrome can also use a phone's
   passkey through a QR code ("Use a phone or tablet").
2. **Add this device.** On the login page, **New device with no passkey? Add it**: the Desk key and a name. It is the
   Desk's own enrolment (#132: the Desk key, its lockout, the ten-device limit), and it signs the new device in to
   both the site and the Desk.
3. **Break glass.** Only if every passkey and the Desk key are lost: set `SITE_GATE` to `off` as a Function App
   setting (Azure portal > **Function App** > the C.E.O. app > **Settings** > **Environment variables** > **App
   settings** > **+ Add**, then **Apply**; the app restarts): the gate is off whatever is stored. Delete it to turn the
   gate back on. The next template paste drops a setting added by hand, which also turns the gate back on. (A new Desk
   key can also be set in the Key Vault as `foundry-desk-key`, as in "Signing in to the Desk", which signs every
   device out and lets a device enrol with the new key.)

The Desk says this before locking (the confirm box) and under **Site lock** while it's locked (`RECOVERY` in
`apps/world/src/desk/SitePassword.tsx`), so the only way to need the break glass is to lose every passkey and the
Desk key, and that is said on screen. If the Desk key isn't set on the server there are no passkeys at all, and the
login page says signing in isn't set up.

**Setting up the live watch's key.** The secrets paste in [AZURE.md](AZURE.md) ("After the paste") mints
`site-bypass-token` in the Key Vault (#313), and `live-watch.yml` reads it from there at run time, so GitHub keeps no
copy. To make one by hand instead (from the PC, nothing to install): in Chrome, open any page, F12 > **Console**
(type `allow pasting` if Chrome asks), paste this and press Enter:

```js
console.log("SITE_BYPASS_TOKEN",btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""));
```

Copy the value it prints and add it to the Azure Key Vault (`kv-ceo-…`: **Key vaults** > the vault > **Objects** > **Secrets**, then **Restart** the Function App; [AZURE.md](AZURE.md), "After the paste") as `site-bypass-token`. Close the console. To change it, do the same
with a new value.

**What passes without a site session** (`decide` in `api/_site/gate.ts`; each has a test in `api/_site/site.test.ts`):

| What | Who uses it | How it is let through |
| --- | --- | --- |
| `/api/site-login` (GET and POST) | Everyone: the login page, its passkey script (`?part=script`) and its sign-out | Always: it is the way in. It takes no password (#238) |
| `/api/desk-auth` (GET, HEAD and POST), with no `site` query or only `site=login` (#238) | The login page's script: the Desk's sign-in state, **Sign in with passkey** (`signin-options`, `signin`) and **Add this device** (`enrol-options`, `enrol`) | The function guards every action itself: a sign-in needs an enrolled passkey and the device's unlock, an enrolment needs the Desk key, removing a device needs a Desk session, all slowed and locked out after failures; its GET says only whether this browser is signed in to the Desk (and lists devices only when it is). `?site=password`, the lock's control, stays behind the gate (`isPasskeyPath`) |
| `/assets/*`, `/models/*`, `/desk/*`, `/tide/*`, `/manifest.webmanifest`, `/sw.js`, `/favicon.ico`, `/robots.txt` (GET and HEAD, plain paths only) | The browser: the app's bundles, the 3D models, the images, the PWA manifest and its icons (fetched without cookies), the service worker | Static files built from this public repo, holding nothing that isn't already on GitHub; pages and data stay behind the gate |
| `POST /api/world-step` | The hourly `world-step.yml` workflow, the Function App's own timer (in-process, no HTTP), `scripts/foundry-watch.sh` | Open by design (calling it more often changes nothing, R6); its answer now says only whether it stepped and when, never the hour's words. Its `GET` (the Desk's world clock) is behind the gate |
| `POST /api/desk-pings` with `Authorization: Bearer <DESK_PINGS_SECRET>` | `desk-pings.yml`, which reads the secret from the Key Vault | The gate checks the secret itself, in constant time, and the function checks it again; every other ping action needs a site session and a Desk session |
| `POST /api/skippy-answer` with `Authorization: Bearer <SUBMIND_FEED_TOKEN>` (#312) | Skippy's and the room subminds' threads, answering a question Desk Skippy handed off | The gate checks the key itself, at least 32 characters, in constant time, on that one path and method, and the function checks it again; it can only attach one plain line (700 characters at most, held back whole when it looks private) to a turn that was handed off and isn't answered yet, and the ping it sends names who answered, never what. Without the key set the route is off |
| Any route with `x-ceo-site-bypass: <SITE_BYPASS_TOKEN>` | `live-watch.yml` (`scripts/boot-check.mjs --url`) only, since #313: the backup reads Azure's own store, and the final copy from Vercel uses Vercel's Blob token | A shared secret, at least 32 characters, compared in constant time, read from the Key Vault (`site-bypass-token`) at run time; the workflow sends it only to the site, from a file or a same-origin browser route, and never print it. Without it, the live watch only checks that the login page answers |

| GET of a room read with `x-ceo-room-key: <SUBMIND_LOG_TOKEN>` (or `Authorization: Bearer`) | The active submind threads (#281): the four active rooms' Asked Skippy logs, the Green's league, the Exchange's board and positions, the world feed (and `?day=`), the Foundry feed, the room feed | The read key, from the Key Vault only, at least 32 characters, compared in constant time; exactly the listed paths and queries, GET only (`api/_site/roomkeys.ts`), and the private handlers check the key again. See "The subminds' room keys" below |
| `POST /api/room-feed` with `x-ceo-room-key: <SUBMIND_FEED_TOKEN>` (or `Authorization: Bearer`) | The active submind threads posting a short room event (#281) | The feed key, the same way; that one write only, which answers `{ ok, id }` and nothing more |
| `POST /api/setup-asks` with `x-ceo-room-key: <SUBMIND_FEED_TOKEN>` (or `Authorization: Bearer`) | The active submind threads posting a setup ask, or closing one with its Trail line (#324) | The feed key, the same way, no query; it can't approve its own ask (only the passkey session can), and it answers `{ ok, id }` or `{ ok }`. A new ask pings Nikita's phone with counts-only words. See "Setup asks" below |
| `POST /api/relay-hub` (no query, `?view=texts`, `results`, `sort`, `draft` or `unpair`) and `GET /api/relay-hub?view=requests` or `?view=skip`, with `Authorization: Bearer <a hub token>` (#535) | Relay's hub on the MacBook: its status, its who's-waiting list, its model snippets, its poll for the Desk's send requests and their results, the skip terms | The hub token is `rh1.<pairing id>.<HMAC>` with a key derived from `FOUNDRY_DESK_KEY`; the gate checks the signature on exactly those methods and views, and the route checks the token's hash against the pairing on record (Unpair ends it at once). Nothing else opens with it ([RELAY-PRIVACY.md](RELAY-PRIVACY.md), "Mac to the site") |
| `POST /api/relay-pair`, no query (#535) | The Relay installer, once, trading the Desk's one-time pair code for the hub token | The code is the lock: 8 characters, 10 minutes, 5 wrong tries, kept only as a hash, made only with the Desk's send unlock and never while a Mac is paired; a request with an `Origin` header is refused, so a web page can't pair |
| `GET /api/relay?view=status`, exactly (#535) | `relay status` and `relay wipe --verify` on the Mac | Relay's public counts (`RelayStatus`: counts, enum states, timestamps), public by design; every other method or query of `/api/relay` stays behind the lock and the passkey session |
| `GET /api/skippy-tools?read=<room>`, `POST /api/skippy-tools?act=kernel` with `x-ceo-voice-tool: <a call's tool token>` (#479) | ElevenLabs, mid-call, when Skippy or a submind looks up a live room on a Talk call | A random token per call, signed with a key derived from `FOUNDRY_DESK_KEY` (no new secret), good for the call's longest plus two minutes; the gate checks the signature and expiry on that one path (GET or POST), and the route checks the token is kept with its call (as a hash) and not ended. It reaches ElevenLabs as a `secret__` dynamic variable, which is bound to tool headers only and never sent to the LLM. Reads scrubbed, and the one write is an ask filed for Skippy's own thread (privacy-checked, five per call); the book's and the bill's dollars go only to that call, Relay's only as counts |

Nothing else is exempt. The local checks (`scripts/boot-check.mjs` on a build, the browser tests) don't run the
middleware, so they see the site as before; `tests/e2e/gate.spec.ts` runs the same gate, the login function and the
Desk's sign-in in front of the built site, locked, with Chromium's virtual authenticator as the device: no password
field, a wrong Desk key refused, a new device added with the right one and back on the page it asked for, then
signed in again with its passkey in one tap.

**A second step later (2FA), not built.** Nikita may want one later: a new device approved from a signed-in one, or
an emailed link. The hook is in place: the record's `second` field and each site session's `f` (how it signed in).
When `second` is `"approval"`, the gate asks for a session that carries both `passkey` and `approval`
(`sessionFits` in `api/_site/session.ts`). Nothing sets it and the Desk can't; building it means a step after the
passkey (say, the new device waits on the login page while a signed-in Desk taps **Approve**) that adds `approval`
to the session, then a switch on the Desk. Until then, setting it by hand would lock every device out.

**On Azure** (docs/AZURE.md, "The site lock on Azure"): the Static Web App has no middleware, so the same gate
runs in front of every Azure function, the login page is `/api/site-login`, and the Desk and the Lattice go there
when an API call answers 401 with `x-ceo-site-gate: locked` (`apps/world/src/siteGate.ts`). Passkeys belong to one
domain, so the Azure copy has its own: lock it from the Azure Desk, after enrolling a passkey there. The Static Web App's own
files stay reachable there until its own authentication is set up.

## The subminds' room keys

Nikita approved two narrow keys for the subminds' project threads on 2026-10-22 (#281; [SKIPPY.md](SKIPPY.md), "Room
keys"; Nikita's steps in [AZURE.md](AZURE.md), "The subminds' room keys"):

- **Two keys, two directions.** `SUBMIND_LOG_TOKEN` reads (GET only, the listed room data, the Asked Skippy log's `needs` filter included); `SUBMIND_FEED_TOKEN` writes
  (POST `/api/room-feed`, POST `/api/setup-asks` for a setup ask or its Trail line, #324, and POST `/api/skippy-answer` for a hand-off's answer, #312) and reads nothing. Each opens only its own exact method, path and query
  (`LOG_READS`, `isFeedWrite` in `api/_site/roomkeys.ts`): another route, an extra or repeated query key, an encoded
  path, HEAD or any other POST is refused by the gate, and the handlers that hold private data
  (`/api/skippy-log`, `/api/exchange-positions`, `/api/room-feed`, `/api/setup-asks`) check the key again, so the same holds while the site
  is unlocked. The read key sees the Asked Skippy log of the four active rooms only, never Relay's.
- **What they can't do.** Change a setting (no Desk write takes them: the Desk's own writes need a passkey session),
  trade (positions are read through the two allow-listed Polymarket GETs, `api/_exchange/positions.ts`), send
  anything (no email, invoice or ping route takes them), or reach an upstream secret (no route returns one).
- **The keys themselves.** Key Vault only (`submind-log-token`, `submind-feed-token`), minted by the secrets paste, never
  in the repo, an issue, a file or a chat; the threads read them from the project's cloud environment. Each must be at
  least 32 characters and differ from the other and from `FOUNDRY_DESK_KEY`, `SITE_BYPASS_TOKEN`, `SITE_SESSION_SECRET`,
  `DESK_PINGS_SECRET` and `GMAIL_TOKEN_KEY`, or it counts as unset. Both are compared in constant time (hashed first, so
  their lengths don't show), and sent in their own header (`x-ceo-room-key`) or as a bearer token.
- **The feed.** A room (one of the four), a title of 120 characters at most and an optional detail of 600, in the
  private blob store (`desk/rooms/feed.json`: the last 200, 14 days at most), at most 20 per room an hour. An event
  that trips the Desk's privacy check (`privateParts`) or carries a copy of either key is refused whole (422). A Desk
  passkey session or the read key gets each event's detail; everyone else, and the Lattice always (`?view=public`),
  gets the titles only, with money and links replaced by "…" (`publicTitle`). Every answer is `private, no-store`.
- **If a key leaks**, give the secret a new version in the vault and restart the Function App: the old key opens
  nothing from then on ([AZURE.md](AZURE.md), step 3).


## Setup asks

When a submind's thread needs something set up only Nikita can allow (#324; [SKIPPY.md](SKIPPY.md), "Setup asks"):

- **No keys through people or threads.** Agents never type keys, passwords or tokens, and never do sign-ins (Skippy's
  rule on #324). Each ask names its route, and the first choice needs no key: a managed identity, then OIDC federation;
  where a key can't be avoided, a machine-to-machine flow that lands it straight in the Key Vault; last, steps in
  Nikita's own browser that stop at every sign-in and passkey. An ask whose words ask anyone to type, paste or copy a
  key, password or token is refused (422 `asks-for-secret`), and so is one that looks private or carries a room key.
- **Only Nikita says yes.** Approve and Decline need the Desk's passkey session (`requireSession`, same-origin); the
  feed key can post an ask and close it, but "done" only after Nikita approved. Nothing is changed until then.
- **Owner only.** `GET /api/setup-asks` answers the passkey session or the read key, nothing else; there is no public
  view, and the Lattice never reads it. The Desk shows the panel only signed in, veiled by Hide.
- **Bounded.** Five new asks an hour, eight waiting at once; the last 100, none untouched for 30 days, in the private
  store (`desk/rooms/setup.json`). Its ping says only that an ask is waiting, never what it says; quiet hours hold it.

## The email agent

Relay's email agent (#263, [GMAIL.md](GMAIL.md)) runs only on the Azure copy. It reads Gmail with the read-only
scope (`gmail.readonly`), so nothing can be sent, archived or deleted. The refresh token and the private mail list
are sealed (AES-256-GCM, `GMAIL_TOKEN_KEY`) in the private store; the list reaches only the Desk's passkey session and
is masked by Hide; the public site gets counts and states only (`EmailStatus`, an allowlist with a test). Mail is
untrusted input to Claude: fenced as data, no tools, structured output checked in code. Connect Gmail is the OAuth
web flow with a signed, short-lived state cookie checked in constant time. Its own Claude cap is `EMAIL_BUDGET_USD`.

## The Spire's invoices

The Spire's PayPal invoicing (#279, [PAYPAL.md](PAYPAL.md)) runs only on the Azure copy, with the REST app's client
id and secret as Key Vault secrets; the access token stays in the function's memory. It makes **draft** invoices from
the Desk; the only call that reaches a client is send, which needs the passkey session, the Desk's own origin, a JSON
`POST` and `confirm: true`, which the page adds only after its in-page "Yes, send it" step. Drafts are validated on
the server (email, amounts above 0 with two decimals, at most 20 lines, lengths). The request function refuses every
PayPal path but the invoicing ones. The list is private (`private, no-store`, masked by Hide); the public site gets
counts only (`InvoiceStatus`, an allowlist with a test). Nothing is stored or logged.

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
  already pinged (`idea:#12`, `question:#12:<hash>`, `blocker:#12`), forgotten once the issue closes; and when the
  workflow last scanned with the right secret, which is how the setup list sees the Actions secret (#164). No issue
  text, nothing personal.
- **What a ping says.** Only counts and who is asking, safe on a lock screen anyone might see: "Rivet has a
  question", "3 ideas are waiting for your pick", "A job is blocked and needs you" (`pingText` in
  `api/_desk/pings.ts`). Never a title, a body, a name, an issue number or a link. The words are encrypted for the
  device (RFC 8291), so the push service only ever carries ciphertext. Tapping one opens the Desk's Foundry tab.
- **Who sends.** `.github/workflows/desk-pings.yml` runs when a Foundry issue is opened or relabelled, and every
  hour, and asks `api/desk-pings.ts` to scan with the shared `DESK_PINGS_SECRET`. The function reads the open
  issues itself and decides; the workflow sends nothing about an issue. Pushes are signed with the Desk's VAPID key
  (RFC 8292), which lives only in the Azure Key Vault.
- **Quiet hours.** None from 10pm to 7am Mountain (`QUIET_HOURS`): the first scan from 7am sends one summary of what
  still needs Nikita, and whatever was handled overnight is dropped.

**Setting up pings** (once, from the PC; nothing to install). The **Setup** card on Today has these steps, the
paste with a Copy button and its links, and ticks itself off once the keys are in the Key Vault and the next hourly
scan gets through with the secret. The secrets paste in [AZURE.md](AZURE.md) mints all three for you; by hand: In Chrome, open any page, press F12 > **Console**
(type `allow pasting` if Chrome asks), paste this and press Enter. It makes the push key pair and the shared secret
with the browser's own crypto and prints three lines:

```js
const k=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign"]);const b=a=>btoa(String.fromCharCode(...a)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");console.log("DESK_VAPID_PUBLIC_KEY",b(new Uint8Array(await crypto.subtle.exportKey("raw",k.publicKey))));console.log("DESK_VAPID_PRIVATE_KEY",(await crypto.subtle.exportKey("jwk",k.privateKey)).d);console.log("DESK_PINGS_SECRET",b(crypto.getRandomValues(new Uint8Array(32))));
```

Add all three to the Azure Key Vault (`kv-ceo-…`: **Key vaults** > the vault > **Objects** > **Secrets**, then **Restart** the Function App; [AZURE.md](AZURE.md), "After the paste"), as `desk-vapid-public-key`, `desk-vapid-private-key` and `desk-pings-secret`, and close the
console. GitHub needs no copy: `desk-pings.yml` reads the secret from the vault.

**Turning pings off:** switch off **Pings on this device**, or sign out on that device: either drops its
subscription on the server and in the browser. Removing a device under **Devices** drops its pings too, and pings
only ever go to a device whose passkey is still enrolled. The phone's own settings (Settings, Notifications, C.E.O.
on an iPhone) can mute them as well. **To stop all pings at once**, delete `DESK_PINGS_SECRET` (or the VAPID keys)
in the Key Vault and restart the Function App.

## Setting keys from the Desk

Since #330, a third-party key is set or replaced on the Desk instead of in Cloud Shell: **Boiler Room → Security →
Keys**, signed in. It is write-only by design:

- **Only allowlisted names** (`api/_keys/allowlist.ts`): `claude-api-key`, `fantasypros`,
  `polymarket-us-key-id`, `polymarket-us-secret-key`, `gmail-client-id`, `gmail-client-secret`, `paypal-client-id`,
  `paypal-client-secret`, `elevenlabs`, `openai`, `email-skip-terms` and `email-priority`. Never anything that guards the lock, the crew
  or sealed data: `foundry-desk-key`, `site-bypass-token`, `desk-pings-secret`, `foundry-github-token`,
  `foundry-app-*`, `desk-vapid-*`, `gmail-token-key` and `submind-*` are refused by name and by pattern, so a stolen
  session can't hand itself a way back in. A unit test pins both lists and puts every secret in the template on
  exactly one.
- **Per-secret scope in Azure first, the allowlist on top.** The role paste (AZURE.md, "The template on every
  deploy") gives the Function App's identity Key Vault Secrets Officer on each of those twelve secrets alone
  (`<vault>/secrets/<name>`), never on the vault, so Azure itself refuses a write to any other secret, whatever the
  code does. The allowlist in code is defence in depth on top of that scope: an off-list name is refused before the
  vault is called. A secret the paste had to create so it could carry its role holds a tagged placeholder
  (`ceo-placeholder-not-a-key`, tag `ceo-placeholder`), never a key: the Desk shows it as not set, the app treats it
  as unset at start-up and in the key refresh, and the form won't take it as a value.
- **A fresh passkey for every write, bound to that write.** The session cookie alone sets nothing: `POST /api/keys`
  needs a passkey answer from that session's own passkey to a challenge handed out in the last two minutes, checked by
  the same WebAuthn code as the sign-in (`api/_desk/assert.ts`). The challenge is asked for one write: the browser
  sends h = sha256(name + "\n" + value) for its options, the signed challenge cookie keeps a keyed hash of h, and the
  set is refused unless its own name and value hash to the same, so an answer can't be spent on another key or value.
  It is used once: the challenge is marked spent with an atomic create-if-absent write in the private store
  (`If-None-Match: *`, `claim` in `api/_desk/store.ts`) before the vault is called, so two requests racing with one
  answer can't both write. A failed step-up counts against the sign-in's lockout.
- **Nothing comes back.** The route can set or replace a value; it can't read one, list values or delete
  (`api/_keys/vault.ts` has only `set` and the vault's list of names and dates). The Desk sees each key's name,
  whether it is set and when, never a value, a length or a hash. The vault's answer to a write, which repeats the
  value, is dropped in `azure/src/vault.ts`. The trail (`desk/keys/trail.json`) and the log keep the name and the time
  only; a test checks the value appears in no answer, log line or trail entry.
- **The usual Desk-write guards:** JSON only, same origin, `SameSite=Strict` cookie, a 16 KB body and a 4 KB
  one-line value at most, and six writes in a row before a wait (then a 15-minute lockout).
- **How the app picks it up:** each instance checks the vault's dates at most every two minutes and reads only an
  allowlisted key newer than its own copy into that one setting (`azure/src/keys.ts`); the instance that wrote it takes
  it at once. That needs only Key Vault Secrets User, which the app already had.

## Keys and settings in the Key Vault

Every secret lives only in the Azure Key Vault (#313), as a Key Vault reference in the Function App's settings, read
by the app's own identity; never in the repo or the browser, and no function logs or returns one. Since #330 the
template is applied by the deploy on every merge (AZURE.md, "The template on every deploy"), and the third-party keys
above can be written from the Desk. The names below
are the app settings; the vault's secret for each is in [AZURE.md](AZURE.md) ("After the paste"). The budgets,
`WORLD_STORE` and `KEY_VAULT_URI` (the vault's address, for the Keys form) are plain app settings the template
writes. Which environments get each is in [DELIVERY.md](DELIVERY.md), "Environments".

| Variable | What it is for | Without it |
| --- | --- | --- |
| `CLAUDE_API_KEY` | Claude Haiku: Rivet's shaping, the world step's hours, the day's story script, Skippy's chat on Today (#224) | Shaping and Skippy's chat are off; hours and scripts come from the agents' own lines |
| `ELEVENLABS_API_KEY` | The only voice (#365, #472): the day's story, the week in Ilyr and Skippy's live calls. Sent only in a request header, with only the scrubbed script | The script still shows; the audio says it is waiting on ElevenLabs. Nothing else reads |
| `ELEVENLABS_VOICE_ID` | The one voice for everything spoken (default Daniel, a premade British male voice); letters and digits only | Daniel |
| `ELEVENLABS_BUDGET_USD` | ElevenLabs' monthly cap, enforced in code (`api/_world/story.ts`), shared by the stories and the live calls; default 10, never above 10 | $10 |
| `FOUNDRY_DESK_KEY` | The Desk's enrolment secret: typed once per device to add its passkey, and the root every Desk signing key is derived from (#132). Long and random | Sign-in, the buttons and the story backfill say "not set up" |
| `FOUNDRY_APP_ID`, `FOUNDRY_APP_PRIVATE_KEY` | The crew's GitHub App (#138, below): every function mints its own hour-long token for this repo, as `ceo-foundry[bot]`. Production only | The functions use `FOUNDRY_GITHUB_TOKEN`, as before |
| `FOUNDRY_APP_INSTALLATION_ID` | Optional: the App's installation, to skip one lookup | Looked up once per warm function |
| `FOUNDRY_GITHUB_TOKEN` | The fallback until the App is set up: a fine-grained token that acts as Nikita. The Desk's buttons write issues with it; the feeds read with it | With the App set, nothing is lost; without either, buttons say "not set up" and the feeds read anonymously |
| `WORLD_BUDGET_USD` | The world's share of the $10 Claude cap (default 6) | $6 |
| `SKIPPY_BUDGET_USD` | Skippy's chat's share of the $10 Claude cap (#224, `api/_skippy/budget.ts`; Claude Sonnet 5.5 with Opus 5.5 for hard questions and a fenced web lookup since #264); never more than the cap leaves after the world's share and $2 kept for Rivet's shaping | $2 |
| `WORLD_STORE` | Which store the world uses (`blob`, `supabase`, `memory`) | `blob` |
| `WORLD_STORE=azureblob`, `AZURE_STORAGE_ACCOUNT`, `AZURE_STORAGE_CONTAINER` | Set by the template: the private `ceo-state` container, signed in with the Function App's managed identity (no key). `BLOB_STORE_ID` was Vercel's counterpart | The world isn't saved, and the Desk can't sign in |
| `DESK_VAPID_PUBLIC_KEY`, `DESK_VAPID_PRIVATE_KEY` | The Desk's Web Push key pair (#135): pings are signed with the private key, and browsers subscribe to the public one (public by design, handed to the Desk). Made by the secrets paste, or the browser paste in "Setting up pings" above | The switch says pings aren't set up |
| `DESK_VAPID_SUBJECT` | Optional: an `https:` or `mailto:` contact the push services may use about the pings | The site's address |
| `DESK_PINGS_SECRET` | Shared with the Desk pings workflow, which reads it from the vault: only a caller holding it can make the Desk scan and ping. Long and random | No scans, so no pings |
| `SITE_BYPASS_TOKEN` | The site lock's key for the live watch (#236, #313), which reads it from the vault (`site-bypass-token`) and sends it in `x-ceo-site-bypass`. At least 32 random characters | The live watch only checks the login page |
| `SUBMIND_LOG_TOKEN`, `SUBMIND_FEED_TOKEN` | The subminds' room keys (#281, "The subminds' room keys" above): read-only GETs of room data, and write-only room events. **Azure only** (`submind-log-token`, `submind-feed-token`), minted by the secrets paste. At least 32 random characters, different from each other and the site's secrets | The keys open nothing; the threads read and post nothing |
| `SITE_SESSION_SECRET` | Optional: signs the site's sign-in cookies (#236). At least 32 random characters | Derived from `FOUNDRY_DESK_KEY` |
| `POLYMARKET_US_KEY_ID`, `POLYMARKET_US_SECRET_KEY` | Nikita's Polymarket US API key (#253), for the Exchange's private positions board. As Key Vault references (`polymarket-us-key-id`, `polymarket-us-secret-key`); never set on Vercel. Polymarket US keys have no read-only scope, so the code keeps it read-only: `api/_exchange/positions.ts` signs only GET requests to `/v1/portfolio/positions` and `/v1/portfolio/activities` (an allow-list, with a test that fails if an order, account, RFQ, combo or WebSocket path becomes reachable), never logs or returns the key, and answers only a signed-in Desk (`private, no-store`). Revoke it at polymarket.us/developer if in doubt | The positions board says it's waiting for the key |
| `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` | The email agent's Google OAuth client (#263, [GMAIL.md](GMAIL.md)). **Azure only**, as Key Vault references (`gmail-client-id`, `gmail-client-secret`) | Connect Gmail is off; the Relay page says it's waiting for the keys |
| `GMAIL_TOKEN_KEY` | 32 random bytes that seal the Gmail refresh token and the private mail list at rest (`api/_email/seal.ts`). **Azure only** (`gmail-token-key`). Replacing it locks the stored token away: Connect Gmail again | The email agent waits |
| `EMAIL_BUDGET_USD` | The email agent's own monthly Claude cap (#263), separate from the others; at the cap it only counts new mail. **Azure only** | $10 |
| `RELAY_BUDGET_USD` | Relay's texts line's own monthly Claude cap (#535, `api/_relay/budget.ts`), on its own ledger apart from email's; at the cap the model calls stop and the hub reports models down. Never more than 10. **Azure only** | $10 |
| `SITE_GATE` | Break glass: `off` turns the site lock off whatever is stored (#236, #238) | The gate follows the stored lock |

## What scans the code, and when

| Check | Runs on | What it looks for | Where findings show |
| --- | --- | --- | --- |
| Checks (`.github/workflows/checks.yml`) | Every push to `main`, every pull request, nightly | Typecheck, lint, tests, build and a boot check (the built Desk and Lattice load in Chromium without a page error), plus `npm audit signatures` (every package's registry signature and provenance) and `npm audit --audit-level=high` (known vulnerabilities rated high or critical) | The pull request's checks; a failure on `main` opens a Foundry fix issue |
| CodeQL (`.github/workflows/codeql.yml`) | Pushes to `main`, pull requests, weekly | Security bugs and code quality problems in the TypeScript, JavaScript and workflow files, using the `security-and-quality` query suite | Security tab, Code scanning; annotations on the changed lines of a pull request |
| Dependency review (`.github/workflows/dependency-review.yml`) | Every pull request | Packages or actions the change adds or bumps that carry a known vulnerability; fails on high or critical | The pull request's checks, with a summary of what changed |
| OpenSSF Scorecard (`.github/workflows/scorecard.yml`) | Pushes to `main`, weekly | How the repo is run: pinned actions, workflow permissions, branch protection, dependency updates | Security tab, Code scanning (category `scorecard`) |
| Dependabot (`.github/dependabot.yml`) | Weekly, and at once for a security fix | Out-of-date or vulnerable npm packages and GitHub Actions | Pull requests labelled `dependencies`; alerts in the Security tab |
| Live watch (`.github/workflows/live-watch.yml`, #181) | Hourly | Not a security scan: the live Desk and Lattice open in Chromium without a page error. Reads only the public site; its report job is the only one that may write, and only issues | A "Live site not loading" `foundry:fix` issue labelled `foundry:down` (which pings); Systems on the Desk |
| Visual QA (`.github/workflows/visual-qa.yml`) | Every push to `main` | Not a security scan: Gemini watches a clip of each Lattice room for visual bugs. Listed because it is the one workflow that sends data out (renders of the public Lattice only) and holds an outside key | A `foundry:fix` issue per room with a blocker; the run's summary; Systems > Foundry on the Desk |
| Secret scanning | Every push | Keys and tokens committed by mistake; push protection blocks the push | Security tab, Secret scanning |

Every action in the workflows is pinned to a full commit SHA with its version in a comment, so a moved tag can't
change what runs. Dependabot proposes the bumps. Each workflow starts with read-only permissions and grants write
access only to the job that needs it.

## What GitHub can do in Azure

The deploy signs in to Azure with OIDC, trusted only for this repo's `azure` environment, which only `main` may use
(GitHub: Settings → Environments → `azure` → Deployment branches: `main`). It holds Contributor on `rg-ceo-prod`, blob
data access, Key Vault Secrets User, and (#330) Role Based Access Control Administrator on `rg-ceo-prod` with a
condition: it may assign only the template's own roles, each only to the identity the template names (the Function
App, Nikita, itself), and may never delete an assignment. It can't grant itself anything new, can't write a secret,
and has nothing outside the group. The job that applies the template runs only on a push to `main` (or a run by hand
from `main`), pins every action by SHA, reads back what is live before applying so nothing is reset, and prints only
names, plain values and property paths. The role design and the paste are in [AZURE.md](AZURE.md), "The template on
every deploy".

## Keys in GitHub Actions

These live in the repo's Actions secrets (Settings > Secrets and variables > Actions) rather than in the Key Vault,
because only a workflow uses them. Workflows never print them. The workflows that sign in to Azure (OIDC, `main`
only) read what they need from the vault instead and keep no copy here.

| Secret | What it is for | Without it |
| --- | --- | --- |
| `FOUNDRY_APP_ID`, `FOUNDRY_APP_PRIVATE_KEY` | The crew's GitHub App (#138, below). Only the two `report` jobs (`checks.yml`, `visual-qa.yml`) use them, to open fix issues as `ceo-foundry[bot]` with a token that can only write issues and is revoked when the job ends | Those jobs write with the built-in token, as before |
| `DESK_PINGS_SECRET` | **To be removed after the cut-over (#313).** Vercel's pings secret: no workflow reads it since #313 (`desk-pings.yml` reads `desk-pings-secret` from the Key Vault). Nikita deletes it in the last step of [AZURE.md](AZURE.md), "Retiring Vercel" | Nothing |
| `SITE_BYPASS_TOKEN` | **To be removed after the cut-over (#313).** Vercel's site lock bypass: only the backup workflow's public-mode seed (the fallback for the final copy from Vercel) still sends it, to the Vercel site only; the live watch reads `site-bypass-token` from the Key Vault. Nikita deletes it in the last step of "Retiring Vercel" | The public-mode seed sees Vercel's login page (the Blob-mode seed doesn't need it) |
| `BLOB_READ_WRITE_TOKEN` | Only for the final world copy from Vercel (#313), Blob mode: added for about ten minutes, then deleted ([AZURE.md](AZURE.md), "Retiring Vercel") | Normally absent |
| `GEMINI_API_KEY` | Visual QA's review step only (`.github/workflows/visual-qa.yml`, #91): clips of the public Lattice go to Gemini. Sent only to Google's API host in a header, never printed; spend capped in code at $0.50 a run and eight pushed runs a day. The same name on the Function App (`gemini-api-key` in the vault) is the separate key for the day's story (above) | The tour still records; the review is skipped |

## The crew's own identity

The crew has its own GitHub identity (#138, R2 in [THREAT-MODEL.md](THREAT-MODEL.md)): a GitHub App called
`ceo-foundry`, installed on this repo only, that acts as `ceo-foundry[bot]`. Once it is set up:

- **Every function that talks to GitHub** mints its own token from the App's key (`api/_github.ts`): a JSON Web
  Token signed with the key, exchanged for an installation token for this repo only, kept until five minutes before
  it expires (GitHub gives them an hour). The Desk's buttons get a token that can only write issues; the feeds and the
  world step get one that can only read.
- **CI's fix issues** (`checks.yml` and `visual-qa.yml`, the `report` jobs) come from the App too, on a token that can
  only write issues and is revoked when the job ends. No workflow's permissions changed.
- **The Foundry's readers trust it like the Desk**: `scripts/foundry-issue.sh` shows its words in their own block,
  and the world step counts its trail steps. Look-alike accounts are still withheld.
- **Until then, and whenever GitHub won't mint a token**, everything works exactly as before, on
  `FOUNDRY_GITHUB_TOKEN` on the Function App and the built-in token in CI. A failed mint is retried after a minute and logs
  only GitHub's status code.

What it doesn't change: the Foundry's Claude Code sessions push, open pull requests and merge with the GitHub
access their environment gives them, which is Nikita's account today. That is set where the sessions run, not in this
repo, so their work still shows as Nikita's (DELIVERY.md, section 10).

**Setup, once (Nikita).** About five minutes, all in the browser. The **Setup** card on Today has the same steps
with links, and ticks itself off once `FOUNDRY_APP_ID` and `FOUNDRY_APP_PRIVATE_KEY` are in the Key Vault.

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
5. **The Key Vault, in the browser.** Add the same two to the Azure Key Vault (`kv-ceo-…`: **Key vaults** > the vault > **Objects** > **Secrets**, then **Restart** the Function App; [AZURE.md](AZURE.md), "After the paste"): `foundry-app-id`, and `foundry-app-private-key`
   with the `.pem` pasted as is (several lines is fine; `foundry-app-installation-id` is optional).
6. **Check it, then retire the old token.** The next Desk button you press leaves its trail comment on GitHub as
   `ceo-foundry[bot]` instead of you. Once it does, disable `foundry-github-token` in the Key Vault (the secret > its
   version > **Enabled: No**) and revoke it on GitHub (Settings > Developer settings > Personal access tokens > Fine-grained tokens), so
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
9. **The `azure` environment is for `main` only:** Settings > Environments > `azure` > Deployment branches and tags >
   **Selected branches and tags** > `main` only (no other rule), and no `pull_request` workflow uses it. Azure trusts
   any job in that environment, and since #330 that job can apply the template, so this setting is what keeps it to
   `main`.
10. **Visual QA's key (optional):** Settings > Secrets and variables > Actions > New repository secret, named
   `GEMINI_API_KEY`, with a key from Google AI Studio on a paid-tier project (the free tier lets Google use what it is
   sent to improve its products). Until it is set, Visual QA records the clips and skips the review. Setting a
   budget alert on that Google project backs up the caps in code.
