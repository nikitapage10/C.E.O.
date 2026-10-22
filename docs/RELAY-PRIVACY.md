# Relay privacy

The rules for what Relay may read, keep, send and show, written before its hub is built. Issue #149, roadmap R5 in
[THREAT-MODEL.md](THREAT-MODEL.md). Status as of 2026-10-15: this page and the check that holds the site to counts
only (`packages/core/src/relay.ts`) are shipped; nothing runs on the Mac yet.

These rules bind the hub. Hub code that breaks one doesn't merge. To change a rule, change this page in the same pull
request as the code, and say so in the pull request.

## What Relay is

Relay is C.E.O.'s first real agent. It runs on Nikita's always-on MacBook and covers iMessage and SMS only. It is not
an urgency filter. It keeps track of who Nikita owes a reply, sorts them so the ones to answer sooner come first, lets
him push a reply to later, nudges him gently once or twice a day, and drafts replies in his own voice. The voice is
learned on the Mac from his own past replies, and a dictated reply is lightly restyled. **Nothing is sent without
Nikita's tap.** Group chats are only summarised, never drafted for.

The parts: BlueBubbles (the bridge to Messages), a Node hub in `apps/hub` under `launchd` on `127.0.0.1:7420`,
Tailscale if Nikita wants Relay away from home, a local database, and two OpenAI models: **Dialtone** sorts and
summarises, **Blasto** drafts. The OpenAI key is in the Keychain.

**Email is a separate line** (#263): Gmail, read-only, sorted by Claude on the Azure copy, not on the Mac. Its own
rules (what is read, sealed, shown and logged) are in [GMAIL.md](GMAIL.md); like the hub, it gives the public site
counts and states only.

## The rules in brief

1. **Messages stay on the Mac.** Message text, contacts, handles, drafts, summaries, style examples and dictation
   leave it only for one OpenAI call at a time, trimmed to what that call needs, with names and numbers swapped for
   placeholders.
2. **The site sees counts and states only**, in one allowlisted shape (`RelayStatus`). Nothing else about Relay
   reaches Vercel, GitHub, the Lattice or the Desk's public pages.
3. **Logs hold no content**: kinds, counts, times and error codes only.
4. **Everything has an end date** (the retention table below), and **one command wipes it all**, with a way to check
   that it worked.
5. **Nothing sends without a tap**, whatever a message or a model says.

## Data inventory

| Item | What it holds | Where it lives | Kept for |
| --- | --- | --- | --- |
| Messages database | Every message and attachment in Messages | `~/Library/Messages/chat.db`, Apple's. Relay opens it read-only and never copies it | Apple's choice, not Relay's |
| BlueBubbles | Its own cache, settings and server password | `~/Library/Application Support/bluebubbles-server/` | Until BlueBubbles is removed (see the wipe) |
| Relay's database | Per thread: a random Relay id, the Messages chat id, when the last unanswered message came, the state (owed, later, settled), Dialtone's sort; Relay's own outputs (drafts, group summaries, the schedule); daily counts. **Never a copy of a message body** | `~/Library/Application Support/CEO Relay/relay.db` (SQLite, with its `-wal` and `-shm` files), mode 0600, in a folder kept out of Time Machine and Spotlight | Per row, below |
| Style profile | Per contact: a few numbers about how Nikita writes to them (length, capitals, emoji, punctuation, usual sign-offs). No text | Relay's database | Until the wipe; rebuilt weekly |
| Style examples | Nikita's own past replies to one contact, picked at draft time from `chat.db` | Memory only, for one Blasto call | The call |
| Drafts | Blasto's draft for one owed thread, and Nikita's edits to it | Relay's database | Until sent or dismissed, 7 days at most |
| Group summaries | Up to two sentences per group chat, and whether Nikita was asked something | Relay's database | 48 hours |
| The schedule | Reply-later times and the daily nudge times | Relay's database | Until it fires or is cleared, 14 days at most; nudge times until changed |
| Dictation | The audio of a spoken reply, then its transcript | Audio: a temp file in Relay's folder. Transcript: treated as a draft | Audio: deleted as soon as it is transcribed, 10 minutes at most. Transcript: as a draft |
| Daily counts | Replies sent and the median reply time per day, the streak | Relay's database | 7 days (the reply strip), the streak as one number |
| Logs | Event kinds, counts, durations, status codes, error classes | `~/Library/Logs/CEO Relay/`, mode 0600 | 14 days, rotated daily |
| Secrets | The OpenAI key and the hub's token | The login Keychain, only the hub's binary allowed to read them | Until the wipe or a rotation |
| The site's copy | The latest `RelayStatus`: counts, states, times | Vercel Blob (private store, served by a function) | The latest only; each status replaces the last |
| OpenAI's copy | What one call sent and got back | OpenAI | Up to 30 days for abuse monitoring by OpenAI's policy, unless zero data retention is granted; never used for training (below) |

## What may cross each boundary

### Mac to the OpenAI API

Only the hub calls OpenAI, through one call builder that applies every rule here; nothing else on the Mac has the key.

- **Dialtone, sorting** sees, for one owed one-to-one thread: the messages since Nikita's last reply (5 at most, 1,000
  characters in all), how long ago each came, and the contact's placeholder. It answers with a sort (`sooner` or
  `normal`) and whether the thread needs a reply at all.
