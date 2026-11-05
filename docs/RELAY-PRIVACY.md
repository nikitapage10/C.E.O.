# Relay privacy

The rules for what Relay may read, keep, send and show. Issue #149, roadmap R5 in [THREAT-MODEL.md](THREAT-MODEL.md);
the texts line itself is #535. Status as of 2026-10-28: the hub (`apps/hub`), its installer, the site's Relay routes
(`api/_relay`), the Desk's Texts panel and the texts Skippy drafts for Nikita (#536) are built to these rules; the hub
runs once Nikita installs it on the Mac. Since #758 (Nikita, 2026-11-05) the hub also reads a 30-day backlog at
start, can learn Nikita's texting style from a year of their own sent texts, and puts the real text of what is owed on
the sealed Desk list; what that changes is in "The backlog, the full text and the learned voice (#758)" below.

These rules bind the hub and the site's Relay routes. Code that breaks one doesn't merge. To change a rule, change
this page in the same pull request as the code, and say so in the pull request.

## What Relay is

Relay is C.E.O.'s first real agent. Its texts line runs on Nikita's always-on MacBook and covers iMessage and SMS
only. It is not an urgency filter. It keeps track of who Nikita owes a reply, sorts them so the ones to answer sooner
come first, lets them push a reply to later, nudges them gently once or twice a day, and drafts replies in their own
voice, learned from their own past replies to that contact. A dictated reply is lightly restyled. **Nothing is sent
without Nikita's tap on the Desk.** Group chats are only summarised, never drafted for; since #805 Nikita can answer
one with his own typed words, sent exactly as typed.

The parts:

- **BlueBubbles Server** on the Mac, the bridge to Messages, with its local connection only.
- **The hub** (`apps/hub`), one Node file under `launchd`, with its own Node runtime. It reads and sends through
  BlueBubbles' local API, polling it every 5 seconds for new messages (#749: BlueBubbles 1.9.12 refuses API webhooks
  to `127.0.0.1`), and listens on `127.0.0.1:7420` for the `relay` command only. Every other call it makes is outbound,
  to the site, over its paired token. No port is open for the site or the internet; there is no Tailscale.
- **The site** (Azure, `api/_relay`): it keeps the public counts, the sealed who's-waiting list and the Desk's send
  requests, and it makes the model calls with the site's own Claude key, from Key Vault.
- **Two Claude models**, called only by the site: **Dialtone** (Claude Haiku) sorts and summarises, **Blasto**
  (Claude Sonnet) drafts. They run under the texts line's own $10 a month, on a ledger apart from email's. The Mac
  holds no model key.

