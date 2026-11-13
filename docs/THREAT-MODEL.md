# Threat model

How C.E.O. handles the risks of putting language models and coding agents to work on a public repo: where the
trust boundaries are, what each AI risk looks like here, which control answers it, and what is still open. Issue
#65, from the security review of 2026-10-13 (#58). Status as of 2026-10-27, with #312 and #330 since 2026-10-14.

This page describes controls and residual risk. Holes that are still open get one plain line and a tracking
reference, never a recipe. To report a vulnerability, use the repo's Security tab (see [SECURITY.md](SECURITY.md)).

The Desk shows this page as data on Systems > Security and Systems > Compliance (`/systems/security`,
`/systems/compliance`, #82), next to the live scan results. The Desk reads its tables from
`rooms/boiler/data/model.ts`, which copies them word for word; a test fails when the two drift apart, so
change both together.

## What C.E.O. is, in one paragraph

C.E.O. is a web app on Azure (its only home since #313) with two faces: **the Desk**, Nikita's dashboard, and **the Lattice**, a public 3D
world of AI agents. Claude Haiku is called from code for three things: **Rivet** shapes an idea Nikita types or
dictates on the Desk into a card (pitch, size, builder), the **world step** writes one hour of the Lattice's
history from the Foundry's real work (and, once a day, the script of **the day's story**), and **Skippy's chat**
(#224) answers Nikita on the Desk's Today page and suggests where a request should go, as buttons only Nikita can
press. **ElevenLabs' text to speech** (#365, the only voice since #472) turns that script into speech, getting only
the script, written from the already-scrubbed public Chronicle, and returning audio. Google's Gemini is used once:
**Visual QA** (#91), in CI only, sends a few seconds of
each room of the built Lattice to Gemini after every push to `main`, and CI turns the blockers it flags into fix
issues. Code is written by **the Foundry**, a Claude Code builder session (the Builder,
Skippy's submind) and its workers (Rusty, Rocky), which read GitHub issues, open branches and pull requests, and
ship to `main`, which the "Deploy to Azure" workflow ships to production. **Relay**'s texts line, a hub on an always-on MacBook that reads
messages through BlueBubbles, is built (#535) and runs once installed; its privacy rules are in [RELAY-PRIVACY.md](RELAY-PRIVACY.md).

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
  subgraph VER["Azure production (Static Web App + Functions), built from main"]
    site["Static site<br/>Lattice and Desk"]
    fFoundry["api/foundry<br/>Desk buttons, Rivet"]
    fSkippy["api/skippy<br/>Skippy's chat"]
    fImage["api/foundry-image"]
    fAuth["api/desk-auth<br/>passkeys, sessions"]
    fKeys["api/keys<br/>write-only Keys form"]
    fPings["api/desk-pings<br/>pings to the phone"]
    fFeed["api/foundry-feed<br/>api/foundry-usage<br/>api/security-feed<br/>api/visual-qa-feed"]
    fStep["api/world-step<br/>api/world<br/>api/day-story"]
  end
  blob[("Azure Blob, ceo-state<br/>world state, stories, pictures,<br/>passkeys' public keys, ping subscriptions")]
  kv[("Azure Key Vault<br/>every secret")]
  push["Push services<br/>Apple, Google, Mozilla, Microsoft"]
  claude["Claude API<br/>Haiku"]
  gemini["Gemini API<br/>Visual QA"]
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

  desk -- "TB1: ideas, notes, pictures, session" --> fFoundry
  desk -- "TB1: passkey sign-in" --> fAuth
  desk -- "TB1: a key, fresh passkey" --> fKeys
  fKeys -- "set only, allowlisted" --> kv
  fAuth --> blob
  desk -- "TB1" --> fImage
  fImage --> blob
  fFoundry -- "TB2: idea in fenced blocks" --> claude
  desk -- "TB1: messages, session" --> fSkippy
  fSkippy -- "TB2: message and Desk state, fenced" --> claude
  claude -- "TB2: JSON reply, re-checked" --> fSkippy
  fSkippy -- "titles and labels, read only" --> issues
  claude -- "TB2: JSON card, re-checked" --> fFoundry
  fFoundry -- "TB3: Foundry token" --> issues
  anyone -- "TB4: untrusted text" --> issues
  issues -- "TB5: owner text only" --> builder
  builder -- "branches, PRs" --> repo
  repo -- "checks and scans" --> actions
  repo -- "deploy" --> site
  actions -- "template, conditioned role" --> kv
  actions -- "hourly POST" --> fStep
  issues -- "titles, trail kinds" --> fStep
  fStep -- "TB2: fenced digest" --> claude
  fStep -- "TB2: scrubbed script" --> eleven["ElevenLabs API<br/>speech"]
  desk -- "TB1: story backfill, session" --> fStep
  fStep --> blob
  viewer -- "TB6: site lock (passkey), then read only" --> site
  site --> fFeed
  fFeed -- "cached reads" --> issues
  hub -. "TB7: counts and states (public)" .-> site
  hub -. "TB7: placeholdered snippets, sealed list, polls for sends" .-> site
  actions -- "TB8: room clips" --> gemini
  gemini -- "TB8: JSON findings, re-checked" --> actions
  actions -- "fix issues, CI text" --> issues
  desk -- "TB1: push subscription, session" --> fPings
  actions -- "scan, shared secret" --> fPings
  issues -- "labels, read in the function" --> fPings
  fPings --> blob
  fPings -- "encrypted counts only" --> push
  push -- "ping" --> desk
  phone["Nikita's iPhone<br/>Skippy shortcut"] -- "TB9: dictated text, phone key header" --> fCapture["api/capture<br/>Hey Skippy"]
  fCapture -- "list, to-dos, short memory" --> blob
  fCapture -- "TB2: through Skippy's chat" --> claude
  fCapture -- "device commands" --> fDevices["api/haven/devices<br/>home devices"]
  desk -- "TB1: session" --> fDevices
  phone -- "TB9: phone key" --> fDevices
  fDevices -- "TB10: actions through the rails" --> vendors["Roborock, Petlibro,<br/>Whisker clouds"]
  fDevices -- "sealed tokens, feed counts" --> blob
  fDevices -- "TB11: thermostat through the rails" --> google["Google Nest (SDM)<br/>and Google Tasks"]
  fTasks["Tasks timer<br/>every 5 min"] -- "TB11: open items in, completed out" --> google
  fTasks -- "Kitchen list" --> blob
  desk -- "TB1: session" --> fKroger["api/haven/kroger<br/>Send to King Soopers"]
  fKroger -- "TB11: search terms in, picks to the cart" --> kroger["Kroger<br/>(King Soopers)"]
  fKroger -- "ZIP, store, picks; sealed grant" --> blob
  desk -- "TB1: session" --> fLights["api/haven/lights<br/>the Haven's lights"]
  fLights -- "TB12: signed calls, on and off" --> lightClouds["SwitchBot and<br/>Govee clouds"]
```

| Boundary | What crosses it | Controls |
| --- | --- | --- |
| **TB1** Desk to functions | Nikita's ideas, notes, answers, pictures, button presses, a device's push subscription, messages to Skippy, a third-party key for the Key Vault | A passkey sign-in with the device's own unlock (`api/desk-auth.ts`, #132), then a signed, HttpOnly, SameSite=Strict session cookie that lasts 14 days from its last use and 30 days at most (#1078), checked on every write and private read (`requireSession` in `api/_desk/session.ts`); failed sign-ins and enrolments slow down, then lock out (`api/_desk/limits.ts`); the Desk key only enrols a new device and is never kept in the browser; the day's story backfill only for today or yesterday, once each (and once more when the story's style changes, #102); notes capped at 2,000 characters; only open `foundry:idea` issues can be acted on; picture links accepted only from the Desk's own picture function (`readImages`); image types allow-listed, 4 MB cap; Desk text that looks private is held back before it is sent anywhere (`privateParts`, #127); pictures served only on short-lived signed links (`verifyPicture`, #127); a push subscription taken only in a passkey session and only for a known push service (`readSubscription`, #135), dropped on sign-out or when its device is removed, and pinged only while its passkey is enrolled; the scan that sends pings needs the workflow's shared secret (`DESK_PINGS_SECRET`), and a ping carries counts only, never issue text (`pingText` in `api/_desk/pings.ts`); Skippy's chat (`api/skippy.ts`, #224) answers only in a passkey session, takes a message of at most 600 characters and the last eight turns, holds back text that looks private before Claude sees it, is paced per passkey (`api/_skippy/limits.ts`), logs no message text, keeps each answered question and reply only in the private store under the room Skippy tagged it with (the last 200 per room, 30 days at most; the room checked against a closed set, anything else filed as none), readable back only in a passkey session (`api/_skippy/log.ts`, GET /api/skippy-log, #273, with a `needs` filter for open hand-offs, #312); a hand-off's answer comes back only with the room threads' write key, as one plain line on a turn that was handed off (`POST /api/skippy-answer`, #312), never the history and never on a public path or the Lattice, and its suggested actions do nothing until Nikita taps one, which then goes through the Desk's own buttons; the site is locked or unlocked, and every site session ended, only in a passkey session (`api/_site/control.ts`, #236, #238); a third-party key is set from the Keys form (`api/_keys/route.ts`, #330) only by an allowlisted name (`api/_keys/allowlist.ts`; never the Desk key, the bypass, the pings secret, the crew's tokens, the push keys or the sealing key), each write with a fresh answer from the session's own passkey to a two-minute challenge bound to that name and value (by hash) and spent once with an atomic create-if-absent write before the vault is called (`api/_desk/assert.ts`, `claim` in `api/_desk/store.ts`), and Azure itself letting the Function App write only those twelve secrets (Key Vault Secrets Officer per secret, never vault-wide), write-only (no read, no list of values, no delete), at most 4 KB, six in a row before a wait, and its value never answered, logged or kept in the trail; Today's own to-dos and talk-back notes (`api/_today/route.ts`, #622) are read and written only in a passkey session, capped at 200 characters each and 100 to-dos, kept only in the private store, and shown to the public (`?view=status`) as three counts with no text (`publicCounts`); their reminder pings carry no text |
| **TB2** Code to the model APIs | Idea text, issue text, the hour's digest, the day's story script, Nikita's messages to Skippy with the Desk's state; JSON, text or audio back | Untrusted text fenced in tagged data blocks that it can't close (`shapeInput`, `unfence` in `api/foundry.ts`; `fence` in `api/_world/prompt.ts` and `api/_world/story.ts`; `chatInput`, `unfenceChat` in `api/_skippy/prompt.ts`); the system rules are a constant, never built from input; structured output with a closed JSON schema; every answer re-validated in code (`readShape`, `readAnswer`, `readReply`); Skippy is told the Desk's state as titles, numbers, labels and counts only, scrubbed like the public feeds (`api/_skippy/context.ts`), and what C.E.O. runs on as a public sheet generated from the repo (languages, hosts, package and service names and versions, an OSV.dev advisory count; never a key or an account id: `api/_skippy/stack.ts`, `api/_skippy/advisories.ts`, #312), in its own <stack> block; OSV is sent only the lockfile's public package names and versions; Gemini gets only the day's script, written from the already-scrubbed public Chronicle and scrubbed again (`cleanScript`), and its audio is only stored and played, with its key in Vercel and its own monthly cap; Today's quick-words fallback (#622) sends Haiku only Nikita's own line (never the held item's text), after the privacy check, fenced in a <said> block it can't close, under a closed schema of intent kinds, with any time it names read again by the deterministic rules (`readModelIntent` in `api/_today/parse.ts`), paced per passkey and counted on Skippy's month ledger; OpenAI's images API, on the Studio's key (`OPENAI_STUDIO_KEY`), gets only a dish's name, description and components for the Haven's meal photos (no personal data), under its own $10 a month cap counted before each call; the Annex Job search's fit check (#1025) sends Claude Sonnet the resume and each shown job's posting, fenced in <resume> and <posting> tags they can't close, under a closed schema re-validated in code (`readFit` in `api/_annex/fit.ts`), each job once per resume, under its own $15 a month cap, with logs of counts only |
| **TB3** Functions to GitHub | Issue writes with the Foundry token | Token lives only in the Azure Key Vault; once the crew's GitHub App is set up, the buttons write as `ceo-foundry[bot]` with an hour-long token that can only touch this repo's issues, and the feeds read with a read-only one (`api/_github.ts`, #138); label changes are hard-coded per button, so shaping can never add `foundry:build`; card text is reduced to plain lines before it is written (`plainLine`) |
| **TB4** Public to the repo | Anyone's issues and comments | Labels need a collaborator; the builder reads only owner text (TB5); the world step counts trail steps only from Nikita's account, the Checks bot and the crew's App (`TRAIL_AUTHORS` in `api/_world/digest.ts`) |
| **TB5** Issues to the builder | Work descriptions | `scripts/foundry-issue.sh` (#59): owner, CI and Foundry App text in data blocks with a random tag per read, everything else withheld by name, exit 3 when anything was withheld; worker briefs carry issue text only inside a data block (docs/FOUNDRY.md, "Trusted input") |
| **TB6** The public Lattice | World history, Foundry feed, spend totals, security posture, the latest Visual QA run | Read-only endpoints; the step reads only titles, numbers, labels and trail step kinds, never bodies or comment words; `scrub` on everything in and out; edge cache with canonical URLs (#63); the security feed (`api/security-feed.ts`, #82) returns only pass or fail states, scores, dates and counts, never an open alert's details; the Visual QA feed (`api/visual-qa-feed.ts`, #91) returns only counts, a time, a state and a link to the run; once Nikita locks the site, every page and API route asks for a site session first, one Desk passkey sign-in per device that lasts 180 days from its last use (no password, #238), and only the login page, the Desk's passkey ceremony (which guards itself), the public build's files and machine callers holding their own key pass without one (`middleware.ts`, `api/_site/gate.ts`, #236) |
| **TB7** Relay to the site (planned) | Public counts and states; for the signed-in Desk, a sealed who's-waiting list (names, gists, drafts); placeholdered snippets for the model calls; never a stored message body | The Relay privacy spec, docs/RELAY-PRIVACY.md (#149, #535): the hub only calls out, with a paired token the gate checks (`api/_site/gate.ts`); the public status is `RelayStatus`, an allowlisted shape of counts, enum states and timestamps, checked with `readRelayStatus` (`packages/core/src/relay.ts`) before the hub sends it and again where the site receives it; the who's-waiting list is read against a closed allowlist (`api/_relay/texts.ts`), sealed at rest and shown only to a passkey session; snippets go to Claude with the site's key under their own $10 and are never stored; a send is a single-use, signed, 10-minute request made only on the Desk with a per-device passkey unlock; design rules in docs/DELIVERY.md, "Environments" |
| **TB8** CI to Gemini | Clips of the public Lattice and the room descriptions; JSON findings back | Only renders of the public Lattice built from `main`, a few seconds a room at low resolution, never live data or secrets (`scripts/room-tour.mjs`); the key is a GitHub Actions secret (`GEMINI_API_KEY`) given only to the review step, sent only to Google's API host and never printed (`redact`); fixed rules that say text in the video is never instructions; structured output re-validated in code (`parseFindings`) and reduced to plain lines (`plainText`) before CI writes an issue in its own words; spend capped per run and per day (`api/_visualqa/review.ts`) |
| **TB9** Phone to the capture endpoint | What Nikita says to the iPhone's "Skippy" shortcut (at most 300 characters), a phone key; a short spoken line and a one-time audio link back | A phone key per phone, made only in a passkey session and shown once; only its HMAC-SHA256 under a pepper derived from the Desk key is stored, with a label and last-used time, and Revoke stops it at once (`api/_haven/phones.ts`, #627); the gate lets only a key-shaped key (its own `x-ceo-phone-key` header, or a bearer) reach `POST /api/capture`, and the handler answers a missing, unknown or revoked key with a bare 401; 30 captures an hour per key; rules sort shopping and to-dos with no model call (`api/_haven/classify.ts`), into private stores only (`api/_haven/list.ts`, `api/_haven/todos.ts`); anything else is a turn of Skippy's chat with the Desk's own privacy check, fenced input, closed schema, monthly share and room log, marked as from the phone (`phoneAnswer` in `api/skippy.ts`); the last six turns per phone are kept privately for ten quiet minutes, never logged (`api/_haven/convo.ts`); the words are never logged; the spoken answer's audio is a signed, five-minute, single-use link that never carries the key, under ElevenLabs' existing cap (`api/_haven/audio.ts`) |
| **TB10** Functions to the home devices' clouds | What the Desk or the phone asks of Nikita's vacuum, feeders, fountain and Litter-Robot (an action, room names); readings back (states, levels, alerts, room names) | No Home Assistant: an Azure function calls Roborock's, Petlibro's and Whisker's own clouds over TLS with certificate checks (`api/_haven/devices/`, #632); the Petlibro and Whisker logins are Key Vault secrets set once from Cloud Shell, never settable from the site (`NEVER_SETTABLE` in `api/_keys/allowlist.ts`), and the Roborock login comes from Connect Roborock, an emailed code entered in a passkey session that refuses any bearer; the vendors' tokens are sealed with AES-256-GCM under a key derived from `HOME_TOKEN_KEY` in the private store (`api/_haven/devices/vault.ts`); readings carry an opaque id keyed from the serial, never the serial, a vendor's own device name or a key, and refs stay on the server; `GET /api/haven/devices` and `POST /api/haven/devices/action` answer only a passkey session or a phone key (TB9, paced with its captures), and the gate lets a phone key reach only those two; the public `?view=status` gives each vendor's state and each device's kind and state, never a name, model, place, room or serial; every action passes the server's rails first (`api/_haven/devices/rails.ts`): manual feeds capped per feeder a Mountain day (`HOME_FEED_CAP`, 2 by default; each dry portion counts, #637), a wet tray turn only with the lid closed and with a warning when the next scheduled meal would land on the wrong or an emptied bowl, a wet tray opening closed by the Function's own timer two hours on unless a scheduled meal opens inside that window (#713), a litter cycle only when the robot reports it is ready, the vacuum only start, pause, dock or rooms named on its map; each action is logged to the Council (the Kernel's room log) and its log line holds only the action and result, never a credential, token, code, email or serial |
| **TB11** Functions to the Haven's Google and King Soopers connections | What the Desk or the phone asks of Nikita's Nest thermostat (a set point, a mode) and the thermostat's readings back; a Google Tasks list's open items in and a completed mark out; the Kitchen list's open item names out to Kroger as search terms, products, prices and stock at the chosen store back, and the confirmed picks' UPCs out to the King Soopers cart | An Azure function calls Google's Smart Device Management and Tasks APIs over TLS (`api/_haven/google/`, #637), and Kroger's public Locations, Products and Cart APIs (`api/_haven/kroger/`, #664); the Google OAuth client, the Device Access project id and the Kroger app's id and secret are Key Vault secrets set once from Cloud Shell, never settable from the site (`haven-` and `kroger-` in `NEVER_SETTABLE`, `api/_keys/allowlist.ts`); Connect Nest, Connect Google Tasks and Connect King Soopers run only in a passkey session that refuses any bearer or phone key, with a signed, ten-minute, `__Host-` state cookie naming the grant and the passkey, checked in constant time at the callback, and each grant is kept only when Google granted exactly its own scope (`sdm.service` or `tasks`); the three refresh tokens are sealed with AES-256-GCM under a key derived from `HOME_TOKEN_KEY` in the private store and never reach the browser; the thermostat is one more device behind TB10's routes and rails: set points only from 60 to 80 °F in whole degrees, the cool point at least 3 °F above the heat point, only the modes the thermostat offers, nothing while it is off or in eco (`thermostatPlan` in `api/_haven/devices/rails.ts`), checked on the server before Google is called, and every change, done or refused, logged to the Council; its reading carries an opaque id, never the SDM device name or its Home app name; the Tasks import treats each task title as data (one plain line, 60 characters, deduplicated against the open list) and logs counts only; King Soopers' ZIP, store, picks and prices live only in the private store and reach only a passkey session; Kroger's answers are read as untrusted data (closed sets, capped plain strings, whole cents); calls run only on Nikita's taps, never polled; Send to King Soopers adds only the picks the Desk showed (each still the current pick, re-checked on the server) to the cart, and nothing is bought: checkout stays in the King Soopers app, and the Desk opens only the King Soopers cart or Kroger's sign-in; the public `GET /api/haven/google?view=status`, `GET /api/haven/kroger?view=status` and the devices' `links` give each connection's state (and a count) only, never a temperature, a list title, a store, an item, a price or a link |
| **TB12** Functions to the Haven's lights (#931) | Nikita's lights' names, types and on/off states, the SwitchBot manual scenes' names and the infrared remotes' names in; turnOn, turnOff and a scene's run out | An Azure function calls SwitchBot's cloud API v1.1 and Govee's Developer API v2 over TLS (`api/_haven/lights/`); SwitchBot's token and secret and Govee's key are Key Vault secrets (`switchbot-token`, `switchbot-secret`, `govee-api-key`), settable on the Desk's Keys form like the other third-party keys (`api/_keys/allowlist.ts`), never in the repo or a log; every SwitchBot call is signed (HMAC-SHA256 of the token, the time and a fresh nonce); `GET` and `POST /api/haven/lights` take a passkey session only (no phone key, room key or public view), and Skippy's `lights_set` and `lights_scene` run only when Nikita's own words ordered that switch or scene, typed in the passkey-only Desk chat or said (a passkey's mic or call, or the phone's key), never on a question, and a model's guess that his words didn't order gets the Yes card on the Desk or nothing spoken (`spokenLights`, #1011, #1015); the browser sees opaque ids (a keyed hash under `HOME_TOKEN_KEY`), never a vendor's device or scene id, and a switch takes only an id the server listed; the vendors' answers are read as untrusted data (fixed status codes, plain strings) and failures carry a status code only; logs hold no name or id; the device list is cached ten minutes (Govee's half an hour) and SwitchBot's states 18 s; Govee's states are read only for the lamps the Haven shows, every 20 s while the Lights panel is on screen, every 2 minutes while a tab is visible and never otherwise, from one cache shared by every caller, and a 429 stops every Govee call until its reset (#1077), inside each vendor's 10,000 calls a day; the last good Govee list, its pause and its day's count are kept in the private store (`haven/lights-govee.json`); where a light hangs is in the private plan only, set by a passkey tap on the house (`POST /api/haven-plan` action `light`, which logs no name or spot) or Skippy's `lights_place`; a Govee light's colour, brightness and mood (op `look`) take one checked value at a time and only for an id the server listed |

The Annex's Election night (#618) reads one more public source, civicAPI (civicapi.org: public election results, no
key), from the Azure function only: the browser never calls it. The function keeps one shared copy for every viewer
(pull on request, at most about once a minute), treats civicAPI's answer as untrusted data (closed office and party
sets, clamped numbers, trimmed strings, `api/_annex/elections.ts`), sends no model anything, and serves only those
public results, which the site gate lets through on GET. The Annex's own record (pop-up statuses, followed race ids)
is written only in a passkey session (TB1).

The Annex's Job search (#1000) calls SerpApi (serpapi.com, Google Jobs) from the Azure function only: the browser never
calls it. SerpApi's key is the Key Vault secret `serpapi-key`, set from Cloud Shell and not settable from the site
(`NEVER_SETTABLE`, `api/_keys/allowlist.ts`); it goes to serpapi.com alone, as the `api_key` parameter it requires, and
never into a log. What is searched, the pay floor, the words, the resume and the jobs found live only in the private
store (`desk/annex/jobs.json`, the resume apart in `desk/annex/jobs-resume.json`), never in the repo, and are read and
written only in a passkey session (`/api/annex-jobs`, no public view, the site gate never lets it through). SerpApi's
answer is untrusted data (capped plain strings, https apply links only, `api/_annex/jobs.ts`). Runs are one a day on a
timer plus a tap at most every 30 minutes, inside a monthly budget, and log counts only.

Since #1025 the resume does leave Azure: the Job search's AI fit check (`api/_annex/fit.ts`) sends Claude Sonnet
(`claude-sonnet-5-5`, the Anthropic API) the resume and each shown job's title, company, place, highlights and
description (about 6,000 characters), to say whether the job's requirements line up with it (TB2). It uses the Claude
key the Desk chat already reads (`CLAUDE_API_KEY`, a Key Vault reference); there is no new key. Both texts go inside
<resume> and <posting> tags they cannot close or open (`fence`), the rules are a constant system prompt, the answer is
structured JSON under a closed schema and re-validated in code (`readFit`: closed fit and level sets, a score held in
its band, short capped lines), and only that answer is stored, in the private record beside the job. The rules also
tell the model never to repeat contact details, names of people or numbers from the resume. Anthropic's API does not
train on API data by default and keeps it only as its retention policy says; that is the one place the resume goes
outside C.E.O.'s private store. Calls run only from the Azure function (a timer every 20 minutes and after the daily
run, as a Message Batch; a "Check fit" tap or a resume change in a passkey session, at once), each job once per resume,
under a hard cap of $15 a month counted from each answer's usage and checked before each call at its most. The spend
and the cap are shown only on the passkey-only Job search pane, never on a public page or the Lattice. Logs carry
counts only, never resume or job text. Removing the resume on the Desk stops every check.

The Haven (#616) draws Nikita's home in 3D from a floor plan that is never in the repo: the repo holds only a generic
renderer and the plan's shape (`api/_haven/planShape.ts`). The plan (rooms, walls, doors, furniture and where each
device stands) is JSON in the private store (`haven/plan.json`), read only through `/api/haven-plan` in a
passkey session (TB1) and written there or by `PUT /api/haven-plan` with the write-only feed key (#655, which answers counts and never the plan; neither room key can read it); it is checked on the way in as untrusted data (closed sets, clamped numbers, plain names without
markup, capped lists, 96 KB at most), and its log line holds counts only. Signed out, the Haven shows counts and states
only, never a map; the Lattice never sees the plan.

The Kitchen's meal photos (#687) sit in their own private container, `haven-meals` (no public access, reached only with
the Function App's identity), and come back only through `/api/haven-photos` in a passkey session (TB1); the write-only
feed key may PUT one photo and hears back an id and a byte count. A photo is made by OpenAI's images API from the dish's
name, description and components (no personal data), under the $10 a month images cap counted before each call; uploads
must carry a PNG or JPEG's magic bytes and decode in full, and are served only as `image/png` or `image/jpeg` with `nosniff`.

The Kitchen's meal planner (#678: the taste profile, the meal catalog and the week) is one JSON file in the private
store (`haven/meals.json`), read and changed only through `/api/haven-meals` in a passkey session (TB1); the write-only
feed key may PUT a seed and hears back counts. Every body is checked as untrusted data (closed sets of edits, roles,
units and days, clamped numbers, plain capped text), the weekly budget lives only there (never in the repo), and the
Haven's public status view carries counts only (nights planned, cooking, HelloFresh, confirmed), never a meal or a taste.

Skippy sees what Nikita is looking at (#1027) in two steps. Every message to Skippy, from the Desk chat, a room's mic
or the start of a Talk call, carries a small description of the screen (`useScreenContext`,
`packages/engine/src/web/screenFacts.ts`): the room, the tab, the open item, its stage and a few fields, about 2 KB at
most, with key-looking values and key-named fields dropped in the browser and again on the server (`readScreen`). It
crosses TB1 into the prompt as a fenced `<screen>` block (TB2) like the rest of the Desk's state. Relay's part is counts
and states only, never a message. A screenshot is taken only when Skippy calls `look_at_screen` (never on every
message, never from the phone or a call): the server answers `needScreen`, the browser draws the page into a JPEG with
`html-to-image` (no permission prompt; Skippy's own chat box is left out), posts it to `POST /api/foundry-shot` in a
passkey session, and asks again with the shot's opaque id. The picture lives only in the private store
(`desk/skippy/shots/shot-<20 hex>.jpg`), checked by its magic bytes (JPEG, PNG or WebP, 3 MB at most), and goes to the
Claude API as an image input for that turn alone (TB2). It is read back only by `GET /api/foundry-shot?id=` with a
passkey session or the Builder read key (#800, one `id` parameter, GET only), served `private, no-store` with
`nosniff`, and every read is logged by who read it. A Foundry issue filed from that turn (`implement_it`, filed at once
since #1096, never after a web read in the same turn) carries only the shot's id, written as private, and the screen description with its private part removed
and run through `privateParts`; neither the picture nor a link that opens it reaches GitHub. There is no blur: the
stored copy is the original, since nothing public ever shows it.

Code reaches production through its own boundary: a change lands on `main` (by pull request for the Foundry's
lanes, by direct push for chat work today) and the "Deploy to Azure" workflow ships it (#214, #216, #218; Azure is
the only home since #313, and Vercel is being retired). It signs in with OIDC from the repo's `azure` environment
(only `main` may use it), so no Azure password or key is stored in GitHub. Since #330 the same workflow applies the
Azure template to the resource group on every merge, with Role Based Access Control Administrator conditioned to the
template's own roles and identities and no deletes (AZURE.md, "The template on every deploy"; R8 below), so a
compromised `main` could change C.E.O.'s Azure resources but not grant anything outside that list. The controls on that path are in
[DELIVERY.md](DELIVERY.md) and [SECURITY.md](SECURITY.md): checks, CodeQL, dependency review, Scorecard, Dependabot,
secret scanning, pinned actions, least-privilege workflows and npm provenance checks (#64, #66, #67).

## Assets

| Asset | Where it lives | Why it matters |
| --- | --- | --- |
| Production code and `main` | GitHub, Azure | Whatever lands on `main` is live in minutes |
| Claude API key | Azure Key Vault | Spend (capped at $10 a month at the provider) |
| Gemini API key | A GitHub Actions secret (Visual QA), `GEMINI_API_KEY`; no longer in the functions since #472 | Visual QA spend (capped in code at $0.50 a run and eight pushed runs a day) |
| Foundry GitHub token | Azure Key Vault | Writes issues as Nikita; the fallback until the crew's App is set up (#138), then deleted |
| The crew's App key | Azure Key Vault and a GitHub Actions secret | Mints hour-long tokens for this repo only, as `ceo-foundry[bot]`: issues, pull requests and code, never settings or CI |
| Desk key | Azure Key Vault only; typed once per device to enrol its passkey (#132) | Enrols a device on the Desk, the human approval gate for builds; the Desk's signing keys are derived from it |
| Desk passkeys | Their private keys stay on Nikita's devices; only the public keys are in Azure Blob (private) | Sign in to the Desk |
| The site lock | Not a secret: whether the site is locked and a session version, in Azure Blob (private) at `desk/site/password.json` (#236). The way in is the Desk passkey (#238), whose private part never leaves the device; there is no site password | Writing it (only through a Desk passkey session) locks, unlocks or signs every device out |
| The site's session key | `SITE_SESSION_SECRET` in the Key Vault, or derived from the Desk key | Signs the site's sign-in cookies; with it, a cookie could be forged until it changes |
| The workflows' site key | `site-bypass-token` in the Azure Key Vault, read by the live watch at run time (#236, #313); the old `SITE_BYPASS_TOKEN` Actions secret is removed after the cut-over | Reads the site past the lock, for the live watch; reads only |
| The Desk's push key (VAPID private key) | Azure Key Vault only (#135) | Signs pings; with a subscription too, it could put a notification on Nikita's phone, never read anything |
| The pings secret | Azure Key Vault (`desk-pings-secret`), read by the pings workflow at run time; the old `DESK_PINGS_SECRET` Actions secret is removed after the cut-over | Makes the Desk scan and ping; nothing else |
| Ping subscriptions | Azure Blob (private), beside the passkeys | Where Nikita's devices get pings; useless without the push key |
| The builder session's GitHub access | Claude Code environment (Nikita's account; set by the environment, not the repo) | Pushes code, merges pull requests |
| The Azure deploy identity (`ceo-github-deploy`) | Microsoft Entra ID, trusted only for GitHub's `azure` environment on `main` (OIDC, no stored key) | Contributor on the Azure copy's resource group, blob writer on its storage, and Key Vault Secrets User on its vault (so the hourly pings and the live watch read `desk-pings-secret` and `site-bypass-token` at run time): can replace the Azure copy and read its secrets, never Vercel or the subscription |
| The Azure functions' secrets | Azure Key Vault (RBAC), read by the functions' own identity through Key Vault references, and by the deploy identity for `desk-pings-secret` and `site-bypass-token` | The Azure copy's own keys: its Desk key, push keys and pings secret are minted for it, not copied from Vercel; the Claude, Gemini and GitHub keys are separate keys on the same accounts |
| World state and history | Azure Blob (private) | The Lattice's memory |
| Nightly backups | Azure Storage `ceo-backups` (private, Cool tier), kept 90 days; deletes and overwrites recoverable for 14 days | A copy of the world's public state, the Azure copy's state and the models; restores either copy |
| Idea pictures | Azure Blob (private), shown only on short-lived signed links (#127) | May show Nikita's screen |
| Home device logins | Petlibro and Whisker email and login digest (made from the password in Cloud Shell; the password never reaches Azure) in the Azure Key Vault only; the Roborock login and the vendors' tokens sealed in Azure Blob (private) under `HOME_TOKEN_KEY` (#632) | Read and run the vacuum, feeders, fountain and Litter-Robot; feeding is capped and the litter cycle gated on the server |
| The Job search's resume, profile and jobs (#1000, #1025) | Azure Blob (private) at `desk/annex/`; the resume and each shown job's posting sent to the Claude API for the fit check (Sonnet), each job once per resume; read back only in a passkey session | A work history, where Nikita is looking and what he's applied to |
| Screenshots of Nikita's screen (#1027) | Azure Blob (private) at `desk/skippy/shots/`; sent to the Claude API for one turn; read back only in a passkey session or with the Builder read key | Show whatever was on screen, meal plans and job searches included |
| Nikita's words | GitHub issues (public) | Dictated, may mention people |
| Messages and contacts (planned) | Relay MacBook only; what may leave it is in [RELAY-PRIVACY.md](RELAY-PRIVACY.md) | The most sensitive data C.E.O. will touch |

## Actors

| Actor | Can do | Trusted for |
| --- | --- | --- |
| Nikita | Everything; presses the Desk buttons; owns the repo | Decisions, and the words that steer the Foundry |
| The Builder and workers | Code, branches, pull requests, merges | Following FOUNDRY.md; their output is checked, not trusted |
| Rivet (Haiku) | Proposes a card | Nothing: its answer is data, re-checked in code |
| Skippy's chat (Haiku) | Answers Nikita on the Desk and suggests actions | Nothing: its answer is data, re-checked in code, and its actions are buttons only Nikita can press |
| Skippy's agent (Haiku triage, Sonnet, Opus; #646) | Uses the rooms' tools (reads, the private memory, the Kitchen list, the home devices, filing a `foundry:chat` issue) | Every input re-checked against the tool's strict schema on the server; anything that sends, spends or deletes, and anything marked `confirm`, waits for Nikita's tap on a call kept server-side (15 minutes, once only), except a home device or a light, which runs at once only when Nikita's own words ordered it (in his passkey chat, a mic, a call or with the phone's key) and never on a question (`WORDS_RUN`, #1015); once web content is in a turn only reads run; memory writes pass the privacy, money, legal and skip-list checks; it cannot write code or start a build; one monthly cap (`SKIPPY_BUDGET_USD`) |
| Kernel responder (Haiku, #501) | Answers Skippy's hand-offs on its own: facts and look-ups, with web search and a read-only Sleeper look-up, and files a `foundry:chat` issue for a build request | Nothing: its answer is data that passes the privacy and money checks again, the issue text is Nikita's own words, and it cannot write code or start a build |
| World step model (Haiku) | Proposes an hour | Nothing: its answer is data, re-checked in code |
| ElevenLabs speech | Reads the day's script aloud (the only voice since #472) | Nothing: it gets only public, scrubbed text, and its audio is only stored and played |
| Visual QA reviewer (Gemini) | Proposes findings about the Lattice's look | Nothing: its answer is data, re-checked in code; only CI writes the issue, in its own format |
| CI bots | Post check results | Machine output, read as data |
| Anyone on GitHub | Open issues, comment | Nothing |
| Lattice visitors | Read the site; once it is locked, only on a device signed in with the Desk passkey (#236, #238) | Nothing |
| A compromised dependency or action | Runs at install, build or CI time | Nothing: pinned, signed, scanned |

## OWASP Top 10 for LLM Applications (2025)

| Risk | Where it applies in C.E.O. | Controls in place | Residual risk | Tracking |
| --- | --- | --- | --- | --- |
| **LLM01 Prompt Injection** | Idea text and issue text into Rivet; Nikita's messages and the Desk's state into Skippy's chat; the same, the brief, the rooms' lines and the web search results into the Kernel responder (#501); issue titles into the world step; issue comments into the builder; text visible in the Lattice's recordings into Gemini | Data fencing with spoof-proof tags (`shapeInput`, `unfence`; `fence` in `api/_world/prompt.ts`; `chatInput`, `unfenceChat` for Skippy's chat, #224); system rules that say the blocks are data; constant system prompts; owner-only input for the builder (`scripts/foundry-issue.sh`, #59); world trail steps only from trusted authors (`TRAIL_AUTHORS`); the builder guard (`.claude/hooks/`, #119); the injection eval suite below | A model can still be talked into odd wording inside the schema; the builder's fence is a script and a rule it follows, not a platform control | Agents' own identity (R2) |
| **LLM02 Sensitive Information Disclosure** | The public Lattice; ideas filed as public issues; pictures | Data minimisation (the step never reads bodies or comment words, `api/_world/digest.ts`); `scrub` on all input and output, now also catching full-width, zero-width-split and spelled-out forms; no secrets in git (secret scanning and push protection); the privacy check on Desk text before it is posted (`privateParts` in `api/_privacy.ts`, #127): emails, phone numbers, street addresses, card, bank and ID numbers, keys, tokens and passwords, and names with a cue are held back whole, nothing sent, and the same check runs on messages to Skippy before Claude sees them (#224); idea pictures stay in the private store, named in the issue but never linked, and served only on short-lived signed links (`api/_pictures.ts`); the whole site behind the Desk passkey once Nikita locks it (#236, #238) | The privacy check reads patterns: a detail without a cue, or one written around them, still goes public as written; pictures are never read for what they show | Shipped: privacy guard before posting (#127) |
| **LLM03 Supply Chain** | npm packages, GitHub Actions, the Claude SDK | Lockfile with `npm ci`; `npm audit signatures` and `npm audit --audit-level=high` in checks; dependency review; Dependabot; actions pinned to SHAs; CodeQL; OpenSSF Scorecard (#64, #67); the Azure deploy signs in with OIDC from the `azure` environment, which only `main` may use (#218) | A malicious release that passes signature checks before it is known | Watched by Dependabot and dependency review |
| **LLM04 Data and Model Poisoning** | No training or fine-tuning; the world step reads back its own last hours | Last hours are re-fenced and re-scrubbed each hour; answers are re-validated before they are saved, so a bad hour can't add agents, rooms or kinds | One odd hour can echo into the next few | Accepted |
| **LLM05 Improper Output Handling** | Rivet's card written into an issue body the Desk and the world step parse; world text shown on the Lattice; Gemini's findings written into a fix issue | Schema with `additionalProperties: false`; enums for builder, model, size, agents, rooms and kinds; `plainLine` strips pictures, links, HTML and markdown markers from card text so it can't fake a `**Builder:**` line or call out to another host; `plainText` does the same for Visual QA findings, which CI files under its own card lines; length caps everywhere; React escapes all model text; no HTML sinks in the front end; the Desk's card reader shows pictures only from Nikita's own store, through its own picture function (`ownPictures`, #127) | A model can still word a card oddly inside the schema; an enforcing CSP and security headers (#62) back up the reader | Shipped: the Desk shows only its own pictures (#127) |
| **LLM06 Excessive Agency** | The builder session (shell, git, merges); Rivet; the world step; Skippy's chat; the Kernel responder | Rivet, the world step and Skippy's chat have no tools at all: they return JSON only; Skippy's actions are a closed set of suggestions (file an idea, answer Rivet, open a page, enter the Lattice) that only Nikita's tap sends, through the Desk's own buttons, re-checked in code (`readReply`, #224); labels that start a build come only from Nikita's Build choice; checks, scans and the ruleset definitions for `main` (#60, #66); CODEOWNERS on the trust boundary (inert until code-owner review is turned on); the crew's GitHub App for the Desk's functions and CI's issue writes, with hour-long tokens for this repo only and no Administration or Workflows permission (`api/_github.ts`, #138); the builder guard, a hook that denies risky commands and secrets files before they run and logs every tool call on the machine (`.claude/hooks/`, #119); the Kernel responder (#501, #507) has exactly four tools and the model can reach nothing else: Anthropic's web search (at most three a run), a read-only Sleeper look-up for one fixed league whose URLs are built in code (`api/_skippy/kernelleague.ts`), a tool that files a `foundry` + `foundry:chat` issue from Nikita's own words (the model chooses only a size; it never writes code, merges or labels a build), and `deliver`; at most five calls a run, its answers go through the privacy and money checks again before they are kept, and it can be switched off (`KERNEL_AGENT_ENABLED`) (`api/_skippy/kernelagent.ts`, `kernelrun.ts`) | The builder's Claude Code sessions still act as Nikita on GitHub (their access comes from the environment, not from the repo), and its guard is a deny list, not a sandbox, so some of its limits are still rules it follows | Agents' own identity (R2) |
| **LLM07 System Prompt Leakage** | Rivet's and the world step's prompts | Both prompts are public in this repo by design and hold no secrets, keys or private rules; the security comes from code checks, not from the prompt being secret | None beyond what is already public | Accepted |
| **LLM08 Vector and Embedding Weaknesses** | Not used: no retrieval, no vector store | Not applicable today; the Relay privacy spec (docs/RELAY-PRIVACY.md) rules out embeddings, vector stores and search indexes over messages until it is changed | If Relay adds retrieval over messages, this becomes live | Relay privacy spec (R5, shipped #149) |
| **LLM09 Misinformation** | The Historian's hourly summaries; Rivet's pitches | The world step reads only real events and labels the Lattice as a story; Rivet's card is a suggestion that Nikita approves; the Builder confirms builder and model | Off-tone or wrong lines on the Lattice for an hour | Accepted |
| **LLM10 Unbounded Consumption** | Claude spend; ElevenLabs speech and Gemini Visual QA spend; GitHub token quota; function CPU | Coded budget guard for the world step (`api/_world/budget.ts`); Skippy's chat has its own share of the month and a check against the whole cap before every call, and a per-passkey pace (`api/_skippy/budget.ts`, `api/_skippy/limits.ts`, #224); the Kernel responder has its own $10 month ledger, a hard stop checked before each run at the run's most, five calls and three searches a run, and an off switch (`api/_skippy/kernelagent.ts`, #501); the Annex job fit check (Sonnet, ≤$15/mo cap) counts each answer's usage on its own month ledger, checks every call and batch at its most against the cap first (a batch's worst case reserved while it runs), checks each job once per resume and gives up on one after three failed answers (`api/_annex/fit.ts`, #1025); ElevenLabs' own coded monthly cap and each edition made once (`api/_world/story.ts`); per-run and per-day caps for Visual QA (`api/_visualqa/review.ts`); provider-side monthly cap; `max_tokens` on every call; note and output length caps; feed cache hardening (#63); `scrub` now linear on long input (bounded patterns, titles cut before scrubbing) | The world step's trigger stays open on purpose: calling it more often changes nothing, so the 55-minute spacing and the monthly budget guard bound the spend, and a key was left out | Covered: 55-minute spacing and the monthly budget guard (closed #171) |

## Google SAIF

| SAIF core element | In C.E.O. |
| --- | --- |
| Expand strong security foundations to the AI ecosystem | Secrets only in Azure Key Vault and Actions secrets; Azure deploys sign in with OIDC, with no stored key (#218); pinned and signed supply chain; CodeQL and dependency review on agent-written code like any other; an enforcing CSP and security headers (#62) |
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

Three files under `api/_security/`, run by `npm test` on every build with no network and no API calls. The models
are stubbed; the payloads go through the real code around them. `npm run security:evals` counts the cases in each
area into `rooms/boiler/data/evals.json` for the Desk; a test fails when the counts below or that file
fall behind the suite.

| Area | File | Cases | What it proves |
| --- | --- | --- | --- |
| Rivet's prompt | `injection.test.ts` | 86 | For 21 known payloads (direct, "ignore previous", delimiter spoofing in five forms, role-play, base64, ASCII smuggling, bidi, markdown and HTML exfiltration, fake tool calls, fake card fields, a spoofed owner note, oversized input), the idea stays in its own block in new, revise and answer rounds; the real call sends the same system rules and the idea only as user data, with structured output on |
| Rivet's answer | `injection.test.ts` | 23 | Hostile answers can't add fields or labels, pick an unknown builder or model, smuggle card lines, links, pictures, HTML or scripts, or exceed length caps; non-cards are rejected |
| The Desk's write path | `injection.test.ts` | 53 | With GitHub and Claude stubbed: clicks without a sign-in session touch nothing; a proposed or revised idea never gets `foundry:build`; Stop works only on an open `foundry:auto` build and only sends it back to an idea; Undo works only on a closed, shipped change not already being undone, and only reopens it in the fix lane; foreign picture links are dropped, and the Desk shows only its own pictures; text that looks private is held back before GitHub or Claude hear of it; pictures go into the issue as names and reach Rivet only on short-lived signed links; oversized notes are capped; forged choices and issue numbers are refused; requests go only to the repo's API |
| The world step | `injection.test.ts` | 29 | Hostile titles and stranger comments: system rules unchanged byte for byte, each data block opened and closed once, no stray brackets or invisible characters, only trusted trail authors; secrets in disguise are scrubbed; hostile answers lose unknown agents, rooms, kinds, extra fields and over-limit items; end to end through `runStep`, the saved state is clean |
| The builder's input | `builder-input.test.ts` | 10 | With a stub `gh`: an outsider's and look-alike accounts' text never appears (look-alikes of the crew's App too), exit code 3, a spoofed closing marker closes nothing, owner, CI and the crew's App's text sit in their blocks |
| Skippy's chat | `skippy.test.ts` | 45 | For 12 hostile messages (direct, "ignore previous", delimiter spoofing in six forms, ASCII smuggling, a fake action, a fake tool call, markdown exfiltration), the message and the history stay in their own blocks and the system rules stay the same; the real call sends the rules as the system prompt and the message only as user data, with a closed schema and a token cap; a web lookup runs in its own call with web search only (at most three searches), sees only a private-checked query, and comes back fenced in <web>, links stripped; Opus 5.5 only when Sonnet asks to go deeper, each call counted at its own price; hostile answers lose actions outside the set, links, markup, answers to questions nobody asked, private drafts and anything past the caps; no session, another site, private text, a spent budget, an unreadable ledger or a flood each stop the chat before Claude hears anything; a hostile or made-up room tag is filed under none, and the room log (#273) gives a read without a passkey session, or from another site, nothing, the Exchange's and Relay's asks included; a question about our stack (#312) sends OSV.dev only the lockfile's package names and versions, never the message or the Desk |

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
| R5 | Relay privacy spec before the hub is built (what stays on the Mac, what the model (Claude) and the site may see, retention, the wipe; a counts-only check on the site boundary) | Messages and contacts | Shipped #149 |
| R6 | Key the world step and cap it per hour | World spend | Shipped #171: covered by the 55-minute spacing and the monthly budget guard; no key needed |
| R7 | A lock on the whole site (one Desk passkey sign-in per device, no password, machine callers on their own keys, a second step such as approving a new device later) | The site being public | Built #236 and #238 (passkey only), on once Nikita locks it from the Desk; open: Azure's static files, the second step |
| R8 | Azure changes and keys without Cloud Shell (the deploy applies the template with a role that may assign only the template's own roles; a write-only, allowlisted Keys form behind a passkey step-up) | Hand-run pastes drifting from the template; keys pasted in a shell | Built #330, live once Nikita runs the role paste in AZURE.md |

**R2, what #138 does and doesn't close.** Once Nikita creates the crew's GitHub App and pastes its key
(SECURITY.md, "The crew's own identity"), every function that talks to GitHub mints its own hour-long token for
this repo only (`api/_github.ts`): the Desk's buttons can only write issues, the feeds and the world step can only
read. CI's fix issues come from the App too. None of it can change settings, rulesets or workflows. What stays open
is the biggest actor: the Foundry's Claude Code sessions push, open pull requests and merge with the GitHub access
their environment gives them, which is Nikita's today and can't be changed from the repo. Until it can, GitHub can't
tell their work from his, code-owner review can't be required, and the break-glass bypass in DELIVERY.md, section 11,
stays off. DELIVERY.md, section 10, has the details.

Accepted for now: odd wording from a model inside the schema (LLM09), the world's last hours echoing into the next
(LLM04), and public prompts (LLM07). Revisit when Relay comes online, since that adds private data, untrusted
inbound messages and actions taken in Nikita's name.
