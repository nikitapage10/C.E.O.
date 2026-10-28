# Relay privacy

The rules for what Relay may read, keep, send and show. Issue #149, roadmap R5 in [THREAT-MODEL.md](THREAT-MODEL.md);
the texts line itself is #535. Status as of 2026-10-28: the hub (`apps/hub`), its installer, the site's Relay routes
(`api/_relay`) and the Desk's Texts panel are built to these rules; the hub runs once Nikita installs it on the Mac.

These rules bind the hub and the site's Relay routes. Code that breaks one doesn't merge. To change a rule, change
this page in the same pull request as the code, and say so in the pull request.

## What Relay is

Relay is C.E.O.'s first real agent. Its texts line runs on Nikita's always-on MacBook and covers iMessage and SMS
only. It is not an urgency filter. It keeps track of who Nikita owes a reply, sorts them so the ones to answer sooner
come first, lets him push a reply to later, nudges him gently once or twice a day, and drafts replies in his own
voice, learned from his own past replies to that contact. A dictated reply is lightly restyled. **Nothing is sent
without Nikita's tap on the Desk.** Group chats are only summarised, never drafted for.

The parts:

- **BlueBubbles Server** on the Mac, the bridge to Messages, with its local connection only.
- **The hub** (`apps/hub`), one Node file under `launchd`, with its own Node runtime. It reads and sends through
  BlueBubbles' local API and takes BlueBubbles' webhook on `127.0.0.1:7420`. Every other call it makes is outbound,
  to the site, over its paired token. No port is open for the site or the internet; there is no Tailscale.
- **The site** (Azure, `api/_relay`): it keeps the public counts, the sealed who's-waiting list and the Desk's send
  requests, and it makes the model calls with the site's own Claude key, from Key Vault.
- **Two Claude models**, called only by the site: **Dialtone** (Claude Haiku) sorts and summarises, **Blasto**
  (Claude Sonnet) drafts. They run under the texts line's own $10 a month, on a ledger apart from email's. The Mac
  holds no model key.