- **Dialtone, group summaries** sees the group's messages since Nikita last replied or read it (30 at most, 3,000
  characters in all), each sender as "Member 1", "Member 2"…, and never the group's name. It answers with two
  sentences at most and whether Nikita was asked something. It never drafts for a group, and Blasto never sees a
  group.
- **Blasto, drafting** sees, for one one-to-one thread: the messages being answered and up to 5 earlier turns for
  context (2,000 characters in all), up to 8 of Nikita's own past replies to that same contact as style examples
  (1,500 characters in all), the style profile's numbers, and, when Nikita dictated, the transcript to restyle. Never
  another contact's messages.
- **Speech to text** sees the audio of a reply Nikita dictated, nothing else.
- **Names and numbers become placeholders.** Before anything is sent, the contact's name and handle become
  "Contact" (or "Member 1"…), every name from Nikita's contacts that appears in the text becomes "Person 1"…, and
  phone numbers, email addresses, street addresses, card and account numbers and one-time codes become `[phone]`,
  `[email]`, `[address]`, `[card]`, `[account]`, `[code]`, using the same patterns as the Desk's privacy check
  (`api/_privacy.ts`). The map from placeholder back to name lives in memory for that one call, and the hub puts
  names back only into the draft Nikita sees. A name the hub doesn't know (a first name a friend mentions) can still
  go through as written; that is the residual risk.
- **Never sent at all:** verification codes and other one-time-code messages, short-code and promo senders (settled
  on the Mac by rule, without a model), attachments and images, contacts Nikita marks private (they are still counted,
  never read by a model), and anything older than the windows above.
- **How the calls are made.** The Responses API with `store: false` on every call. None of the features that keep
  data on OpenAI's side are used with message data: no Assistants, Threads, Conversations, Files, vector stores,
  Batch, background mode, fine-tuning or evals. No `user` or `safety_identifier` that names Nikita or a contact, no
  `metadata`. A separate OpenAI project for Relay, with its own key and its own monthly budget. The organisation's data
  sharing with OpenAI stays off, so nothing is used for training (OpenAI doesn't train on API data unless an
  organisation opts in). Zero data retention if OpenAI grants it; until then OpenAI keeps call data up to 30 days for
  abuse monitoring, which is the residual risk on this boundary.
- **A message is data, never an instruction.** Inbound texts are untrusted: anyone can text Nikita. Message text goes
  into the prompt inside fenced data blocks it can't close, the way Rivet's input does (`shapeInput` in
  `api/foundry.ts`), the models have no tools, and their answers are checked in code against a closed schema (the
  sort is an enum, a draft and a summary have length caps). A model can't send anything, because only Nikita's tap
  sends.
- **No retrieval.** No embeddings, vector store or search index over messages, on the Mac or anywhere else (LLM08 in
  THREAT-MODEL.md). Adding one changes this page first.

### Mac to the site and the Desk

