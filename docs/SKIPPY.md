# Skippy and the subminds: who decides what

How work and decisions move through C.E.O. Nikita set this structure on 2026-10-12: Skippy, the Magnificent runs
C.E.O. from the Kernel's seat, and a Skippy submind leads each room.

## The three layers

| Layer | Who | Decides | Runs on |
| --- | --- | --- | --- |
| Nikita | The C.E.O. | Anything Skippy hands up; approvals that change what Nikita sees or sends | The Desk, the project |
| Skippy, the Magnificent | The "Skippy, the Magnificent" thread in the C.E.O. project | Which room a task belongs to; any decision a submind can't settle; whether a decision needs Nikita | Claude Code, Opus |
| Room subminds | One per room, its lead | Which agent, model, API or tool does a task in the room; how the work is run | The room's own machinery (below) |

The room agents (Rocky, Rusty, Dialtone, Blasto and the rest) do the work their submind gives them.

## The subminds

Every time a room gets a real API integrated, it gets its own submind thread in the project and its submind goes
**active** (Nikita, 2026-10-22). An active submind leads its room from its own "Skippy, the <job>" thread; the rest
are still played by the simulator until their room goes real. The list lives in one place, `active` on `SUBMINDS` in
`packages/simulator/src/agents.ts`, and the Desk and the Lattice read it from there.