**Email is a separate line** (#263): Gmail, read and (on Nikita's yes) reply, sorted by Claude on the Azure copy. Its own rules are in
[GMAIL.md](GMAIL.md). Like the texts line, it gives the public site counts and states only.

## The rules in brief

1. **Message text stays on the Mac** except inside one model call at a time (trimmed to what that call needs, names
   and numbers swapped for placeholders, passed through the site to Claude and never stored or logged on the way), and,
   since #758 at Nikita's request (2026-11-05), the last 5 texts of an owed thread (1,000 characters in all; since
   #870 its recent turns from both sides), sealed on the site for their own Desk only, a week at most. Never from a thread any rule matches.
2. **The public site sees counts and states only**, in one allowlisted shape (`RelayStatus`).
3. **The signed-in Desk sees who is waiting**: their name, when, Dialtone's one-line gist, Blasto's draft and (#758)
   what they said. That list is sealed on the site, readable only with a passkey session. Since #642 it may show a
   small contact photo, sent under an opaque id with nothing that says whose (below).
4. **Logs hold no content**: kinds, counts, times and error classes only.
5. **Everything has an end date** (the retention table below), and **one command wipes the Mac**, with a way to check
   that it worked; **Unpair** on the Desk clears the site.
6. **Nothing sends without a tap.** A send is a request Nikita makes on the Desk with a fresh passkey unlock. Each
   request works once, for one thread and one draft, for 10 minutes. No message, model answer or webhook can make one.
   A new text Skippy has drafted (#536) goes the same way, after a card shows Nikita who it goes to and the exact text;
   on a Talk call their own spoken "send" for the text Skippy just read them counts as the tap (below).

## Data inventory

| Item | What it holds | Where it lives | Kept for |
| --- | --- | --- | --- |
| Messages | Every message and attachment | Apple's `chat.db`. Relay never opens it; it asks BlueBubbles for a chat's latest messages when it needs them | Apple's choice, not Relay's |
| BlueBubbles | Its own cache, settings and server password | `~/Library/Application Support/bluebubbles-server/` | Until BlueBubbles is removed (see the wipe) |
| Relay's state file | Per thread: a random Relay id, the Messages chat id, when the last unanswered message came, the state (owed, later, settled, replied), Dialtone's sort and gist, Blasto's draft, a group's summary, the reply-later time, and (#914) when Nikita marked it Done, so a rescan never re-lists it for a text from before then; daily counts; the ids of send requests already seen; the new-message poll's cursor (the newest message time read, and 16 hex of the SHA-256 of each message guid read in the last 2 minutes, never the guid). Per new-text card (#536): its id, the contact's name, handle and chat id (or the choices'), Blasto's text. Since #758: per thread whether its last text is unread; the backlog's older unanswered chats (a random id, the chat id, the time, unread or not; 200 at most) and when it last ran; the learned voice (style traits, tones by relationship, the numbers, when, the cost) and, per learned contact, 16 hex of a SHA-256 of their handle with its relationship (family, friends, work, other). **Never a copy of a message body** |
| Shown texts (#758) | An owed thread's last 5 texts (1,000 characters in all; since #870 its recent turns from both sides), a group's since Nikita's last reply, with each sender's name | The hub's memory only, never the state file | Until the thread closes or the hub restarts |
| Tapback line ids (#888) | Each of their shown lines' message guid in Messages, under an opaque 8-hex ref; the site gets only the ref | The hub's memory only, never the state file, the site or a log | With the shown texts: until the thread closes or the hub restarts |
| The learn pass (#758) | A year of Nikita's messages, read once from BlueBubbles to make the numbers and the sample | Memory, for one run | The run | `~/Library/Application Support/CEO Relay/relay.json`, mode 0600, written whole through a temp file, in a folder that is mode 0700 and kept out of Time Machine and Spotlight | Per row, below |
| Style profile | Four numbers made at draft time from Nikita's own past replies to that contact (usual length, and how often they start with a capital, use emoji, end with a full stop). No text. Since #758 each draft also carries the learned voice: the traits, the tone for that contact's relationship, and the numbers | Memory, for one call | The call |
| Style examples | Up to 8 of Nikita's own past replies to that contact | Memory only, for one Blasto call | The call |
| Contacts | Names and handles, from BlueBubbles | The hub's memory, refreshed hourly | While the hub runs |
| Dictation | Nikita's spoken words, as text | The Desk's browser, then a sealed restyle request on the site, then one Blasto call | As a request (below) |
| Logs | Event kinds, counts, error classes | `~/Library/Logs/CEO Relay/`, mode 0600 | 14 days, one file a day |
| Mac secrets | The BlueBubbles password, the hub token, the send key, the local key (the `relay` command's key to the hub) | The login Keychain, service "CEO Relay" | Until the wipe |
| The site's public status | The latest `RelayStatus`: counts, states, times | Azure blob `relay/status.json` (private container, served by a function) | The latest only |
| The site's sealed list | The who's-waiting list (names, gists, drafts, summaries; since #758 the shown texts, unread marks, the older unanswered names and the learned voice: traits, tones and numbers, never a quote), the new-text cards (#536: name, the last 4 digits of the number or a masked address, the text, the choices) and the Desk's requests, including the text of each send and dictation and the who and gist of each new-text ask, and for each one the Mac refused or failed a reason code from a closed list (#767, `REASONS` in `api/_relay/texts.ts`) | Azure blob `relay/private.json`, sealed with AES-256-GCM under a key derived from `GMAIL_TOKEN_KEY` with Relay's own label | List: replaced on each push; owed items 30 days from their latest text (#895), settled ones 7, each shown text 30 days at most (#803; was 7). Requests: a day after they end |
| The pairing | The pairing's id and the SHA-256 of the hub's token; an open pair code's SHA-256 | Azure blobs `relay/hub.json`, `relay/pair.json` | Until Unpair; a code 10 minutes |
| The spend ledger | Per month: calls, tokens, dollars | Azure blob `relay/spend.json` | A year |
| Anthropic's copy | What one call sent and got back | Anthropic | Anthropic's API retention (below); never used for training |

## What may cross each boundary

### Mac to the model, through the site

The hub never calls a model. It builds one snippet at a time, **trimmed on the Mac to the caps below** (and read and
trimmed again on the site), sends it to `POST /api/relay-hub?view=sort|draft` over
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
  examples (1,500 characters in all), the style profile's four numbers, and, when Nikita dictated, their words to
  restyle (1,000 characters at most). Never another contact's messages.
- **Blasto, learning the voice** (#758, Claude Sonnet, once per tap of "Learn from my texts") sees about 1,000 of
  Nikita's own sent texts from the last 12 months: one-to-one chats only, contacts in Mac Contacts only, the 60
  most-texted at most, 30 texts per contact at most (spread over the year), 200 characters each and 60,000 in all,
  each contact under a label (`C1`, `C2`…). Never anyone else's texts, a group, a stranger, a skip-listed contact or a
  text any rule matches. It answers with up to 12 short style traits, one tone line each for family, friends and work,
  and a relationship per label. **No quotes**: the site refuses a trait with digits, an `@`, quote marks, angle
  brackets or a link, and the system prompt forbids quoting. The answer's labels map back to contacts only on the Mac.
- **Names and numbers become placeholders**, on the Mac, before anything leaves it (`apps/hub/src/placeholders.ts`).
  The contact's name, each part of it, and their handle become "Contact" (or "Member 1"…). Every name from Nikita's
  contacts, and each part of it, that appears in the text becomes "Person 1"…. Phone numbers, email addresses,
  street addresses, card and account numbers and keys become `[phone]`, `[email]`, `[address]`, `[card]`,
  `[account]`, `[key]`, using the Desk privacy check's own patterns (`api/_privacy.ts`), and 4- to 8-digit codes
  become `[code]`. The map back lives in memory for that one call, and the hub puts names back only into the gist
  and draft Nikita sees. A name the hub doesn't know (a nickname, someone not in their contacts) can still go through as
  written; that is the residual risk.
- **Never sent at all:** settled on the Mac by rule, without a model (`apps/hub/src/rules.ts`): verification and
  one-time-code messages, short-code senders, promos, money and legal texts (the email line's own pre-filter), and
  contacts on the private skip list (the email line's `EMAIL_SKIP_TERMS`, fetched over the paired token and held in
  memory only), which are counted, never read by a model. Every rule applies to one-to-one threads and group chats
  alike. A rule-matching message settles a thread even when it was already owed (its draft goes). Just before any
  call, every rule runs again over every message the call would carry, both sides, each with its own sender (in a
  group, each member's name and handle), including the earlier turns a draft sees from before Nikita's last reply.
  One match and there is no call (the thread settles, a group loses its summary). A past reply of Nikita's that
  matches a rule is left out of the style examples. Also never sent:
  attachments and images, and anything older than the windows above.
- **How the calls are made.** The Messages API with only `model`, `max_tokens`, `system`, `messages`, `thinking` and
  `output_config` (a closed JSON schema). No tools, no `metadata`, no prompt caching, no Files, no Batch. The texts
  line has its own monthly budget, **$10 by default and never more** (`RELAY_BUDGET_USD` can only lower it), on its
  own ledger (`relay/spend.json`), apart from email's. Before each call the function **reserves** the call's
  worst-case cost on the ledger in a conditional write over the version it read, and only if this month's spend plus
  that reservation stays within the cap. Two calls racing at the edge can't both get in: the losing write reads again
  and finds no room. After the call the reservation is settled to the real cost, or released if Anthropic refused the call with an error status. A timeout or a dropped
  connection may still have been billed, so its reservation stays at the worst case. If
  that write never lands, the larger reservation stays (fail closed). An unreadable ledger stops the calls. The learn call (#758) reserves its own
  larger worst case (25,000 tokens in, 1,500 out, about $0.065) and usually costs about $0.04 to $0.05. Past the
  cap the hub is told it is paused for models and reports `models: "down"`. Anthropic doesn't train on API data. It keeps API inputs and outputs for a limited time under its
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
| `POST /api/relay-hub?view=texts` | The who's-waiting list (`TextsView`): per thread its Relay id, name, channel, group or not, state, sort, since, (since #895, an owed one) when their latest text came, later-until, gist, draft, summary, and since #758 unread, photo id and the shown texts (each its text, time, and in a group the sender's name and photo id), and since #861 why an owed thread has no gist yet (a code from the closed list `GIST_WAITS`: queued, cap, model, site, messages, refused; never an error's words); the older unanswered (a count, and up to 40 Relay ids, names, times, unread, photo ids); when the backlog last ran; the learned voice (traits, tones, numbers, never a quote); and the new-text cards (#536): id, state, name, mask, channel, text, choices | `readTextsView` (`api/_relay/texts.ts`): a closed allowlist with length caps; one bad item refuses the list (a shown text that is only invisible characters is left out instead, #803). A card's mask must be `ending 0123` or `r•••@e•••.com` exactly, so no whole number or address can ride on it. Shown texts: 5 at most, 1,000 characters in all, a sender only in a group, each dropped 30 days after it came (#803). 100 items, 1 MB |
| `POST /api/relay-hub?view=sort` and `?view=draft` | One placeholdered snippet, or a new text's placeholdered ask (#536) | Above |
| `POST /api/relay-hub?view=learn` (#758) | The labelled, placeholdered sample of Nikita's own sent texts | `readLearnInput` (`api/_relay/voice.ts`): closed shape, the caps above, 1 MB; the rules run again on the site and drop any text they match |
| `GET /api/relay-hub?view=requests` | Nothing; it gets the Desk's waiting requests | The send path, below |
| `POST /api/relay-hub?view=results` | Per request it took: its id and `sent`, `done`, `failed` or `refused`, and for a refusal or failure a reason code from a closed list (#767), never words | Taken requests only |
| `GET /api/relay-hub?view=skip` | Nothing; it gets the skip list's terms | |
| `POST /api/relay-hub?view=unpair` | Nothing; the wipe (`relay wipe`): the site forgets this pairing, the list and the requests | |
| `POST /api/relay-pair` | Once, at install: the pair code | Below |

The gist and summary are the models' own words about the thread, and the draft is Blasto's. Until #758 the list never
held a message body; now it holds an owed thread's shown texts (below), and nothing else of a message. It never holds a phone number, email address or Messages chat id either; a new-text card shows only the last
4 digits of the number or the address masked to its first letters (#536), which is a change from #535's rule of no
number at all, made so Nikita can check who a text goes to before they send it. A name is the contact's name as
Nikita's contacts have it, "Unknown sender" (since #803 an owed one-to-one chat with someone not in the contacts reads "Unknown (ending 0123)" or "Unknown (r•••@e•••.com)", the same mask a new-text card shows; since #861 an older unanswered one does too), or a group's name.

**The pairing.** The Desk makes a one-time code only with this device's send unlock (below), since a paired Mac can
push the list and poll for sends, and never while a Mac is paired (Unpair first). The code is 8 characters from a 32-letter alphabet, good 10 minutes and 5 wrong tries;
the site keeps only its hash. The installer trades it once at `POST /api/relay-pair`, which refuses anything with an
`Origin` header, so a web page can't pair. The answer is the hub token (`rh1.<pairing id>.<HMAC>`, signed with a key
derived from the Desk key) and the send key. Both go straight into the Mac's Keychain. The site keeps only the
pairing's id and the token's hash. A new pairing clears the sealed list. **Unpair** on the Desk forgets the pairing,
so the token stops working at once, and clears the list and the requests.

**The site gate** lets the hub's own calls through on its token alone (`isRelayHub` in `api/_site/gate.ts`): exactly
the methods and views above, with a token this Desk key signed. The route then checks the token's hash against the
pairing on record. `POST /api/relay-pair`, with no query, is another exemption; the pair code is its lock. And
`GET /api/relay?view=status`, exactly, is open behind the site lock: it is the public counts (below), which `relay
status` and `relay wipe --verify` on the Mac read.

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
| `unread`, `older` | count, optional (#758) | Owed threads whose last text is unread (never more than `owed`); one-to-one chats unanswered for over 30 days |
| `contacts` | count, optional (#861) | How many contacts BlueBubbles lets the hub read: 0 means macOS keeps Contacts from BlueBubbles, so every sender reads "Unknown", and the Desk shows how to allow it. Left out until the hub has asked. Never a name |
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

### Contact photos: the one exception (#642)

Besides a contact's name, the only thing of Nikita's contacts that leaves the Mac is **a small picture**, so the Desk
can show a face beside a text or a mail. Nothing says whose it is:

- **On the Mac.** Every hour and at start (#907) the hub reads each contact's picture from BlueBubbles' contact data, shrinks
  it with macOS's `sips` to 96 px (in a private temp folder, deleted straight after) and keeps only the image chunks of
  the PNG (`cleanPng`: no EXIF, location, text or colour profile). It is named by an **opaque id**: an HMAC of the
  contact's normalised handle under a key derived from the hub's own local key (Keychain), which never leaves the Mac.
  The site can't turn an id back into a number. A photo already sent and unchanged isn't sent again.
- **Reading them (#870).** Every picture comes in one BlueBubbles answer, tens of megabytes with a thousand contacts,
  so that one call gets 3 minutes (the 15 seconds every other call gets cut it off, and no photo ever synced). The
  picture is read from whichever shape and field BlueBubbles used (base64, a data: URL, a Buffer as JSON, bytes;
  `avatar`, the full image or the thumbnail), and only bytes that start like a picture go on to `sips`.
- **What goes.** `POST /api/relay-hub?view=photo` with `{ id, png }` and nothing else; the site cleans the PNG again
  and refuses anything over 40 KB or larger than 144 px. `POST /api/relay-hub?view=photos` with the ids the Mac has now
  (the rest are deleted) and an email map. **Names, numbers and addresses never travel with photos.**
- **The email match.** So a mail from someone in Mac Contacts shows their photo, the hub sends `[hash, id]` pairs where
  the hash is an HMAC of the email address under a key the site derives from `GMAIL_TOKEN_KEY` (Key Vault) and hands
  only to the paired hub (`GET /api/relay-hub?view=photo-key`). The email tick hashes each sender the same way, so the
  site matches without the hub ever sending an address. Phone numbers never get a site-side key, because a short number
  space could be guessed through one.
- **On the site.** Each photo sealed in the private store, one blob per id, plus the sealed index; read only by the
  passkey Desk (`GET /api/relay?photo=`, `nosniff`, a sandboxing CSP). The public status and the Lattice never see one.
  Unpair, a new pairing and the wipe delete them all.

### What Nikita says on the Desk (#642)

What Nikita says or types about an item goes first to the free phrases in code ("already did it", "skip", "draft
it"), then, only if those don't settle it, to one Haiku call through `POST /api/email` (`intent`) under the email cap,
with the item as the Desk already has it (name, gist, advice; never a message body) and the words fenced as data. The
privacy check refuses words with a number, address, card or key before any call. A text's closing reply is handled on
the Mac: when Nikita's own message is the newest in Messages the thread closes (`replied`), and after his closing reply
("no worries", "sounds good") an acknowledgement settles the thread with no model call; Blasto never drafts after it.

### The Desk's Texts panel and the send path

The Relay page's Texts panel (`rooms/relay/web`, `rooms/relay/data`) reads `GET /api/relay` with a passkey session: the counts,
the pairing, the sealed list and the requests. It never talks to the Mac.

**The send path** (`api/_relay/route.ts`, then `act` in `apps/hub/src/engine.ts`):

1. **Unlock, once per device.** "Unlock sending" asks for a fresh passkey answer (user verification required) to a
   challenge made for the session's own passkey. The challenge lasts 2 minutes and is spent atomically, so it works
   once. The answer sets `__Host-ceo-relay-unlock`: HttpOnly, Secure, SameSite=Strict, signed with a key derived from
   the Desk key, naming that passkey, good for **72 hours**. Every send checks it server-side together with the
   session: the same passkey, unexpired. Another device has to unlock on its own, as does this one after 72 hours or
   after "Lock". The site never accepts an unlock longer than 72 hours, whatever the cookie says. **Since #870**
   (Nikita, 2026-11-05, "Sign-in unlocks") the Desk's passkey sign-in sets the same cookie for the same 72 hours on
   that device and for that passkey (`api/desk-auth.ts`, `api/_relay/unlock.ts`): a sign-in is the same kind of fresh,
   user-verified passkey answer, spent once, so a signed-in device isn't asked a second time. Enrolling a device
   doesn't set it, Sign out and Lock clear it, and nothing else changes: each send is still one tap, one single-use
   request with 10 minutes to live, and nothing ever sends on its own.
2. **Send: one tap, one request.** A request has a random id, the thread, the draft it was made from (its time), the
   text, and 10 minutes to live. It is signed with the pairing's send key over all of those. The site makes it only for
   a thread on the hub's latest list that is one-to-one and still owed, with that very draft. Since #870 (multi-send,
   Nikita 2026-11-05, his own tap on the decision card) a thread may take more than one send, each its own single-use
   request on its own tap; a settled thread takes none unless "Bring back" reopened it. A send leaves the thread in
   the queue (its draft goes), and only Done or a rule settles it; Nikita's own reply read back from Messages doesn't
   close it. A group on the list (#805: owed, or settled with its summary) takes a send too, only with no
   draft behind it (`draftAt` 0): it is never drafted for, so the text is always Nikita's own typed words, and a group
   is never restyled.
3. **The hub polls** every 15 seconds. Each waiting, unexpired request is handed out once and marked taken in the same
   conditional write, so a second poll never gets it. The hub checks the signature, the 10 minutes, that it has never
   seen the id (it records the id before acting), and the thread again on its own list: still owed, one-to-one (or a
   group still listed with its summary, with no draft; a rule match clears the summary, so a ruled group never takes a
   send, #805). The
   request carries the text Nikita tapped Send on, signed; if Blasto's draft changed since (a restyle, or a draft that
   landed while he typed his own), that text still goes, unless a message from them came in after the draft he saw
   (or, with no draft, after the tap), which refuses it (#767); a group's newer texts don't, since typed words answer
   the room, not one text (#805). Only then does it
   asks BlueBubbles for the thread's latest messages: since #870 "never send twice" is per request, not per thread.
   A request id acts once (above), and a request whose very text Messages already shows from Nikita after their last
   message (a send that timed out but went, then Resent) is refused as already answered; another text to the same
   thread goes. Only then does it
   send through BlueBubbles, and it reports `sent` or `failed`. Anything else is `refused`. Every refusal and failure
   carries a reason code from a closed list (#767: the key, too late, a new message, already answered, BlueBubbles
   down or timed out, macOS not letting BlueBubbles control Messages…), and every request the hub took gets a result,
   one it can't read or one that errors included. The Desk shows "Not sent: …" in words for the code, with Resend
   where another try can help. The code lives on the sealed request only, never in the public status, and the hub's
   log holds it as a number. `act` is the only code in the hub that sends.
4. **Not taken in 10 minutes** (the Mac was offline): the request is `expired`, never sent late. The Desk says "Not
   sent, Mac was offline" with **Resend**, which makes a new request (steps 2 and 3 again, the unlock still needed). A
   `failed` send (BlueBubbles didn't confirm it, or the hub never answered within 5 minutes of the end) says "Not
   confirmed: it may have sent. Check Messages before you resend", with Resend; the check in step 3 refuses a resend
   once Messages shows the reply went.

**Tapbacks (#888, Nikita 2026-11-05: "lets me like heart, thumbs up messages, like you would in iMessage").** Under
their words on the Relay card (and in a group's flipper), six small buttons: heart, thumbs up, thumbs down, haha, !!
and ?, aimed at their latest line by default, with a small stepper to pick an earlier one of theirs. A tapback is a
send in every way that matters: the device's unlock, one tap makes one `react` request, signed with the send key, 10
minutes to live, single-use (the hub records the id before acting, so a replay is refused), one at a time per thread,
never made by anything but that tap. What it carries is only which tapback and which line: its text is
`<tapback>:<ref>` (`love:1a2b3c4d`), never words.

- **The line's ref.** The hub gives each of their shown lines (never Nikita's own) an 8-hex ref, an HMAC under the
  send key over the thread and the message's guid in Messages. The guid itself stays in the hub's memory, beside the
  shown texts (`lines` in `apps/hub/src/engine.ts`): never on the site, in the state file or in a log. The site only
  checks that the ref is one of the thread's shown lines; the hub maps it back to the guid from its own memory, never
  from the request, so a request can only reach a message the Desk was shown. After a restart, or once the list moves
  on, an old ref is refused (`no-line`) and the Desk asks again from the fresh list.
- **On the Mac.** The hub sends it through BlueBubbles' react route (`POST /api/v1/message/react` with `chatGuid`,
  `selectedMessageGuid`, `reaction`, `partIndex` 0), which BlueBubbles serves only with its **Private API** on (its
  helper inside Messages). A tapback settles nothing: the thread stays owed, its draft stays, and it is not counted
  as a reply.
- **Private API off.** The hub asks `GET /api/v1/server/info` at start and every 5 minutes, and puts one state on the
  sealed list: `tapbacks: "on"` or `"off"` (`private_api` and `helper_connected` both true, or not). With it off the
  site makes no tapback request (`tapbacks-off`), the hub refuses one it gets, and the Desk shows one quiet line
  (turn on BlueBubbles' Private API on the Mac) in place of the buttons. A react call BlueBubbles refuses for the
  Private API turns the state off at once. `relay check` says which it is.

**The composer's emoji.** A small button beside Send opens a compact, hand-made grid of common emoji (no library); a
pick goes in at the cursor of the reply box and is part of the typed words, which go only on Send, exactly as typed.

"Later", "Done", "Bring back" (#870) and "Put it in my style" are requests the same way (single-use, 10 minutes, signed). They need the
session but not the send unlock, because none of them can send. "Say it" uses the browser's own speech recognition:
in Chrome and Edge, the audio goes to the browser maker's speech service (Google, Microsoft); in Safari, to Apple's,
or it stays on the device. The words land in the text box. Nothing goes anywhere else until Nikita taps Send or "Put
it in my style".

### Texts Skippy writes (#536)

Nikita can ask Skippy for a text in their signed-in chat or on a Talk call ("text Riley I'm running 10 late"). It is
never on a public surface, and nothing sends without their confirmation of the exact card.

1. **The ask.** Skippy's answer names who and the gist as a `text` action (`api/_skippy/prompt.ts`): one plain line
   each, capped, never with a number, address, card or key in either (the privacy check). On a call, the agent's
   `draft_text` tool carries the same two, and it runs in Nikita's browser, not on a server. The site runs the relay's
   own rules over the ask before anything is kept (`askRuled`, `api/_relay/compose.ts`): the private skip list over
   who and the gist, the money and legal pre-filter and one-time codes over the gist. A match is refused (Skippy says
   Nikita texts that one themselves). A texting ask is never kept in Skippy's room log.
2. **The compose request.** The Desk asks `POST /api/relay { action: "compose", who, gist }` with its session (no
   unlock: it can't send). It is a request like the others: single-use, 10 minutes, signed with the send key over
   every field and over who, at most three waiting at once. The site makes a fresh card id for it.
3. **On the Mac.** The hub finds the contact by name in its own memory (`matchContacts`): an exact name first, else
   every contact whose name holds all of the words. **No guessing**: none is a "none" card, more than one (or one
   contact with several numbers) a "choices" card with up to 6 names and masks, and Nikita picks; the pick names the
   hub's own random id for that choice, never a handle from the browser. For one contact, every rule runs over the
   ask with that contact's names and handle, and a match is an "off" card with no model call. Then the hub reads
   Nikita's own past texts to them from BlueBubbles, each through the rules (a match is left out), and Blasto writes
   the text from the **placeholdered ask and the style examples only** (`readComposeInput`, `composeRequest`: no
   thread lines at all, 300 characters of ask, the same style caps, fenced in `<ask>`). The site runs the rules over
   the ask again before it calls. Names go back in only on the Mac.
   **The chat, never a guessed number** (`chatFor`, `chatHandle` in `apps/hub/src/engine.ts`): Relay's own thread with
   that handle, else a one-to-one chat Messages already has with it (an address exactly, a number by its last 10
   digits, iMessage before SMS), else a new iMessage chat **only** for an address or a number saved in full
   international form (`+` and the country code). No country code is ever added: a number saved without one that
   Messages has no chat with is a "nochat" card, and Nikita texts that one themselves. A choice that can't be reached
   this way is left off the choices.
4. **The card.** The list carries the card to the Desk: the contact's name, `ending 0123` (the number's last 4 digits)
   or `r•••@e•••.com`, the channel and the full text. It shows in Skippy's chat with Send, Edit and Cancel. An edit
   makes a new version of the card and asks again; a confirmation never carries from one version to the next.
5. **The send.** Send on the card is the ordinary send request above: this device's 72-hour unlock, single use, 10
   minutes, signed, bound to the card and to the version Blasto wrote (`draftAt`), with the text on screen (Nikita's
   edit, if any). Only one send per card; a card that went takes no other. The hub's `act` checks it all again, and
   that Messages shows **no message from Nikita in that chat since the card was made**: the same text means a send
   that timed out but went (the card turns "sent"); any other means the card is behind the chat (the card turns
   "moved": "Not sent: you've texted them since this card was written"). Either way nothing sends. Only then it sends
   through BlueBubbles to the card's own recipient. "Not sent, Mac was offline" and Resend work as above.
6. **On a call.** Skippy reads both aloud, the recipient and the exact text, and waits for "send" or a tap. The
   agent's `send_text` tool only asks: the browser sends only when one of Nikita's own transcribed lines is a plain,
   whole-line yes ("send", "send it", "yes, send it", "ok send", "go ahead and send", "send it now"; never a line
   with a "?", "to", "instead", "myself" or "I'll" in it, so "Did you send it?" or "Send it to Sam instead" never
   count), said after Skippy was handed that very version to read and within 2 minutes of it, with the send itself
   within 2 minutes of the yes (`saidSend`, `confirmed` in `rooms/relay/data/compose.ts`). Only the card the
   call is on takes it. Or after their tap. An edit (`edit_text`) is a new version: read again, asked again. A locked
   device says so and waits for the passkey.

What this adds to each boundary:

- **Skippy's chat model** (Claude, the Desk's own chat) sees Nikita's ask as they typed it, as any ask; Skippy never
  sees the contact's details, Blasto's draft or the card.
- **On a Talk call, ElevenLabs** (the call's speech and its agent model) hears the ask and gets the card's name, mask
  and text from the browser so Skippy can read them aloud. Skippy's agent and every submind's are set to
  `platform_settings.privacy: { record_voice: false, retention_days: 1 }` (`VOICE_PRIVACY`,
  `api/_skippy/voicecrew.ts`): no audio is recorded, and the transcript is kept 1 day. Both names are from ElevenLabs'
  agent docs (privacy: retention, audio saving). 1 is the shortest that keeps the Council's read of the transcript
  once a call is over (#479); `0` schedules deletion at once and would lose it. That day's copy at ElevenLabs is the
  residual risk of texting by voice. Typed, the card never leaves the Desk.
- **Blasto** sees only the placeholdered ask, Nikita's own placeholdered past texts to that contact and the style
  numbers.
- **Logs** on the Mac add only the kinds "text composed" and "compose settled", with counts.

### The backlog, the full text and the learned voice (#758)

Nikita asked for these on 2026-11-05. They widen what the hub reads on the Mac and, for the full text, what the
sealed list holds. The public site still gets counts only.

- **The backlog.** At start, once a day, and when Nikita taps **Rescan** on the Desk (a single-use request like
  Later or Done, no unlock needed, one waiting at a time), the hub asks BlueBubbles for every one-to-one chat with its
  last message (`POST /api/v1/chat/query`, `with: ["lastmessage"]`, sorted by last message, 1,000 a page, every page,
  10 at most). A chat whose last message is someone else's and came within **30 days** is owed, oldest first. Every
  rule runs on it as on a new message (money and legal, the skip list, codes, short codes, promos, closing intent), and
  a match settles it with no model call. Where the last message alone can't settle it, the hub reads that chat's
  recent messages (200 chats at most per scan, the newest first; #803, was 40). Owed ones go through Dialtone and Blasto as usual, so the first scan
  spends from the $10 cap; 100 at most are taken in (#861, as many as the Desk lists; was 80), the rest are counted as
  older. Every owed thread without a gist is in line for Dialtone, newest first, 6 a round (every 15 seconds), whatever
  brought it in; a sort that didn't land (a failed model call, the site or BlueBubbles out of reach) is tried again
  after 2 minutes, doubling to an hour, and at the monthly cap every 6 hours, and the Desk shows the reason (#861).
  An owed thread stays listed while their latest text is within the 30 days. Older unanswered
  chats (30 to 60 days) are display only: the Desk shows "N older unanswered" and, on "show them", their names and when. They get no
  model call, no gist and no shown text, and the hub forgets the snapshot after 7 days or the next scan. A chat past
  60 days is left out entirely, neither named nor counted (#803). Groups are never part of the backlog.
- **Photos and files (#870).** A text that is only a photo, a file or a sticker counts as a text that came: it makes
  the person owed (it used to be dropped before the sort, so a photo-only text never reached the line, and one from
  them after Nikita's reply even closed the thread as answered). The hub reads only that there was an attachment
  (Messages' U+FFFC mark in the text, or BlueBubbles' `hasAttachments` and balloon flags), never the attachment, its
  name or its kind; attachments are still never asked for. The sealed list carries a count (`media` on an owed
  one-to-one item) and a shown line `{ text: "Photo", media: true }` (the hub's word, nothing of the file). A model sees
  the marker line `[a photo or attachment]` in its place, and a thread that is only attachments gets no model call
  (its gist is the hub's own "Sent a photo or attachment.").
- **Set aside, and back (#870).** The sealed list also names every other one-to-one thread with a text from them in
  the last 30 days that isn't in the line (`aside`: Relay id, name, channel, when, and why from the closed list
  `ASIDE_WHYS`: no-reply, closing, done, money, code, short-code, promo; never the text, never a gist, and never the
  skip list's or a group's). "Bring back" (a signed, single-use `back` request, session only, it can't send) puts a
  thread Dialtone, closing intent or Nikita's Done set aside back in line, and it stays owed whatever Dialtone reads
  until he replies. A rule's kind can't be brought back: its texts never reach a model. A scan also revisits, once per
  text, a thread a model or closing intent set aside when their text is still the last word (an earlier hub's wrong
  verdict used to stay for good); a rule's settle, the skip list and Done stay. The scan reads every page of
  BlueBubbles' chat list until an empty one (it used to stop at the first short page).
- **On the Mac only (#870).** `relay check` prints counts: contacts, contacts with a photo and photos synced, chats
  BlueBubbles returned (one-to-one and groups), how many its last messages make owed, and how many the hub counts
  owed and set aside; since #891 also whether a photo sync is running or how the last one failed (minutes ago, the
  site's HTTP status, how many photos it didn't take), and the hub log's `photos synced` and `photos failed` lines
  carry the same numbers. `relay why <name or number>` prints, for each one-to-one chat of the matching contacts, the
  verdict by the hub's own rules (owed, answered, group, set aside by a rule and which kind, closing intent, older
  than the window, nothing to answer, not in BlueBubbles), the dates of their last text and Nikita's, the count of
  unanswered attachments and the state file's row. Names and masked numbers go to the Terminal only; no message text
  is printed and nothing is sent to the site (the skip list lives on the site, so the state file's verdict shows it).
- **Unread.** BlueBubbles serialises each message's `dateRead` (from `chat.db`, no Private API needed). The hub keeps
  only "unread or not" for an owed thread, the Desk marks the row, and the public status counts it. Read state never
  hides or settles anything.
- **The full text on the Desk.** For an owed one-to-one thread the hub sends the **last 5 texts of its recent turns
  (since #870 from both sides: the unanswered run and up to 4 turns before it, Nikita's own marked `me: true`, the
  same window every rule has just passed over), 1,000 characters in all, as written** (no placeholders: those are only for model calls), with
  the times. For a group, the same from its members since Nikita last replied, each with the member's name and photo
  id. They ride on the sealed list (`messages` on the item), shown only to a passkey session; the site drops each one a
  week after it came, and the next push drops them all when the thread closes. **Never for a thread any rule matches**
  (money, legal, codes, short codes, promos, the skip list): the hub clears them the moment a rule matches, and the
  site never sees them. They are never logged, never in the state file and never sent to a model beyond the
  placeholdered snippets above. The gist stays as a small line under them.
- **Groups.** A group's summary shows in a Groups section on the Texts page. A group becomes owed when Dialtone says
  Nikita was asked something, or when one of Nikita's names (`me` in the hub's `config.json`, "Nikita" by default)
  stands as a word in a member's text. It is still never drafted for. BlueBubbles 1.9.12 doesn't expose a chat's mute
  state (its `isFiltered` is the unknown-senders filter), so muted groups aren't treated apart.
- **The group flipper (#805).** The Groups section shows one group at a time (‹ ›, the arrow keys or a swipe), its
  summary and shown texts in one scrolling column, and a reply box. The reply is Nikita's own words, sent exactly as
  typed (no model, no restyle) after the Undo window, with the send unlock, through the send path below, once per
  tap; nothing is drafted and nothing sends on its own. A group last heard from over 60 days ago doesn't show. After
  a reply the group's summary and shown texts go, as when he answers from the phone.
- **Photos on group lines.** Each member's line shows that member's photo by its opaque id (#642), or initials.
  Photos are display only, never part of a model call.
- **The learned voice.** "Learn from my texts" (on the Desk's Relay voice section; a single-use request) has the hub
  read the last 12 months of messages from BlueBubbles' message query into memory, once. **On the Mac**, over every
  sent text it read, it computes numbers only: median and long length, how often texts start with a capital, are all
  lower case, use emoji, end with a full stop, use "!", "?" or an ellipsis, end with a regular sign-off word, come
  as double texts, and how fast Nikita usually replies. No text leaves the Mac for these. **The sample** (above, Blasto
  learning the voice) is placeholdered per contact on the Mac and goes in one call. The hub keeps the traits, the tones,
  the numbers and, per learned contact, its relationship under a hash of the handle; the messages read are dropped when
  the run ends. Each later draft carries the traits, the tone for that contact's relationship and the numbers, inside
  a fenced `<voice>` block, as well as that contact's own past replies as before.

### Mac to logs

- **Allowed:** timestamps, event kinds from a closed list ("thread owed", "draft ready", "status sent", "sent",
  "request refused"; since #758 "backlog scanned", "backlog failed", "voice learned", "voice failed"; since #888
  "tapback sent", "tapback failed" and "tapbacks" with `on` 1 or 0), numeric fields
  (counts, and the learn's cost), and error class names from a closed list (`apps/hub/src/log.ts`).
- **Never:** message text, names, phone numbers, email addresses, Messages chat ids (they contain the phone number or
  email address, e.g. `iMessage;-;+1555…`), Relay's thread ids, drafts, summaries, dictation, prompts, model answers,
  request or response bodies, headers, Keychain values, error messages.
- No core dumps (the `launchd` job sets the core limit to zero). No third-party telemetry or error reporting.
  An uncaught error or rejection is logged by class only and the hub exits (launchd restarts it), so no stack trace
  is printed. `launchd` writes stdout and stderr into `launchd.log` in the same 0600 folder, which the hub empties
  once a day.
- **The site** logs nothing in the Relay routes. Azure's own request log has the path and status code of each call,
  never a body.

## Retention

| What | Kept for | How it ends |
| --- | --- | --- |
| A thread's row on the Mac | While owed or later, within 30 days of its oldest unanswered text (then it counts as older); a settled or answered one-to-one row 30 days after the last message or reply (#870: the Desk lists recent set-aside ones), a group's 7 | Hourly sweep |
| Shown texts (#758), on the Mac | The hub's memory, until the thread closes or a rule matches | Never written down |
| Shown texts (#758), on the site | Until the thread closes (the next push), a week after each came at most | The next push; `readTextsView` and every Desk read; Unpair, the wipe |
| Older unanswered snapshot (#758) | Until the next scan; 7 days at most | Hourly sweep; Rescan |
| The learned voice (#758), on the Mac and the site | Until Nikita learns again, or the wipe and Unpair | Replaced whole by the next learn |
| The learn pass's messages (#758) | One run | Never written down |
| Drafts | Until sent or settled; 7 days at most | Cleared on send; hourly sweep |
| Group summaries | 48 hours | Hourly sweep |
| Reply-later times | Until they fire; 14 days at most | Hourly sweep |
| Seen request ids | 24 hours | Hourly sweep |
| Style examples and profile | One call | Never written down |
| Daily counts | 7 days | Hourly sweep |
| Logs on the Mac | 14 days; `launchd.log` a day | Daily |
| The site's public status | The latest only | Replaced on each push; reset by Unpair and the wipe |
| The site's sealed list | Replaced on each push (on every change, and at least every 5 minutes); owed items 30 days, settled ones 7 | The next push, `readTextsView`, Unpair, the wipe |
| Requests on the site | A day after their 10 minutes end | Dropped on each read and write |
| New-text cards (#536), on the Mac and the site | A day; a sent card loses its text at once | The hourly sweep; `readTextsView`; Unpair, the wipe |
| Contact photos (#642), on the site | While the Mac still has them; checked hourly, a changed one re-sent (#907) | `?view=photos` drops the rest; Unpair, a new pairing, the wipe |
| Sender logos (#642), on the site | 30 days per domain | The tick drops older ones |
| Snippets on the site | One call | Never written down |
| Anthropic's copy | Anthropic's API retention (above) | Anthropic's policy |

## The off switch and the full wipe

**Off.** `relay off` on the Mac pauses the hub: it takes in no new message (the poll's cursor moves on), makes no model call, refuses every
request, stops the nudges, and reports `hub: "paused"`. Data stays until it ages out or is wiped. `relay on` resumes.

**Wipe.** `relay wipe` on the Mac (and only there, so a stolen session can't use it) asks to confirm, then:

1. Pauses as above.
2. Sends a final status with `hub: "wiped"` and every count at zero, then unpairs on the site
   (`?view=unpair`): the hub's token stops working, and the list and the requests go.
3. Unloads and deletes the `launchd` job.
4. Removes any BlueBubbles webhook to the hub an install before #749 left, then deletes Relay's four Keychain items (the BlueBubbles password, the
   hub token, the send key, the local key).
5. Deletes `~/Library/Application Support/CEO Relay/` (the state file, the hub, its Node runtime),
   `~/Library/Logs/CEO Relay/`, the `relay` command and its PATH line in `~/.zprofile`.

It doesn't touch Messages: those are Nikita's messages, and Relay never owned them. It doesn't remove BlueBubbles;
`relay wipe --all` also quits BlueBubbles and deletes its folder. The wipe ends by naming what only Nikita can do:
**Unpair on the Desk** if the Mac couldn't reach the site (it forgets the hub's token and the sealed list), and,
after `--all`, turn BlueBubbles off in System Settings › Privacy & Security.

**Checking it worked.** `relay wipe --verify` (also run at the end of every wipe) checks each of these and prints pass
or fail: Relay's two folders don't exist; `security find-generic-password -s "CEO Relay"` finds nothing; `launchctl`
lists no Relay job and the plist is gone; nothing listens on port 7420; the `relay` command is gone; the site's status
reads `wiped`. Time Machine never held Relay's folder, because it is excluded from backups when it is made.

## Access

- **No Full Disk Access for Relay.** The hub reads Messages only through BlueBubbles' local API, so it never opens
  `chat.db` and needs no special permission. BlueBubbles needs Full Disk Access (and Accessibility to send) for itself,
  and, since it sends with AppleScript (its Private API stays off), Automation access to Messages: System Settings >
  Privacy & Security > Automation > BlueBubbles > Messages (#767). macOS asks the first time it sends; until it is
  allowed, a send fails with the reason `mac-permission`, which the Desk and `relay status` name.
- **The hub listens on `127.0.0.1:7420` only**, never `0.0.0.0`, and only for the `relay` command's own control
  calls, which need the local key (a random value in the Keychain). New messages come from polling BlueBubbles'
  local API, so nothing, BlueBubbles included, calls into the hub (#749). The listener refuses any request with an `Origin` header, so a web
  page in a browser on the Mac can't reach it, and it sends no CORS headers. BlueBubbles' proxy service is set to
  none (no Cloudflare, ngrok or zrok tunnel), with no Firebase or Google sign-in. BlueBubbles must not be reachable
  from the network. The installer and `relay status` check that it listens on `127.0.0.1` only, or that the macOS
  firewall is on and blocks incoming connections to it. If neither holds, they warn and say which setting closes
  it, and the installer stops unless Nikita carries on. The firewall doesn't filter the Mac's own loopback, so the
  hub still reaches BlueBubbles.
- **No inbound path from the internet or a browser to the Mac.** No Tailscale, no tunnel, no port forward. The Desk
  reaches the Mac only through requests the hub polls for.
- **Keychain.** The four secrets are generic passwords in the login Keychain under the service "CEO Relay". They are
  written through `security -i` on stdin, never on a command line. The Keychain doesn't fence them to the hub: any
  program running as Nikita can ask `security` for them. Never in the `launchd` plist, an environment file, the repo
  or a log.
- **The installer** downloads Node from nodejs.org and checks it against nodejs.org's published SHA-256 list. It
  downloads the hub from the site and checks it against the SHA-256 the site's build stamped into the installer
  itself. It writes the `relay` command from its own functions and downloads nothing twice. **These checks guard
  against a broken or swapped download only, not against the site itself: nothing is signed for now.** It asks only
  for the BlueBubbles password and the pair code, read from the Terminal, never echoed.
- **The Mac.** FileVault stays on (DELIVERY.md, "Environments"), and the Mac locks itself.

## What a breach of each store would expose

| Store | Exposes | Limits |
| --- | --- | --- |
| The Mac itself, unlocked | Everything in Messages, not only Relay | FileVault and the lock screen; the biggest risk, and not Relay's to fix |
| Relay's state file | Who Nikita owes and since when (by chat id), gists, drafts and group summaries from the last month, older unanswered chat ids, the learned voice | No message bodies; short retention; 0600; no backups |
| Logs | When Relay was busy | No content by rule and by test |
| The Keychain items | With the hub token and send key: the right to push a list, poll requests and spend on the model calls up to the cap (not to make send requests); with the local key: the `relay` command's pause, resume and report; with the BlueBubbles password: BlueBubbles itself | The hub token never expires on its own: it works until Unpair or `relay wipe`. The $10 cap; send requests are made only on the Desk |
| BlueBubbles | Everything in Messages, and sending as Nikita | Local only, no tunnel, its own password |
| The site's sealed list | Names, gists, drafts and the requests' text, and (#758) the last few unanswered texts of each owed thread from the last 30 days (#803) and the learned style traits, for whoever holds both the Azure store and `GMAIL_TOKEN_KEY` | Sealed; shown texts 30 days, 5 per thread, never from a thread a rule matches (no money, legal, codes or skip list); no numbers outside what someone typed in a shown text |
| A Desk session | The list, and with this device's unlock, send requests for drafts already on it, for 72 hours | Passkey sign-in; the unlock is per device and per passkey; one thread, one draft, 10 minutes; Lock and Unpair |
| Anthropic's copy | The trimmed, placeholdered text of recent calls | No known names or numbers; not used for training |
| The site's public status | Counts: how many replies are owed, how fast Nikita answers | Public by design; nothing more to take |

## The tests and checks that enforce it

Run by `npm test`:

- **`packages/core/src/relay.test.ts`** holds the public status to counts only: message text, names, numbers, keys
  and chat ids in every field and as extra keys never pass. It walks the schema and pins its keys.
- **`api/_relay/relay.test.ts`** covers:
  - the pairing: one use, 5 tries, 10 minutes, no `Origin`, needs the send unlock, never replaces a paired Mac,
    Unpair, and the wipe's unpair;
  - the hub token, the gate opening exactly the hub's calls, and the public status alone of `/api/relay`;
  - a refused status stores nothing, a list with anything extra is refused, a settled item goes after 7 days and an
    owed one after 30, and a shown text after a week;
  - the sealed store holds no name or draft in the clear, and another key can't open it;
  - the send unlock: needed, fresh, single-use, 2 minutes, HttpOnly and Strict, 72 hours and not a minute more,
    bound to its passkey and the Desk key, ended by Lock; and (#870, also `api/desk-auth.test.ts`) set by a passkey
    sign-in for that passkey only, never by a failed one or an enrolment, cleared by Sign out, each send still its own
    single-use request;
  - requests: single-use, signed over every field, 10 minutes then expired, Resend only for expired or failed and
    only with the unlock, bound to the thread and the draft, a group only as typed words (never a draft, a restyle
    or a group whose summary a rule cleared, #805), results only for taken requests;
  - model calls: no tools, metadata or caching, hostile answers refused, off-shape snippets refused before any call,
    the caps, the hard stop at $10 on its own ledger, four calls racing at the cap's edge (one gets in), a failed
    call's reservation released and a timed-out call's kept, and an unreadable ledger stopping the calls.
- **`apps/hub/src/hub.test.ts`** covers:
  - placeholders swap whole names, name parts, numbers and addresses;
  - the rules settle codes, short codes, promos, money and legal texts, and the skip list;
  - a group with a money text or a skip-listed member, and an owed thread that then gets a money text, get no call;
  - a money text before Nikita's reply keeps the thread from the model when a harmless text follows, and a past reply
    that trips a rule never becomes a style example;
  - a 40-message thread and a 60-message group are trimmed on the Mac to what the site accepts;
  - after a send that timed out but went, a resend is refused;
  - a listed group takes typed words exactly as typed, once, never a draft-bound send, and not after its reply (#805);
  - snippets to the site hold no names or numbers;
  - the skip list stops a call, and a hostile answer is refused;
  - nothing sends without a request, and a good request sends once;
  - a replayed, expired, tampered, foreign-key, changed-draft or unknown-thread request is refused, and nothing sends
    while paused;
  - the list holds no number or chat id, and message text only in an owed item's shown texts;
  - a whole day's log lines hold only kinds and numbers;
  - the sweep ends each row by its deadline;
  - the server binds `127.0.0.1` and refuses a missing key, a wrong key or an `Origin`.
- **Texts Skippy writes (#536)**: `api/_relay/relay.test.ts` (a compose needs the session and is signed over who; the
  rules and the privacy check stop an ask before anything is kept; a card never carries a whole number or address;
  a card's send needs the unlock, is bound to the card's version, goes once, and only for a ready card; a pick names
  only the hub's own choice; Blasto's new text carries the ask and style only, and the rules run on the site too),
  `apps/hub/src/hub.test.ts` (the contact is found on the Mac without guessing; the snippet holds no name or number;
  the card shows the last 4 digits only; money, legal, codes and the skip list get no call; a card sends once, through
  `act`, with the text on screen; a resend after it went is refused; no log line names anything),
  `rooms/relay/data/compose.test.ts` (a spoken send counts only from Nikita's own words for the version
  they heard read; an edit asks again; the unlock is needed), `api/skippy.test.ts` (the text action, never logged, the rules
  in the chat) and `api/_skippy/voicetools.test.ts` (the texting tools run in the browser and only Skippy has them).
- **The backlog, the full text and the voice (#758)**: `apps/hub/src/backlog.test.ts` (the 30-day window, owed
  oldest first, older counted, groups left out, every rule and closing intent on the backlog, unread never hiding a
  chat, the scan paging every chat), `apps/hub/src/learn.test.ts` (the numbers, the stratified sample: 30 per contact,
  about 1,000, the most-texted first; money, legal, codes, promos, the skip list, strangers, groups, other people's
  texts and anything over a year old left out; names, numbers and addresses swapped before anything leaves),
  `apps/hub/src/hub.test.ts` (a group that asks or names Nikita is owed and one that doesn't isn't; a rule-matched
  thread never shows its text; the shown texts' caps), `api/_relay/relay.test.ts` (Rescan and Learn as single-use
  requests, the learn call's shape, caps, budget and quote-free answer, the shown texts' week and sender rules) and
  `packages/core/src/relay.test.ts` (`unread` and `older` are counts, unread never above owed).
- **Names and gists (#861)**: `apps/hub/src/hub.test.ts` (the contacts count, 0 when BlueBubbles reads none; an
  unknown sender by the last 4 digits only; why a thread has no gist, from the closed list, and the retry after a
  backoff; every gist-less owed thread in line after a restart, a few a round), `rooms/relay/data/thread.test.ts`
  (the Desk's words for each reason, a reason off the list refused, the Contacts hint) and `packages/core/src/relay.test.ts`
  (`contacts` is a count).
- **Missing texts (#870)**: `apps/hub/src/relay870.test.ts` (a photo-only text makes the person owed at the top with
  a Photo line and a count and no model call, a marker only beside words, and never closes a thread as answered; a
  set-aside thread that gets a new text is re-opened and listed first; a scan revisits a model's or closing verdict
  once per text and never a rule's; the set-aside list carries no text; Bring back keeps a thread owed and refuses a
  rule's; `relay why`'s verdicts and lines hold no text or number; contact pictures in every shape), and
  `apps/hub/src/install.test.ts` (`relay check` and `relay why` reach the hub).
- **Tapbacks (#888)**: `apps/hub/src/tapbacks.test.ts` (their lines get a ref, Nikita's own none, and no guid leaves
  the hub; a signed tap reaches BlueBubbles' react route on that very message and settles nothing; a replay, a changed
  request, an unknown ref and a late one are refused; with the Private API off the list says so and nothing reaches
  BlueBubbles; the react route's body and the server-info read), `api/_relay/relay.test.ts` (the unlock first; one
  signed single-use request naming only the tapback and the ref, handed out once; only their shown lines, one of the
  six, one at a time; none while the Mac says off; refs read back by hand) and `rooms/relay/data/react.test.ts` (the
  latest line by default, never Nikita's own; the emoji picker puts its pick in at the cursor).
- **`apps/hub/src/install.test.ts`** runs `relay wipe` and `relay wipe --verify` on a made-up home folder with
  macOS's commands stubbed: every file, the job, the four Keychain items and the PATH line go, and the check passes.
  It does nothing without "wipe" typed, and the check names what is left. `relay status` warns when BlueBubbles is
  open to the network. The hub's hash is stamped into the installer, the `relay` command is written from the
  script's own functions (valid bash, no download), and the pair code is read hidden.
- **`apps/hub/build.mjs`** fails the build if the hub's bundle contains the Anthropic SDK or an API-key header.
- **`rooms/boiler/data/model.test.ts`** keeps the Desk's copy of THREAT-MODEL.md word for word, and
  **`api/_world/prompt.test.ts`** proves the world step never carries Relay-style messages or contacts.