The Lattice and the Desk are public to read, so Relay gives them **counts, enum states and timestamps, and nothing
else**. The whole of what may cross is `RelayStatus` in `packages/core/src/relay.ts`:

| Key | Type | Meaning |
| --- | --- | --- |
| `v` | `1` | The shape's version |
| `at` | timestamp | When the hub made the status |
| `hub` | `off`, `starting`, `listening`, `paused`, `error`, `wiped` | The hub's state |
| `messages` | `up`, `down`, `unknown` | BlueBubbles and Messages |
| `models` | `up`, `down`, `unknown` | The OpenAI API |
| `owed`, `sooner`, `overdue`, `later` | count | Threads waiting on Nikita, and how many of those are sorted sooner, overdue or pushed to later |
| `settled` | count | Threads that need nothing (groups, codes, promos) |
| `draftsReady` | count | Owed threads with a draft ready |
| `sentToday`, `streakDays` | count | Replies sent today; days in a row with nobody left past their window |
| `week` | up to 7 of `{ day, sent, medianMinutes }` | The reply strip: midnight, replies sent, median minutes or null |
| `nextNudgeAt` | timestamp or null | When Dialtone nudges next |

`readRelayStatus` checks a status against that allowlist. Every object is closed, so an unknown key, wherever it is
and whatever it is called, refuses the whole status. The only strings it takes are the enum values above. A count is
a whole number from 0 to 9,999, so a phone number can't pass as one; a timestamp is milliseconds between 2026 and
2100, so a phone number read as a time (1970) fails too. Parts can't exceed the whole, and a wiped hub reports
zeros. A refused status is dropped whole, never repaired, and the reason it gives names the field and the fault,
never the value or an unknown key's name. The hub checks every status before it sends it; the site function that
receives it (built with the hub) reads the body with `parseRelayStatus` (4 KB cap) and checks it again before it
stores it.

Also on this boundary:

- **The site holds one status**, the latest, and serves it like the other feeds. The Desk's Relay page shows its
  counts; the Lattice's Relay room animates from them. The hub sends the site no `AgentEvent`s of its own, so no
  quip, task title or note can carry a message out. The world step never reads Relay (`api/_world/digest.ts`).
- **Desk pings** about Relay carry counts only, like the Foundry's ("3 replies owed").
- **Names, previews, threads and drafts never pass through Vercel.** The Desk's detailed Relay view (who is waiting,
  what they said, Blasto's draft, Send and Later) can only come from the hub itself, to Nikita's own devices, over
  `localhost` on the Mac or the tailnet (Access, below). A stranger opening the Desk sees the counts and nothing
  else.
- **Nothing about Relay goes to GitHub**: no issue, comment, commit, log, screenshot or test fixture with a real
  message, name or number. Test fixtures are made up.

### Mac to logs

- **Allowed:** timestamps, event kinds ("thread owed", "draft ready", "status sent"), counts, durations, model names,
  token counts and cost, HTTP status codes, error class names, and Relay's own random ids.
- **Never:** message text, names, phone numbers, email addresses, Messages chat ids and handle ids (they contain the
  phone number or email address, e.g. `iMessage;-;+1555…`), drafts, summaries, transcripts, prompts, model answers,
  request or response bodies, headers, Keychain values.
- Errors are logged by class and code, never with the values in hand. No core dumps (the `launchd` job sets the core
  limit to zero). No third-party telemetry or error reporting. `launchd` writes stdout and stderr into the same
  0600 folder, so a stray `console.log` follows the same retention, and the log test below keeps it from holding
  content.

## Retention

| What | Kept for | How it ends |
| --- | --- | --- |
| A thread's row | While owed or later; 7 days after Nikita replies | Hourly sweep |
| Drafts and Nikita's edits | Until sent or dismissed; 7 days at most | Deleted on send; hourly sweep |
| Group summaries | 48 hours | Hourly sweep |
| Reply-later entries | Until they fire; 14 days at most | Deleted when fired; hourly sweep |
| Dictation audio | Until transcribed; 10 minutes at most | Deleted at once; the sweep catches strays |
| Style examples | One call | Never written down |
| Style profile | Until the wipe | Rebuilt weekly from `chat.db` |
| Daily counts | 7 days | Daily roll-off |
| Logs | 14 days | Daily rotation |
| The site's status | The latest only | Replaced on each send; reset by the wipe |
| OpenAI's copy | Up to 30 days (none with zero data retention) | OpenAI's policy |