**Email is a separate line** (#263): Gmail, read-only, sorted by Claude on the Azure copy. Its own rules are in
[GMAIL.md](GMAIL.md). Like the texts line, it gives the public site counts and states only.

## The rules in brief

1. **Message text stays on the Mac** except inside one model call at a time: trimmed to what that call needs, names
   and numbers swapped for placeholders, passed through the site to Claude and never stored or logged on the way.
2. **The public site sees counts and states only**, in one allowlisted shape (`RelayStatus`).
3. **The signed-in Desk sees who is waiting**: their name, when, Dialtone's one-line gist and Blasto's draft. That
   list is sealed on the site, readable only with a passkey session, and gone after 7 days. It never holds a message
   body.
4. **Logs hold no content**: kinds, counts, times and error classes only.
5. **Everything has an end date** (the retention table below), and **one command wipes the Mac**, with a way to check
   that it worked; **Unpair** on the Desk clears the site.
6. **Nothing sends without a tap.** A send is a request Nikita makes on the Desk with a fresh passkey unlock. Each
   request works once, for one thread and one draft, for 10 minutes. No message, model answer or webhook can make one.

## Data inventory

| Item | What it holds | Where it lives | Kept for |
| --- | --- | --- | --- |
| Messages | Every message and attachment | Apple's `chat.db`. Relay never opens it; it asks BlueBubbles for a chat's latest messages when it needs them | Apple's choice, not Relay's |
| BlueBubbles | Its own cache, settings and server password | `~/Library/Application Support/bluebubbles-server/` | Until BlueBubbles is removed (see the wipe) |
| Relay's state file | Per thread: a random Relay id, the Messages chat id, when the last unanswered message came, the state (owed, later, settled, replied), Dialtone's sort and gist, Blasto's draft, a group's summary, the reply-later time; daily counts; the ids of send requests already seen. **Never a copy of a message body** | `~/Library/Application Support/CEO Relay/relay.json`, mode 0600, written whole through a temp file, in a folder that is mode 0700 and kept out of Time Machine and Spotlight | Per row, below |
| Style profile | Four numbers made at draft time from Nikita's own past replies to that contact (usual length, and how often he starts with a capital, uses emoji, ends with a full stop). No text | Memory, for one call | The call |
| Style examples | Up to 8 of Nikita's own past replies to that contact | Memory only, for one Blasto call | The call |
| Contacts | Names and handles, from BlueBubbles | The hub's memory, refreshed hourly | While the hub runs |
| Dictation | Nikita's spoken words, as text | The Desk's browser, then a sealed restyle request on the site, then one Blasto call | As a request (below) |
| Logs | Event kinds, counts, error classes | `~/Library/Logs/CEO Relay/`, mode 0600 | 14 days, one file a day |
| Mac secrets | The BlueBubbles password, the hub token, the send key, the local webhook key | The login Keychain, service "CEO Relay" | Until the wipe |
| The site's public status | The latest `RelayStatus`: counts, states, times | Azure blob `relay/status.json` (private container, served by a function) | The latest only |
| The site's sealed list | The who's-waiting list (names, gists, drafts, summaries) and the Desk's requests, including the text of each send and dictation | Azure blob `relay/private.json`, sealed with AES-256-GCM under a key derived from `GMAIL_TOKEN_KEY` with Relay's own label | List: replaced on each push, items 7 days at most. Requests: a day after they end |
| The pairing | The pairing's id and the SHA-256 of the hub's token; an open pair code's SHA-256 | Azure blobs `relay/hub.json`, `relay/pair.json` | Until Unpair; a code 10 minutes |
| The spend ledger | Per month: calls, tokens, dollars | Azure blob `relay/spend.json` | A year |
| Anthropic's copy | What one call sent and got back | Anthropic | Anthropic's API retention (below); never used for training |

## What may cross each boundary

### Mac to the model, through the site

The hub never calls a model. It builds one snippet at a time, sends it to `POST /api/relay-hub?view=sort|draft` over
its paired token, and gets back only the model's checked answer. The site function reads the snippet again against a
closed shape (`readSortInput`, `readDraftInput` in `api/_relay/models.ts`), trims it to the caps below, builds the one
Messages API request (`sortRequest`, `draftRequest`), calls Claude with the Key Vault key, checks the answer, adds the
cost to the ledger and answers. **The function stores nothing from the snippet and logs nothing about it.** Only the
cost (tokens and dollars) is kept.

- **Dialtone, sorting** (Claude Haiku) sees, for one owed one-to-one thread: the messages since Nikita's last reply
  (5 at most, 1,000 characters in all) and how long ago each came, the sender written as `them` or `me`. It answers
  whether the thread needs a reply, a sort (`sooner` or `normal`) and a one-line gist (160 characters at most).
- **Dialtone, group summaries** sees the group's messages since Nikita last replied (30 at most, 3,000 characters in
  all), each sender as "Member 1", "Member 2"…, and never the group's name. It answers with a summary (300 characters
  at most) and whether Nikita was asked something. It never drafts for a group, and Blasto never sees a group: the
  site refuses a draft snippet with a Member line in it.
- **Blasto, drafting** (Claude Sonnet) sees, for one one-to-one thread: the messages being answered and up to 5
  earlier turns (2,000 characters in all), up to 8 of Nikita's own past replies to that same contact as style
  examples (1,500 characters in all), the style profile's four numbers, and, when Nikita dictated, his words to
  restyle (1,000 characters at most). Never another contact's messages.
- **Names and numbers become placeholders**, on the Mac, before anything leaves it (`apps/hub/src/placeholders.ts`).
  The contact's name, each part of it, and their handle become "Contact" (or "Member 1"…). Every name from Nikita's
  contacts, and each part of it, that appears in the text becomes "Person 1"…. Phone numbers, email addresses,
  street addresses, card and account numbers and keys become `[phone]`, `[email]`, `[address]`, `[card]`,
  `[account]`, `[key]`, using the Desk privacy check's own patterns (`api/_privacy.ts`), and 4- to 8-digit codes
  become `[code]`. The map back lives in memory for that one call, and the hub puts names back only into the gist
  and draft Nikita sees. A name the hub doesn't know (a nickname, someone not in his contacts) can still go through as
  written; that is the residual risk.