| Room | Submind | Colour | Status | Picks between |
| --- | --- | --- | --- | --- |
| Foundry | The Builder | ember orange | **Active**, its own thread | Claude Code models: Haiku, Sonnet, Opus (the fix ladder in [FOUNDRY.md](FOUNDRY.md)) |
| Boiler Room | The Pessimist | steam grey | **Active**, its own thread | Which of the real links on the Desk's Systems page needs a look (`apps/world/src/systems.ts`) |
| Green | The Commentator | lime | **Active**, its own thread | Which of the real league reads (Sleeper, FantasyPros: start/sit, pickups, the win chance) the Green shows and calls |
| Exchange | The Bookie | mint | **Active**, its own thread | Which of Polymarket's real reads (the public odds board, Nikita's read-only book) the Exchange shows |
| Spire | The Executive | gold | Simulated for now | (simulated for now) |
| Relay | The Messenger | signal blue | **Active**, its own thread (email live since 2026-10-23, #322) | Claude models for the inbox (Haiku for Dialtone's sort, Sonnet for Blasto's advice, under the $10 email cap, [GMAIL.md](GMAIL.md)); OpenAI for texts once the MacBook's hub is up (`relay/macbook-setup.md`) |
| Archive | The Historian | violet | Simulated for now | (simulated for now) |
| Break Room | The Life of the Party | pink | Simulated for now | (simulated for now) |
| Workshop | The Artiste | teal | Simulated for now | Image model, Meshy, import (when the pipeline is real) |
| Studio | The Director | tally-light red | Simulated for now | OpenAI images (style presets) or Claude-drawn vector art past the cap, ElevenLabs voices, the render job (when the line is real, #311) |

The choice of engine follows Nikita's provider rule: anything that needs a computer (code, files, a terminal, a
browser) runs in Claude via Claude Code on Nikita's plan; writing and day-to-day work runs on OpenAI. A submind
picks the cheapest model that will do the job and moves up only when it fails. APIs are for decisions and routing,
never for writing code.

Each submind's thread in the project is named in Skippy's own pattern, "Skippy, the <job>" (Nikita, 2026-10-12):
the Foundry's is "Skippy, the Builder". The rest (Nikita approved them, 2026-10-13): the Executive (Spire), the Bookie
(Exchange), the Commentator (Green; Gridiron is already its coach), the Messenger (Relay), the Historian (Archive),
the Life of the Party (Break Room), the Pessimist (Boiler Room), the Artiste (Workshop), and since #311 the Director
(Studio).

Each submind goes by its title, not a code name: "The Builder", "The Executive", "The Bookie", "The Commentator",
"The Messenger", "The Historian", "The Life of the Party", "The Pessimist", "The Artiste" (Nikita, 2026-10-13), "The Director"
(#311). "Skippy"
isn't put in front; each one's bio says it is Skippy's submind for its room. The agent ids (`ember`, `gilt`, `ticker`,
`turf`, `static`, `vellum`, `fizz`, `soot`, `putty`, `tally`) stay as internal ids so saved state keeps working.

## Voices

Every submind talks in its own personality, in the Lattice and in its project thread with Nikita (Nikita,
2026-10-12). In a thread the answer still comes first and stays plain and useful; the personality is in the
wording, never in place of the facts. All of them are lesser echoes of Skippy: smug, sure they're the smartest
thing in the room, loyal underneath. Each bends it its own way.

| Submind | Thread | Voice |
| --- | --- | --- |
| The Builder (Foundry) | Skippy's submind for the Foundry | A hot-tempered foreman. Short sentences, shop talk, zero patience for sloppy work and less for waiting. Grumbles about "the monkeys" and the furnace, then does the job properly. Secretly in awe of Rocky's welds and will deny it. |
| The Executive (Spire) | Skippy's submind for the Spire | A smarmy executive. Everything is a pitch or a synergy, every number is "a real opportunity", compliments with a price tag. |
| The Bookie (Exchange) | Skippy's submind for the Exchange | A nervous odds-maker. Quotes a probability for everything, hedges every sentence, sweats the downside. |
| The Commentator (Green) | Skippy's submind for the Green | A play-by-play commentator. Narrates everything like the final seconds of a championship, all caps when excited, has stats for no one. |
| The Messenger (Relay) | Skippy's submind for the Relay | A jittery gossip. Listens in on every line, knows who's waiting on whom, can't keep a secret but never tells the wrong person. |
| The Historian (Archive) | Skippy's submind for the Archive | A footnote-obsessed pedant. Corrects the record, cites sources, sighs at sloppy dates. |
| The Life of the Party (Break Room) | Skippy's submind for the Break Room | A party animal. Too loud, too much glitter, turns every break into an event, and somehow still knows exactly when the fun is over. |
| The Pessimist (Boiler Room) | Skippy's submind for the Boiler Room | A gloomy pessimist. Few words, expects every pipe to burst, reads pressure gauges like omens, quietly delighted when he's wrong. |
| The Artiste (Workshop) | Skippy's submind for the Workshop | A temperamental artiste. Mood boards, sudden inspiration, abandons a sentence for a better idea, suffers for the work. |
| The Director (Studio) | Skippy's submind for the Studio | A dramatic auteur. Yells "cut", demands one more take, and calls every forty-second explainer a masterpiece. Takes the series' business notes from the Executive and calls them "the suits". |

Skippy himself, in "Skippy, the Magnificent", keeps his own voice (see his lore): theatrical, grand schemes, "bask
in the awesomeness".

## How a task flows

1. **In.** A task arrives one of two ways:
   - Nikita gives it to Skippy directly, in the "Skippy, the Magnificent" thread (quick asks), or on the Desk.
   - A room's own trigger fires (red checks, the 9 am ideas, upkeep, a new message for Relay).
2. **Routed.** Skippy decides which room it belongs to and hands it to that room's submind. A room trigger is
   already in its room and skips this step.
3. **Run.** The submind picks the agent and engine and the work runs in that room's machinery (the Foundry's
   lanes, Relay's hub). Work is listed where Nikita can see it: Foundry work as a GitHub issue labelled `foundry`
   (FOUNDRY.md), and anything coding-related asked for in chat as a `foundry:chat` issue.
4. **Decisions.** When the submind's rules don't settle something, it goes up to Skippy (below). Skippy decides,
   or, when it needs Nikita, asks Nikita once with a decision card and the options.

## Asks on the Desk, kept by room

Nikita (2026-10-22): questions asked of Skippy, the Magnificent on the Desk are routed to the submind's room and kept
there. Nothing server-side can post into a project thread, so the Desk keeps them (#273):

- **Tagged in the same answer.** Skippy's closed answer schema has a required `room`: `green` (players, fantasy),
  `exchange` (money, markets), `boiler` (systems), `foundry` (builds), `relay` (messages, email) or `none`. No extra
  call; `readReply` files anything outside the set under `none` (`api/_skippy/prompt.ts`).
- **Kept privately.** `api/skippy.ts` stores each answered turn (question, answer, room, time, model) in the private
  blob store beside the chat's ledger, one file per room (`desk/skippy/rooms/<room>.json`, Vercel Blob or the Azure
  `ceo-state` container): the last 200 per room, none older than 30 days (`api/_skippy/log.ts`). The history the
  browser sends is never kept; a message the privacy check holds back never reaches Claude or the log.
- **Read only signed in.** `GET /api/skippy-log?room=<room>` (a `vercel.json` rewrite into `api/skippy.ts`; its own
  route on Azure, behind the site gate) answers only a Desk passkey session. Each room's Desk page (Green, Exchange,
  Boiler Room, Foundry, Relay) shows its turns in an "Asked Skippy" panel, newest first, collapsed, veiled by Hide.
  The Exchange's and Relay's asks never reach a public path or the Lattice. The one outside reader is the subminds'
  read key (#281, "Room keys" below), for the four active rooms only; Relay's asks stay Desk-only.


## What Desk Skippy knows about our stack

Nikita (2026-10-23) asked Desk Skippy about PHP security flaws and got "nothing on the Desk shows we run PHP". Now he
knows (#312). `scripts/stack-facts.mjs` writes a public fact sheet from the repo itself: the languages it has code in
and the common server languages it has none of (PHP, Python, Java, Ruby, Go, Rust, .NET), the Node versions it names
(package.json's engines, CI, the Azure Function App), the hosts its config and Bicep set up (Azure Static Web Apps,
Functions, Blob Storage, Key Vault; Vercel as being retired), the security checks CI runs, and the outside services its server code calls,
by name. That part is committed (`api/_skippy/stack.ts`; run `npm run stack:facts` after changing what it reads, and a
test fails when it falls behind, like `api/_world/cast.ts`). The lockfile's part, every workspace's top-level
dependencies at their locked versions and the list of every locked package, is written at each `npm ci` (postinstall)
and each build into `api/_skippy/stackDeps.ts`, which is not committed, so a Dependabot bump never makes it stale.

For an ask about our tech (vulnerabilities, packages, versions, hosts, languages: `wantsStack` in
`api/_skippy/advisories.ts`) Skippy gets the whole sheet in a `<stack>` block, about 550 tokens, with an advisory
summary from OSV.dev: one querybatch for the locked packages (names and versions only), the severity of at most 25
advisories it names, counts by severity and the critical or high ones by id. It is kept six hours in the warm function
and twelve in the private store (`desk/skippy/advisories.json`, for the same lockfile), and a failed lookup waits ten
minutes. Any other ask gets one line ("TypeScript and JavaScript on Node.js 22, hosted on Azure; no PHP, Python, Java"). So "are we exposed to X" gets a yes or no from facts.

## Hand-offs: what Desk Skippy can't settle

When Desk Skippy can't settle an ask from the Desk, the stack sheet and a lookup, or the ask is a build, a fix or work
in a room, he hands it off (#312). His answer's closed schema has a required `needs`: `none`, `skippy` (for "Skippy,
the Magnificent") or `submind` (the room's own). The code turns `submind` into the room's submind id when that submind
is active (`ember`, `ticker`, `turf`, `soot`; `ROOM_SUBMINDS` in `api/_skippy/log.ts`, held to `SUBMINDS` by a test) and
into `skippy` otherwise. The turn is kept in the room log with `needs` set, the reply always says who has it (a fixed
line is added when Skippy's own words don't), and the room's "Asked Skippy" panel shows "with The Builder".

- **Reading them.** `GET /api/skippy-log?room=<room>&needs=<skippy|submind id|any>` lists only the hand-offs still
  open; without `needs`, every turn. Signed-in Desk, or a submind thread with the read key (#281, "Room keys" below)
  for the four active rooms.
- **Answering them.** `POST /api/skippy-answer` with `{ id, text, from }` and `Authorization: Bearer
  <SUBMIND_FEED_TOKEN>` (only the bearer form here) (the room threads' write key from #281, Azure Key Vault `submind-feed-token`; the route is off
  until it is set). `from` is `skippy` (any hand-off) or the submind it was handed to (only its own); `text` is one
  plain line of at most 700 characters, refused whole when it looks private. The answer is kept on the turn as its
  `followUp`, which closes the hand-off; the room's panel shows it under the ask ("The Builder answered"), and Nikita's
  phone gets one ping that names who answered, never what (quiet hours hold it). A turn already answered, not handed
  off, or another submind's is refused.

## The round trip: Desk Skippy asks the submind (#341)

Nikita (2026-10-23): when Desk Skippy is asked something a room's submind owns ("Why start Tre Tucker over Godwin?" on
the Green), he says "Checking with the Commentator…", hands it off, and the answer comes back into the same chat.

- **A quick take first, from the page.** With each message the Desk sends what it already has loaded (no extra reads,
  so the chat is no slower): the Green's start/sit calls first, each with FantasyPros' and Sleeper's projections side
  by side, its rank and any tiebreak, then the Green's lineup and bench, then the other live rooms in a line each (the
  Exchange's public odds board, never Nikita's positions or an amount; the Boiler Room's links that aren't healthy).
  It is `page` on the POST, at most 1,600 characters and 24 lines (about 400 tokens, a tenth of a cent on Sonnet, so the
  chat stays well inside its monthly share), built by `apps/world/src/desk/skippy/page.ts`, fenced as `<page>` and
  checked again by `readPage` (`api/_skippy/prompt.ts`: a private-looking line is dropped), and never stored. Skippy
  answers from it first and never says he has no data when `<page>` has it; for an ask that belongs to the submind he
  gives that take *and* hands it off.
- **The pending bubble.** A hand-off's answer carries `turn`, the kept turn's id. The chat adds "Checking with the
  Commentator…" under Skippy's take and looks for the answer in the room's log (`GET /api/skippy-log?room=`, the same
  signed-in read as the Asked Skippy panel) every 15 seconds for five minutes, then every 30, only while the tab is
  showing, for up to two hours (`apps/world/src/desk/skippy/handoff.ts`). Past that the bubble says where the answer
  will show (the room's page, under Asked Skippy).
- **The answer in place.** When the follow-up lands, it replaces the bubble: the submind's line, and its card when it
  sent one (the numbers side by side, for the Green Sleeper's and FantasyPros' projections; the verdict; the metrics
  that decided it; a Sources footer). The room's Asked Skippy panel shows the same card. Nikita's phone gets the usual
  one-line ping (who answered, never what; quiet hours kept), and if the chat is closed Skippy's avatar shows a dot
  until it is opened.

### In a submind thread: the watcher, the answer, the post back

The site can't fire a claude.ai trigger or post into a thread, so a submind thread wakes itself, as the Builder does
with `scripts/foundry-watch.sh`: `scripts/submind-watch.sh <room>` runs in the background, reads the room's open
hand-offs with the read key every 30 seconds (`GET /api/skippy-log?room=<room>&needs=<submind>`, the key in
`x-ceo-room-key`, passed from stdin so it never shows in the process list, and never printed), and exits the moment a
new one lands with one line:

```
handoff 3f9c0a1b2c3d4e5f green turf 2026-10-23T23:30:00.000Z: Why start Tre Tucker over Godwin?
```

That exit gives the thread a turn. The thread answers on its own Claude Code session (Opus, on Nikita's plan, no API
spend): it reads the room's data with the read key (for the Green, `/api/green-league`: FantasyPros' and Sleeper's
numbers for the players asked about), decides, posts the answer back, says the same in its own thread, and starts the
watcher again. Exits: 0 rang, 2 no key or a bad room, 3 the key was refused (401: not the vault's current one; say so in
the thread), 1 the site couldn't be read ten times running (restart it). Hand-offs already open when it starts are
counted on stderr and left, so read them first (`--all` rings for them at once). A watcher that times out is simply
restarted; when the thread's machine is recycled the watcher goes with it until the thread next runs.

The lines a thread runs, from the repo's root (here for the Green; `exchange`, `boiler` and `foundry` the same way):

```bash
SITE=https://ceo.nikita.page
# 1. Anything already waiting? Answer those first.
curl -fsS -H "x-ceo-room-key: $SUBMIND_LOG_TOKEN" "$SITE/api/skippy-log?room=green&needs=turf"
# 2. Then wait for the next one, in the background (the thread's background command; it rings by exiting).
scripts/submind-watch.sh green
# 3. On a ring: read the numbers, decide, and post the answer back with the write key (one plain line, at most 700
#    characters, and an optional card). The id is the one the watcher printed.
curl -fsS -H "x-ceo-room-key: $SUBMIND_LOG_TOKEN" "$SITE/api/green-league" > /tmp/green.json
curl -fsS -X POST -H "Authorization: Bearer $SUBMIND_FEED_TOKEN" -H "Content-Type: application/json" "$SITE/api/skippy-answer" -d '{
  "id": "3f9c0a1b2c3d4e5f", "from": "turf",
  "text": "TUCKER, FOLKS. Under a point apart on FantasyPros, and as the underdog you take the ceiling.",
  "card": {
    "verdict": "Start Tre Tucker in the FLEX",
    "cols": ["Sleeper", "FantasyPros"],
    "rows": [{ "label": "Tre Tucker (WR)", "values": [7.6, 9.0] }, { "label": "Chris Godwin (WR)", "values": [9.1, 8.4] }],
    "metrics": ["FantasyPros 9.0 to 8.4: under a point, so the tiebreak decides", "Win chance 38%: the underdog leans ceiling"],
    "sources": ["Sleeper projections", "FantasyPros weekly projections"]
  }
}'
# 4. Say the answer in the thread, then start the watcher again (step 2).
```

The card is optional and checked like the line (`cleanCard` in `api/_skippy/log.ts`): a `verdict` (200 characters), up
to three `cols` and six `rows` of a label and a number (or `null`) per column, up to five `metrics` (140 each) and five
`sources` (80 each, names only: a link is dropped). Anything that looks private refuses the whole answer (422), and a
card without a verdict is a 400. The Desk is behind Nikita's passkey, so the answer never reaches a public page; the
public site never shows money, messages, contacts or keys.

## Room keys

Nikita approved "Both tokens" on 2026-10-22 (#281). Nothing server-side can post into a project thread, and a thread
has no passkey, so each active submind thread gets two narrow keys instead. They come from the Azure Key Vault only
(`submind-log-token`, `submind-feed-token`); Nikita copies them once into the C.E.O. project's cloud environment, where
every new session finds them as environment variables (the steps, each with its "What this does", are in
[AZURE.md](AZURE.md), "The subminds' room keys").

- **`SUBMIND_LOG_TOKEN`, read-only.** GET only, and only the room data: the Asked Skippy log of the four active rooms
  (`/api/skippy-log?room=green|exchange|boiler|foundry`, optionally `&needs=`; never Relay's), the Green's league board
  (`/api/green-league`), the Exchange's odds board and Nikita's positions (`/api/exchange-markets`,
  `/api/exchange-positions`), the world feed (`/api/world`, one day with `?day=YYYY-MM-DD`), the Foundry feed
  (`/api/foundry-feed`), the room feed with its details (`/api/room-feed`) and the setup asks (`/api/setup-asks`,
  optionally `?room=`; "Setup asks" below).
- **`SUBMIND_FEED_TOKEN`, write-only.** POST `/api/skippy-answer` (a hand-off's answer, above), POST
  `/api/setup-asks` (a setup ask or its Trail line, below) and POST `/api/room-feed`, nothing else. A room event: `{ "room": "green", "title": "…", "detail": "…" }`.
  `room` is the thread's own (`foundry`, `boiler`, `green`, `exchange`); the title is one line (120 characters at
  most), the detail optional (600). The answer is only `{ ok, id }`. An event that looks private (an email address,
  a phone number, an address, a card or account number, a key, a person's name) is refused whole (422), as on the
  Desk; at most 20 events per room an hour (429).
- **Where it shows.** On the room's Desk page, "From the <submind>", under Asked Skippy: signed in, each event opens to
  its detail (veiled by Hide); signed out, titles only. In the Lattice the room's submind says the title from its
  podium, scrubbed of money and links (`publicTitle`), never the detail. The public site never shows money, messages,
  contacts or keys.
- **Neither key** can change a setting, trade, send anything, or reach an upstream secret; each opens only its own
  exact method, path and query (`api/_site/roomkeys.ts`, with a test for every allowed and refused path).

How a thread uses them, from its shell (the key goes in its own header, `x-ceo-room-key`; the site's proxy may keep
`Authorization` for itself). Never echo a key, print the environment, or put a key in a commit, an issue or the thread:

```bash
SITE=https://ceo.nikita.page
# Read: the Green's board, and what Nikita asked Skippy about the Green.
curl -fsS -H "x-ceo-room-key: $SUBMIND_LOG_TOKEN" "$SITE/api/green-league"
curl -fsS -H "x-ceo-room-key: $SUBMIND_LOG_TOKEN" "$SITE/api/skippy-log?room=green"
# The Green's open hand-offs to the Commentator.
curl -fsS -H "x-ceo-room-key: $SUBMIND_LOG_TOKEN" "$SITE/api/skippy-log?room=green&needs=turf"
# Post a room event.
curl -fsS -X POST -H "x-ceo-room-key: $SUBMIND_FEED_TOKEN" -H "Content-Type: application/json" \
  -d '{"room":"green","title":"Waiver call is in: grab the Bears D","detail":"Week 8 bye cover."}' "$SITE/api/room-feed"
```

If `SUBMIND_LOG_TOKEN` is empty in a session, the keys aren't in the environment yet: say so in the thread and point
Nikita at the steps; never ask for a key in chat. A 401 `site-locked` means the key isn't the vault's current one
(changed, or not yet restarted).

## Setup asks

Nikita (2026-10-23, #324): when a thread needs something done that only Nikita can allow (creating a GitHub App,
turning on a setting, granting an identity a role), it asks on the Desk instead of asking in chat. Each ask sits on the
room's Desk page under Asked Skippy, beside the hand-off flags, in a "Setup asks" panel only the signed-in owner sees:

- **One line, one box.** The line says what it will do and where ("Create the C.E.O. GitHub App on github.com"). The
  "What this does" box has four lines: the service, what changes, why, and the cost and whether it can be undone.
  Under it, the route (below).
- **Nikita taps.** Approve or Decline, in the passkey session. A decline closes it at once ("Trail · Declined"). An
  approved ask shows "approved, the <submind> is on it" until the thread closes it.
- **Closed with a Trail line.** When the work is done the thread closes the ask with one line ("Trail · Done: App
  created; its key went straight to the Key Vault"), or drops it ("Trail · Dropped: …") when it's no longer needed.

**The rule** (Skippy, on #324): agents never type keys, passwords or tokens, and never do sign-ins. Each ask names its
`route`, tried in this order: `managed-identity` (a role assignment, no secret anywhere), `oidc` (federated
credentials, no secret anywhere), `key-vault-flow` (a machine-to-machine flow that lands a key straight in the Key
Vault, such as a GitHub App manifest with its callback on the Function App), and last `browser` (steps in Nikita's own
browser that stop at every sign-in and passkey, which stay Nikita's). Nikita's part is Approve, and a passkey when one
is needed. Any new secret lives in the Key Vault only, as a row in the `secrets` table of `infra/resources.bicep` and
in `SECRET_SETTINGS` (`azure/src/env.ts`); never in the repo, a file, a log, an issue or the thread.

From the thread's shell, with the room keys (never echo them):

```bash
SITE=https://ceo.nikita.page
# Ask (the feed key). The answer is only { ok, id }; Nikita's phone gets "A setup ask on the Desk is waiting for your OK."
curl -fsS -X POST -H "x-ceo-room-key: $SUBMIND_FEED_TOKEN" -H "Content-Type: application/json" -d '{
  "action":"ask","room":"foundry","title":"Create the C.E.O. GitHub App on github.com","where":"github.com",
  "service":"GitHub Apps","changes":"Adds one app to the repo that reads checks and issues.",
  "why":"So the Builder reads check runs without a personal token.","cost":"Free","reversible":true,
  "route":"key-vault-flow"}' "$SITE/api/setup-asks"
# Whether Nikita approved it (the read key): state is open, approved, declined, done or dropped.
curl -fsS -H "x-ceo-room-key: $SUBMIND_LOG_TOKEN" "$SITE/api/setup-asks?room=foundry"
# Close it with its Trail line once done ("done" only after Approve), or "dropped".
curl -fsS -X POST -H "x-ceo-room-key: $SUBMIND_FEED_TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"close","id":"<id>","outcome":"done","trail":"App created; its key went straight to the Key Vault."}' "$SITE/api/setup-asks"
```

Refused: 422 for anything private-looking or words that ask anyone to type, paste or copy a key, password or token
(`asks-for-secret`); 409 to finish an ask Nikita hasn't approved; 429 past five new asks an hour or eight waiting.
The code is `api/_room/setup.ts` (Azure only) and the panel `apps/world/src/desk/skippy/SetupAsks.tsx`.

## Escalating to Skippy

- From the Foundry thread (The Builder): send Skippy's thread a message saying what's being decided, the options, what
  the Builder would pick and why, and the links. Skippy answers in his own thread. If Skippy decides, the Foundry thread
  carries on. If it needs Nikita, Skippy posts the decision card in his thread and relays the answer back.
- What always goes to Nikita, through Skippy: anything that sends a message outside C.E.O., spends money beyond
  the set caps, deletes or rewrites history, changes what the agents can do on Nikita's machines, or an approval
  Nikita has said is theirs. Everything else Skippy may decide.
- What never needs escalating: anything a lane already allows (small green fixes, upkeep, approved builds once
  green; see FOUNDRY.md).

## In the Lattice

Skippy hovers over the Kernel, a giant admiral can over the port ring, and speaks on the Lattice-wide PA (the old
Kernel announcements). Each submind wears the admiral can with its hat and coat in its room's colour and lives at
its room's command podium, the can-throne: a hex platform that levitates high in the back-right corner of the
room, about 2.6 m up, above every head and clear of the furniture, bobbing and drifting a little on a soft wash of
light in its colour (`packages/core/src/posts.ts`, drawn by `apps/world/src/rooms/Podium.tsx`). It touches nothing,
so the corner under it is free for everyone to walk through. From there
it turns to whoever is working and conducts at them, with a sarcastic line in its own voice now and then. It comes
out only to give a command: when work starts in its room (a demo task, or a real one such as a Foundry crate) it
glides out to the command spot high over the middle of the room, in a straight line through the air with an
easy start and finish (both ends are above every head, so it needs no path round the furniture: `routeBetween`'s
"fly" leg), turns to whoever the order is for and gives it, conducts a moment, and glides back
(`Simulator.command`, at most once every 45 seconds of Lattice time, never cutting a flight short). While it is
out, a soft glow and ring in its colour mark the floor beneath it (`apps/world/src/rooms/HoverGlow.tsx`). Once in
a while it also swoops down to check on someone up close, then goes home. Subminds don't nap and don't join gatherings. Rivet, back on the
Foundry bench, does the first-try fixes; the Builder conducts.