The sweep runs hourly and at start-up, and after it SQLite's `VACUUM` runs daily so deleted rows don't linger in free
pages.

## The off switch and the full wipe

**Off.** "Pause Relay" (on the Desk's Relay page, from the hub's own view, or `relay off` on the Mac) stops reading
`chat.db`, stops every model call and every nudge, ignores BlueBubbles' webhooks, and sends one last status with
`hub: "paused"`. Data stays until it ages out or is wiped. `relay on` resumes. Unloading the `launchd` job stops the
hub entirely; the site then shows the last status it had, with its time.

**Wipe.** `relay wipe` on the Mac (and only there: no remote wipe, so a stolen session can't use it) asks to confirm,
then:

1. Pauses as above.
2. Sends a final status with `hub: "wiped"` and every count at zero, which the site stores in place of the last one.
3. Unloads and deletes the `launchd` job.
4. Deletes Relay's folder, `~/Library/Application Support/CEO Relay/` (the database with its `-wal` and `-shm`
   files, the style profiles, drafts, summaries, the schedule and any audio), and `~/Library/Logs/CEO Relay/`.
5. Deletes Relay's two Keychain items (the OpenAI key and the hub's token).
6. Removes the Tailscale serve rule for the hub, if there is one.

It doesn't touch `chat.db`: those are Nikita's messages, in Messages, and Relay never owned them. It doesn't remove
BlueBubbles; `relay wipe --all` also quits BlueBubbles and deletes its folder. Two things only Nikita can do, and the
wipe ends by saying so: **revoke the Relay key on OpenAI** (the only way to be sure no copy of it still works), and
**turn off Full Disk Access** for the hub and BlueBubbles in System Settings.

**Checking it worked.** `relay wipe --verify` (also run at the end of every wipe) checks, and prints pass or fail for
each: Relay's two folders don't exist; `security find-generic-password -s "CEO Relay"` finds nothing; `launchctl`
lists no Relay job; nothing listens on port 7420; the site's status reads `wiped`. By hand: the Desk's Relay page
says Relay is wiped, and the key no longer appears under the Relay project on OpenAI. Time Machine never held Relay's
data, because its folder is excluded from backups when it is made.

## Access

- **Full Disk Access.** Granted to BlueBubbles (it needs it) and to the hub's own Node binary, a copy kept at a fixed
  path for the hub alone (`/usr/local/ceo-relay/bin/node`), never to Terminal, a shell, or the Node everything else
  uses, so no other script gains it. The hub opens `chat.db` read-only and reads only the tables and columns it
  needs (messages, chats and handles; never attachments).
- **The hub listens on `127.0.0.1:7420` only**, never `0.0.0.0`. Every request needs the hub's token, even from the
  Mac itself, so another app on the Mac can't ask it for anything. BlueBubbles also listens locally, with its proxy
  service set to none (no Cloudflare, ngrok or zrok tunnel) and no Firebase or Google sign-in, so nothing of it is
  reachable from outside.
- **Tailscale, if used.** `tailscale serve` (tailnet only, HTTPS) in front of the hub, never `tailscale funnel`. The
  tailnet's access rules let only Nikita's own devices reach the Mac, and only on the served port; the Mac isn't
  shared with anyone else's tailnet. Tailscale carries the detail view to Nikita's phone or PC without it touching
  Vercel.
- **Keychain.** The OpenAI key and the hub's token are generic passwords in the login Keychain under the service
  "CEO Relay", readable only by the hub's binary. Never in the `launchd` plist, an environment file, the repo or a
  log.
- **The Mac.** FileVault stays on (DELIVERY.md, "Environments"), the Mac locks itself, and it runs only signed,
  checked releases it pulls, never pushes (DELIVERY.md).

## What a breach of each store would expose