- **Never sent at all:** settled on the Mac by rule, without a model (`apps/hub/src/rules.ts`): verification and
  one-time-code messages, short-code senders, promos, money and legal texts (the email line's own pre-filter), and
  contacts on the private skip list (the email line's `EMAIL_SKIP_TERMS`, fetched over the paired token and held in
  memory only), which are counted, never read by a model. The skip list is checked again over the whole unanswered
  run just before a call. Also never sent: attachments and images, and anything older than the windows above.
- **How the calls are made.** The Messages API with only `model`, `max_tokens`, `system`, `messages`, `thinking` and
  `output_config` (a closed JSON schema). No tools, no `metadata`, no prompt caching, no Files, no Batch. The texts
  line has its own monthly budget, **$10 by default and never more** (`RELAY_BUDGET_USD` can only lower it), on its
  own ledger (`relay/spend.json`), apart from email's. The function checks the month's spend plus the call's
  worst-case cost before each call and stops hard at the cap: the hub is told it is paused for models and reports
  `models: "down"`. Anthropic doesn't train on API data. It keeps API inputs and outputs for a limited time under its
  retention policy (30 days at the time of writing, longer only for traffic flagged for a usage-policy breach),
  unless zero data retention is arranged. That copy is the residual risk on this boundary, and the placeholders limit
  it.
- **A message is data, never an instruction.** Anyone can text Nikita. Message text goes into the prompt inside
  fenced blocks it can't close (`fence` in `api/_relay/models.ts`), the system prompt says it is untrusted, the
  models have no tools, and their answers are checked in code against a closed shape: an extra key, a wrong enum or
  an answer that is too long refuses it, and links and control characters are stripped. A model can't send anything,
  because only Nikita's tap makes a send request.
- **No retrieval.** No embeddings, vector store or search index over messages, on the Mac or anywhere else (LLM08 in
  THREAT-MODEL.md). Adding one changes this page first.

### Mac to the site

The hub makes only these calls, all outbound to `https://ceo.nikita.page`, all with its paired token:

| Call | What goes | Checked by |
| --- | --- | --- |
| `POST /api/relay-hub` | The counts (`RelayStatus`) | `parseRelayStatus`, 4 KB, the allowlist below; kept whole or not at all |
| `POST /api/relay-hub?view=texts` | The who's-waiting list (`TextsView`): per thread its Relay id, name, channel, group or not, state, sort, since, later-until, gist, draft, summary | `readTextsView` (`api/_relay/texts.ts`): a closed allowlist with length caps; one bad item refuses the list. 128 KB |
| `POST /api/relay-hub?view=sort` and `?view=draft` | One placeholdered snippet | Above |
| `GET /api/relay-hub?view=requests` | Nothing; it gets the Desk's waiting requests | The send path, below |
| `POST /api/relay-hub?view=results` | Per request it took: its id and `sent`, `done`, `failed` or `refused` | Taken requests only |
| `GET /api/relay-hub?view=skip` | Nothing; it gets the skip list's terms | |
| `POST /api/relay-pair` | Once, at install: the pair code | Below |

The list never holds a message body: the gist and summary are the models' own words about the thread, and the draft is
Blasto's. It never holds a phone number, email address or Messages chat id either. A name is the contact's name as
Nikita's contacts have it, "Unknown sender", or a group's name.

**The pairing.** The Desk makes a one-time code (8 characters from a 32-letter alphabet, 10 minutes, 5 wrong tries;
the site keeps only its hash). The installer trades it once at `POST /api/relay-pair`, which refuses anything with an
`Origin` header, so a web page can't pair. The answer is the hub token (`rh1.<pairing id>.<HMAC>`, signed with a key
derived from the Desk key) and the send key. Both go straight into the Mac's Keychain. The site keeps only the
pairing's id and the token's hash. A new pairing clears the sealed list. **Unpair** on the Desk forgets the pairing,
so the token stops working at once, and clears the list and the requests.

**The site gate** lets the hub's own calls through on its token alone (`isRelayHub` in `api/_site/gate.ts`): exactly
the methods and views above, with a token this Desk key signed. The route then checks the token's hash against the
pairing on record. `POST /api/relay-pair`, with no query, is the gate's other exemption; the pair code is its lock.

**The public status.** The Lattice and the Desk's public pages see `RelayStatus` in `packages/core/src/relay.ts`, and
nothing else:

| Key | Type | Meaning |
| --- | --- | --- |
| `v` | `1` | The shape's version |
| `at` | timestamp | When the hub made the status |
| `hub` | `off`, `starting`, `listening`, `paused`, `error`, `wiped` | The hub's state |
| `messages` | `up`, `down`, `unknown` | BlueBubbles and Messages |
| `models` | `up`, `down`, `unknown` | The model calls through the site |
| `owed`, `sooner`, `overdue`, `later` | count | Threads waiting on Nikita, and how many of those are sorted sooner, overdue or pushed to later |
| `settled` | count | Threads that need nothing (groups, codes, promos) |
| `draftsReady` | count | Owed threads with a draft ready |
| `sentToday`, `streakDays` | count | Replies sent today; days in a row with nobody left past their window |
| `week` | up to 7 of `{ day, sent, medianMinutes }` | The reply strip: midnight, replies sent, median minutes or null |
| `nextNudgeAt` | timestamp or null | When Dialtone nudges next |

`readRelayStatus` checks a status against that allowlist. Every object is closed, so an unknown key, wherever it is
and whatever it is called, refuses the whole status. The only strings it takes are the enum values above. A count is
a whole number from 0 to 9,999, so a phone number can't pass as one. A timestamp is milliseconds between 2026 and
2100, so a phone number read as a time (1970) fails too. Parts can't exceed the whole, and a wiped hub reports zeros.
A refused status is dropped whole, never repaired. The reason it gives names the field and the fault, never the value
or an unknown key's name. The hub checks every status before it sends it, and the site checks it again before it
stores it.

Also on this boundary:

- **The hub sends the site no `AgentEvent`s**, so no quip, task title or note can carry a message out. The world step
  never reads Relay (`api/_world/digest.ts`), and the Lattice reads only the counts.
- **Desk pings** about Relay carry counts only ("3 replies owed"), once per nudge time, never in quiet hours.
- **Nothing about Relay goes to GitHub**: no issue, comment, commit, log, screenshot or test fixture with a real
  message, name or number. Test fixtures are made up.

### The Desk's Texts panel and the send path

The Relay page's Texts panel (`apps/world/src/desk/texts`) reads `GET /api/relay` with a passkey session: the counts,
the pairing, the sealed list and the requests. It never talks to the Mac.

**The send path** (`api/_relay/route.ts`, then `act` in `apps/hub/src/engine.ts`):

1. **Unlock, once per device.** "Unlock sending" asks for a fresh passkey answer (user verification required) to a
   challenge made for the session's own passkey. The challenge lasts 2 minutes and is spent atomically, so it works
   once. The answer sets `__Host-ceo-relay-unlock`: HttpOnly, Secure, SameSite=Strict, signed with a key derived from
   the Desk key, naming that passkey, good for **72 hours**. Every send checks it server-side together with the
   session: the same passkey, unexpired. Another device has to unlock on its own, as does this one after 72 hours or
   after "Lock". The site never accepts an unlock longer than 72 hours, whatever the cookie says.
2. **Send: one tap, one request.** A request has a random id, the thread, the draft it was made from (its time), the
   text, and 10 minutes to live. It is signed with the pairing's send key over all of those. The site makes it only for
   a thread on the hub's latest list that is one-to-one and still owed, with that very draft, and only one send at a
   time per thread.
3. **The hub polls** every 15 seconds. Each waiting, unexpired request is handed out once and marked taken in the same
   conditional write, so a second poll never gets it. The hub checks the signature, the 10 minutes, that it has never
   seen the id (it records the id before acting), and the thread and draft again on its own list. Only then does it
   send through BlueBubbles, and it reports `sent` or `failed`. Anything else is `refused`. `act` is the only code in
   the hub that sends.
4. **Not taken in 10 minutes** (the Mac was offline): the request is `expired`, never sent late. The Desk says "Not
   sent, Mac was offline" with **Resend**, which makes a new request (steps 2 and 3 again, the unlock still needed). A
   request taken but never answered shows `failed` 5 minutes after its end, with Resend too.

"Later", "Done" and "Put it in my style" are requests the same way (single-use, 10 minutes, signed). They need the
session but not the send unlock, because none of them can send. "Say it" uses the browser's own speech recognition:
in Chrome and Edge, the audio goes to the browser maker's speech service (Google, Microsoft); in Safari, to Apple's,
or it stays on the device. The words land in the text box. Nothing goes anywhere else until Nikita taps Send or "Put
it in my style".

### Mac to logs

- **Allowed:** timestamps, event kinds from a closed list ("thread owed", "draft ready", "status sent", "sent",
  "request refused"), numeric fields, and error class names from a closed list (`apps/hub/src/log.ts`).
- **Never:** message text, names, phone numbers, email addresses, Messages chat ids (they contain the phone number or
  email address, e.g. `iMessage;-;+1555…`), Relay's thread ids, drafts, summaries, dictation, prompts, model answers,
  request or response bodies, headers, Keychain values, error messages.
- No core dumps (the `launchd` job sets the core limit to zero). No third-party telemetry or error reporting.
  `launchd` writes stdout and stderr into the same 0600 folder, so a stray `console.log` follows the same retention.
- **The site** logs nothing in the Relay routes. Azure's own request log has the path and status code of each call,
  never a body.

## Retention

| What | Kept for | How it ends |
| --- | --- | --- |
| A thread's row on the Mac | While owed or later; 7 days after the last message or reply | Hourly sweep |
| Drafts | Until sent or settled; 7 days at most | Cleared on send; hourly sweep |
| Group summaries | 48 hours | Hourly sweep |
| Reply-later times | Until they fire; 14 days at most | Hourly sweep |
| Seen request ids | 24 hours | Hourly sweep |
| Style examples and profile | One call | Never written down |
| Daily counts | 7 days | Hourly sweep |
| Logs on the Mac | 14 days | Daily |
| The site's public status | The latest only | Replaced on each push; reset by Unpair and the wipe |
| The site's sealed list | Replaced on each push (on every change, and at least every 5 minutes); items 7 days at most | The next push, `readTextsView`, Unpair, the wipe |
| Requests on the site | A day after their 10 minutes end | Dropped on each read and write |
| Snippets on the site | One call | Never written down |
| Anthropic's copy | Anthropic's API retention (above) | Anthropic's policy |

## The off switch and the full wipe

**Off.** `relay off` on the Mac pauses the hub: it ignores BlueBubbles' webhooks, makes no model call, refuses every
request, stops the nudges, and reports `hub: "paused"`. Data stays until it ages out or is wiped. `relay on` resumes.