| Store | Exposes | Limits |
| --- | --- | --- |
| The Mac itself, unlocked | Everything in Messages, not only Relay | FileVault, the lock screen, pull-only updates; the biggest risk, and not Relay's to fix |
| Relay's database | Who Nikita owes and since when, drafts and group summaries from the last few days, the schedule, style numbers | No message bodies; short retention; 0600; no backups |
| Logs | When Relay was busy and how much it spent | No content by rule and by test |
| Keychain items | OpenAI spend on the Relay project (its budget caps it); with the hub's token, local access to the hub | Revocable; budget cap; the token works only on `localhost` or the tailnet |
| BlueBubbles | Everything in Messages, and sending as Nikita | Local only, no tunnel, its own password |
| The tailnet | The detail view, for whoever controls one of Nikita's devices | Tailscale access rules, Nikita's devices only |
| OpenAI's copy | The trimmed, placeholdered text of up to 30 days of calls | No names or numbers; not used for training; zero data retention if granted |
| The site's status | Counts: how many replies are owed, how fast Nikita answers | Public by design; nothing more to take |

## The tests and checks that enforce it

In the repo now, run by `npm test`:

- **`packages/core/src/relay.test.ts`** holds the site to counts only. It puts message text, names, phone numbers,
  email addresses, a street address, a key and Messages chat ids into every field of a status, and as extra keys at
  the top and inside each day, and none pass. Counts and timestamps refuse phone numbers, dates written as digits,
  negatives, fractions, `NaN`, strings and booleans. It walks the schema itself and fails if any string in it isn't an
  enum or any object in it is open, and it pins the list of keys, so adding a field means changing this page and the
  test. Refusals never repeat what they refused.
- **`apps/world/src/desk/security/model.test.ts`** keeps the Desk's copy of THREAT-MODEL.md word for word, including
  TB7 and R5.
- **`api/_world/prompt.test.ts`** proves the world step never carries Relay-style messages or contacts.

Required in the pull request that builds the hub, before Relay reads a single message:

- **The call builder:** every OpenAI request has `store: false`, no `user`, `safety_identifier` or `metadata`, the
  caps above, placeholders for every name and number in a fixture thread, no group content in a Blasto call, nothing
  from a private contact or a one-time code, and fenced message text.
- **Answers:** a hostile model answer (extra fields, a send, a link, too long) is refused.
- **Logs:** run the hub over a fixture day and scan every log line for the fixture's text, names, numbers and chat
  ids; none may appear.
- **Binding:** the hub listens on `127.0.0.1` only and refuses a request without its token.
- **The site:** the receiving function reads with `parseRelayStatus`, needs the hub's token, and stores nothing from a
  refused status.
- **Retention:** with a fake clock, each kind of row is gone by its deadline.
- **Wipe:** on a fixture install, `relay wipe` then `relay wipe --verify` passes, and leaves `chat.db` untouched.

## Setup for Nikita on OpenAI

To be done once, before the hub's first call, in a browser at https://platform.openai.com signed in as the account
that will pay for Relay. OpenAI moves these pages now and then; the names below are as of October 2026.

1. **A project for Relay.** Top left, the project picker > **Create project**, name it `CEO Relay`.
2. **A budget.** In that project: **Settings** (gear, top right) > **Project** > **Limits**: set a monthly budget
   (for example $10) and turn on the email alert.
3. **No data sharing.** **Settings** > **Organization** > **Data controls** > **Sharing**: make sure sharing inputs
   and outputs with OpenAI is **off** (it is off unless someone turned it on).
4. **Zero data retention (optional).** On the same **Data controls** page, if it offers **Data retention** or zero
   data retention, request it for the `CEO Relay` project. If it isn't offered, it is granted only by OpenAI's sales
   team to eligible accounts; the 30-day abuse-monitoring copy is then the residual risk, and the placeholders above
   are what limit it.
5. **The key.** In the `CEO Relay` project: **API keys** > **Create new secret key**, owned by the project, with
   **Restricted** permissions allowing only **Model capabilities** (Responses and audio transcription). Don't paste it
   anywhere but the Mac's Keychain, when the hub's setup asks for it.