**Wipe.** `relay wipe` on the Mac (and only there, so a stolen session can't use it) asks to confirm, then:

1. Pauses as above.
2. Sends a final status with `hub: "wiped"` and every count at zero, and an empty list, so the site keeps nothing of
   the old one.
3. Unloads and deletes the `launchd` job.
4. Removes BlueBubbles' webhook to the hub, then deletes Relay's four Keychain items (the BlueBubbles password, the
   hub token, the send key, the local key).
5. Deletes `~/Library/Application Support/CEO Relay/` (the state file, the hub, its Node runtime),
   `~/Library/Logs/CEO Relay/`, the `relay` command and its PATH line in `~/.zprofile`.

It doesn't touch Messages: those are Nikita's messages, and Relay never owned them. It doesn't remove BlueBubbles;
`relay wipe --all` also quits BlueBubbles and deletes its folder. The wipe ends by naming what only Nikita can do:
**Unpair on the Desk** (it forgets the hub's token and the sealed list on the site), and, after `--all`, turn
BlueBubbles off in System Settings › Privacy & Security.

**Checking it worked.** `relay wipe --verify` (also run at the end of every wipe) checks each of these and prints pass
or fail: Relay's two folders don't exist; `security find-generic-password -s "CEO Relay"` finds nothing; `launchctl`
lists no Relay job and the plist is gone; nothing listens on port 7420; the `relay` command is gone; the site's status
reads `wiped`. Time Machine never held Relay's folder, because it is excluded from backups when it is made.

## Access

- **No Full Disk Access for Relay.** The hub reads Messages only through BlueBubbles' local API, so it never opens
  `chat.db` and needs no special permission. BlueBubbles needs Full Disk Access (and Accessibility to send) for itself.
- **The hub listens on `127.0.0.1:7420` only**, never `0.0.0.0`, and only for BlueBubbles' webhook and the `relay`
  command's own control calls. Each needs the local key (a random value in the Keychain; the webhook's URL carries
  it, so BlueBubbles' own settings hold a copy). The listener refuses any request with an `Origin` header, so a web
  page in a browser on the Mac can't reach it, and it sends no CORS headers. BlueBubbles also listens locally, with
  its proxy service set to none (no Cloudflare, ngrok or zrok tunnel) and no Firebase or Google sign-in.
- **No inbound path from the internet or a browser to the Mac.** No Tailscale, no tunnel, no port forward. The Desk
  reaches the Mac only through requests the hub polls for.
- **Keychain.** The four secrets are generic passwords in the login Keychain under the service "CEO Relay". They are
  written through `security -i` on stdin, never on a command line. The Keychain doesn't fence them to the hub: any
  program running as Nikita can ask `security` for them. Never in the `launchd` plist, an environment file, the repo
  or a log.
- **The installer** downloads Node from nodejs.org and checks it against nodejs.org's published SHA-256 list. It
  downloads the hub from the site and checks it against the site's published SHA-256. It asks only for the
  BlueBubbles password and the pair code, read from the Terminal, never echoed.
- **The Mac.** FileVault stays on (DELIVERY.md, "Environments"), and the Mac locks itself.

## What a breach of each store would expose

| Store | Exposes | Limits |
| --- | --- | --- |
| The Mac itself, unlocked | Everything in Messages, not only Relay | FileVault and the lock screen; the biggest risk, and not Relay's to fix |
| Relay's state file | Who Nikita owes and since when (by chat id), gists, drafts and group summaries from the last few days | No message bodies; short retention; 0600; no backups |
| Logs | When Relay was busy | No content by rule and by test |
| The Keychain items | With the hub token and send key: the right to push a list, poll requests and spend on the model calls up to the cap (not to make send requests); with the local key: the local webhook; with the BlueBubbles password: BlueBubbles itself | Unpair kills the token; the $10 cap; send requests are made only on the Desk |
| BlueBubbles | Everything in Messages, and sending as Nikita | Local only, no tunnel, its own password |
| The site's sealed list | Names, gists, drafts and the requests' text from the last week, for whoever holds both the Azure store and `GMAIL_TOKEN_KEY` | Sealed; 7 days; no message bodies; no numbers |
| A Desk session | The list, and with this device's unlock, send requests for drafts already on it, for 72 hours | Passkey sign-in; the unlock is per device and per passkey; one thread, one draft, 10 minutes; Lock and Unpair |
| Anthropic's copy | The trimmed, placeholdered text of recent calls | No known names or numbers; not used for training |
| The site's public status | Counts: how many replies are owed, how fast Nikita answers | Public by design; nothing more to take |

## The tests and checks that enforce it

Run by `npm test`:

- **`packages/core/src/relay.test.ts`** holds the public status to counts only: message text, names, numbers, keys
  and chat ids in every field and as extra keys never pass. It walks the schema and pins its keys.
- **`api/_relay/relay.test.ts`** covers:
  - the pairing: one use, 5 tries, 10 minutes, no `Origin`, Unpair;
  - the hub token, and the gate opening exactly the hub's calls;
  - a refused status stores nothing, and a list with anything extra or older than 7 days is refused;
  - the sealed store holds no name or draft in the clear, and another key can't open it;
  - the send unlock: needed, fresh, single-use, 2 minutes, HttpOnly and Strict, 72 hours and not a minute more,
    bound to its passkey and the Desk key, ended by Lock;
  - requests: single-use, signed over every field, 10 minutes then expired, Resend only for expired or failed and
    only with the unlock, bound to the thread and the draft, never a group, results only for taken requests;
  - model calls: no tools, metadata or caching, hostile answers refused, off-shape snippets refused before any call,
    the caps, and the hard stop at $10 on its own ledger.
- **`apps/hub/src/hub.test.ts`** covers:
  - placeholders swap whole names, name parts, numbers and addresses;
  - the rules settle codes, short codes, promos and the skip list;
  - snippets to the site hold no names or numbers;
  - the skip list stops a call, and a hostile answer is refused;
  - nothing sends without a request, and a good request sends once;
  - a replayed, expired, tampered, foreign-key, changed-draft or unknown-thread request is refused, and nothing sends
    while paused;
  - the list holds no body, number or chat id;
  - a whole day's log lines hold only kinds and numbers;
  - the sweep ends each row by its deadline;
  - the server binds `127.0.0.1` and refuses a missing key, a wrong key or an `Origin`.
- **`apps/hub/src/install.test.ts`** runs `relay wipe` and `relay wipe --verify` on a made-up home folder with
  macOS's commands stubbed: every file, the job, the four Keychain items and the PATH line go, and the check passes.
  It does nothing without "wipe" typed, and the check names what is left.
- **`apps/hub/build.mjs`** fails the build if the hub's bundle contains the Anthropic SDK or an API-key header.
- **`apps/world/src/desk/security/model.test.ts`** keeps the Desk's copy of THREAT-MODEL.md word for word, and
  **`api/_world/prompt.test.ts`** proves the world step never carries Relay-style messages or contacts.
