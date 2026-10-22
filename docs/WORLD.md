# The living Lattice

The Lattice keeps living when Nikita isn't looking (issue #41). It doesn't run in real time on a server: once an
hour the world takes one **step**, which writes that hour's history and saves the world. When Nikita opens the
Lattice the agents pick up where they left off, and the Desk's **Chronicle** has everything that happened meanwhile.

## The hourly step

- **Trigger:** `.github/workflows/world-step.yml` runs at :05 every hour (GitHub Actions, free) and POSTs to
  `https://command-everything-obviously.vercel.app/api/world-step`. No secret: the step is idempotent per hour.
  GitHub's schedule is best-effort (on 2026-10-13 it didn't fire at all for hours), so the Builder's doorbell
  (`scripts/foundry-watch.sh`) also POSTs every ten minutes while it runs; the extra calls do nothing until the hour is up.
- **Idempotent:** if the last step is under 55 minutes old, the call changes nothing and spends nothing, and
  returns the saved hour (`{ stepped: false, entry, nextAt }`). Two calls racing for the same hour can't both land:
  the state is saved with an ETag check (Blob `ifMatch`), and the loser gets a 409 and writes no history.
- **What it reads:** the world's saved state (relationships, the last 24 hours) and a digest of the hour's real
  events from GitHub: Foundry jobs shipped and started, ideas and decisions on the Desk, the checks on main
  (`api/_world/digest.ts`). Only Foundry issues, and only their titles, numbers and the kind of each trail step,
  never an issue body or a comment's words. Trail steps count only from Nikita's account and the Checks bot, since
  anyone can comment on the public repo, and the hour's input reaches Claude inside tagged data blocks
  (docs/THREAT-MODEL.md).
- **One Claude call for the whole Lattice** (`api/_world/claude.ts`): Claude Haiku (`claude-haiku-5-5`, the same
  `CLAUDE_API_KEY` as idea shaping), structured JSON out. The rules and the cast are the static part of the prompt,
  cached for an hour; the hour's relationships, last hours and events follow. It returns:
  - `summary`: the hour, in the Historian's voice;
  - `scenes`: two to four short conversations in different rooms;
  - `changes`: zero to two relationship changes;
  - `remarks`: one in-character line from the builder of each job that shipped that hour (shown next to the job on
    the Foundry tab's Changelog, and said aloud in the Lattice);
  - `recap`: the **day in Ilyr**, only on the first step after midnight Mountain time, for the day that ended.
  The answer is checked before it touches the world (`readAnswer` in `api/_world/prompt.ts`): unknown agents, rooms
  and kinds are dropped, everything is trimmed and scrubbed.
- **The one limit is sensitive information.** Agents may talk about anything, code and real work included. Relay's
  messages, contacts and anyone's personal data never reach the step: it has no way to read them, the digest reads
  only public Foundry titles, and every line in and out goes through `scrub` (emails, phone numbers, card numbers,
  keys, links and amounts are hidden). `api/_world/prompt.test.ts` checks that a feed full of private material
  leaves none of it in the prompt.
- **The cast:** the step runs as a Vercel function and can't load the simulator package, so `npm run world:cast`
  writes the cast it needs into `api/_world/cast.ts` (from `packages/simulator/src/worldCast.ts`). A test fails when
  that file falls behind the cast: run the script after changing an agent, a relationship or their quips.

## The budget guard

The Claude API is capped at **$10 a month** for C.E.O., shared by idea shaping and the world. Each step's cost is
computed from its own token use, as idea shaping does it (`costOf` in `api/foundry.ts`, plus 2x input for the
1-hour cache writes), and added to a month total in the saved state (`api/_world/budget.ts`).

- A step costs about **$0.002** (about 10k tokens in, 1k out at $0.10 / $0.50 per million): about **$1.50 a
  month** hourly.
- The world stops calling Claude once the month's world spend plus one step at its most ($0.0095) would pass
  **$6** (`WORLD_BUDGET_USD`, never above $10), which leaves $4 for idea shaping, whose calls cost a fraction of a
  cent each. Past that, and whenever there is no key or Claude doesn't answer usably, the hour is written from the
  agents' own scripted lines (`api/_world/scripted.ts`, from `quips.ts`), for free. The total resets when the month
  turns (UTC, as the API bills).
- Skippy's chat on the Desk (#224) has its own share, **$1** by default (`SKIPPY_BUDGET_USD`), kept in its own
  ledger (`desk/skippy/spend.json`, `api/_skippy/budget.ts`). Before every call it checks both its share and the
  whole month: the world's spend plus the chat's plus one call must stay under $10 less $2 kept for idea shaping.
  Past that Skippy answers with a scripted line until the month turns.
- The Desk's **Usage** panel shows the world's spend this month, how many hours Claude wrote and how many were
  scripted, and counts it against the shared cap meter.

## The day's story

Once a day's recap is filed, **the Historian reads the day's update aloud** (issue #95, made livelier in #102, a
normal voice in #107): a short "today in Ilyr" in 30 to 45 seconds, one clear speaker, not a podcast and not two hosts.
`api/_world/story.ts`.

- **Trigger:** the step that writes a recap (the first after midnight Mountain) makes that day's story after it has
  answered (`waitUntil` in `api/world-step.ts`), so the step stays fast. The Chronicle also has **Make it now** for
  today or yesterday (`POST /api/day-story` in the Desk's passkey session, #132): yesterday when its recap
  is filed and it has no story yet, else **the day so far**. Each day gets at most two: one "so far" from the Desk,
  and the recap's, which replaces it. Each is made once (a claim in the store, so a second call, or two racing,
  spends nothing).
- **Style versions:** each story carries the style it was made with (`STORY_STYLE`, now 3; the first, slow Gacrux
  stories of #95 carry none and count as 1). A story in an older style shows on the Chronicle with **Make it now**,
  which remakes it once in the current style: still Desk-key gated, still inside `GEMINI_BUDGET_USD`, and the claims
  carry the version (`world/stories/<day>.<kind>.v3.claim`), so each style is paid for at most once per day and kind,
  and two racing remakes spend once. The world step never remakes an old story by itself.
- **The script:** Claude Haiku (the world's model and key, plain text out, about a tenth of a cent) writes 70 to 120
  words, 30 to 45 seconds aloud, from the day's Chronicle page only: the recap, each hour's summary, the real Foundry
  events (what shipped and who built it) and the builders' remarks. Its shape: a one-line hook ("Today in Ilyr..."),
  the two to four biggest things that shipped or happened and who built them, one bit of character colour, a quick
  sign-off. Those lines were scrubbed when the step wrote them; they reach Claude fenced in tagged blocks, and the
  script is scrubbed again, stripped of markup and bracketed cues, and capped at 140 words on a sentence
  (`cleanScript`). Without a Claude key, or when it doesn't answer, the script is put together from the Chronicle's
  own lines in the same shape (`chronicleScript`: the hook, the recap's first sentence, the top three builds, one
  remark, the sign-off). Never a demo: no key, no audio.
- **The speech:** Gemini's text to speech over plain `fetch` (no SDK): `gemini-3.8-flash-tts`, the prebuilt voice
  **Achird** ("Friendly": an ordinary, clear speaker, the way a colleague reads out a short update), with a short
  style note: a friendly, natural speaker reading a short daily update, clear and conversational, at a normal pace.
  The API has no speaking-rate setting; Google's guide steers pace through the style note, so that is where the pace
  is set. It asks for raw 16-bit mono PCM (`audio/l16`) at **24 kHz**, Gemini's native rate, and wraps it as WAV (48
  KB a second, a 45-second story about 2.2 MB). Headerless PCM carries no rate, so the rate is taken from what the
  response says: the audio block's `sample_rate`, a `rate=` in its mime type, or a RIFF header, else 24 kHz. Until
  #107 it was asked for and labelled as 16 kHz; if Gemini sent 24 kHz anyway, that plays at two-thirds speed and a
  fifth lower, which is the deep, slow, distorted voice heard on Gacrux (#95) and Puck (#102). Sources are in the
  file's header: Google's speech generation guide, the Interactions API reference and the pricing page.
- **The budget:** $0.50 per million text tokens in and $9.00 per million audio tokens out (25 a second) through
  2026, then $1.00 and $18.00: a 40-second story is about 1,000 audio tokens, about a cent (two from 2027). Gemini
  has its **own cap**, `GEMINI_BUDGET_USD` (default **$5**, never above $10), kept in `world/stories/spend.json`; no
  story is started once one more at its most (a long prompt and two minutes of audio, about three cents) could pass
  it. The script's Claude cost is kept beside it and counted in the shared Claude cap on the Usage panel, where
  Gemini's spend shows next to the world's.
- **Kept and served:** `world/stories/<day>.json` (the script, its length, model, voice and style, what it cost) and
  `world/stories/<day>.wav` in the private Blob store. `GET /api/day-story?day=…` answers the transcript and the
  audio's link, with `stale` for an older style (or why there is none: `no-key`, `over-budget`, `not-yet`);
  `&audio=1` serves the WAV from our own origin (the CSP's `media-src` is `'self'`), cached at the edge, versioned by
  when it was made.
- **Where it shows:** on the Chronicle's day pages, "Hear the day in Ilyr" with its length, a native player and the
  transcript (collapsed); on Today, yesterday's under "In Ilyr" once it is made.

## The storage layer

`api/_world/store.ts` is one small interface: `loadState`, `saveState`, `appendHistory`, `putRecap`, `readDay`.
`WORLD_STORE` picks the store:

- `blob` (default): the project's **private Vercel Blob** store, signed in with Vercel's OIDC token the same way as
  the idea pictures (no key in the code). `world/state.json` holds the state; `world/days/<day>.json` holds each
  day's hours and recap. About two writes a step, about 1,500 a month.
- `supabase`: C.E.O.'s own Supabase project, once it is connected. A skeleton for now, with the tables written out
  in its comment. To switch: build the methods, set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, copy the days
  listed in the state across, and set `WORLD_STORE=supabase`.
- `memory`: tests and local runs.

## Where it shows

- **The Lattice** (`apps/world/src/world/WorldDirector.tsx`) loads the latest state on open: relationships the world
  changed are taken on (the Agent Studio and dossiers show them), the PA pins "While you were away: …" as one calm
  line (two lines at most, the full text in Signals) with a Read button until you read it, other announcements showing
  after it; once read, that step's line doesn't pin again (`apps/world/src/kernel/catchup.ts`). The latest
  hour's conversations and builders' remarks play out as speech bubbles, speakers facing each other.
- **The Desk's Chronicle** (`/chronicle`, `apps/world/src/desk/Chronicle.tsx`): the hours since you were last here,
  then a page per day (newest first) with the day in Ilyr, each hour's summary, real events, scenes, remarks and
  relationship changes, and how everyone stands now.
- **Today**: "In Ilyr" under While you were away, with a link to the Chronicle.
- **The Foundry tab**: builders' remarks under their jobs on the Changelog; the world's spend on the Usage panel.
- **The world clock** (issue #53): on the Desk's **Systems** page (`apps/world/src/desk/WorldClockPanel.tsx`) and as
  the last pipe in the Lattice's **Boiler Room**. When the last hour ran, when the next is due, Claude or scripted,
  and this month's world spend against its $6 share. `apps/world/src/worldClock.ts` polls `GET /api/world-step`
  every minute while the tab is showing: working while the last step is under 70 minutes old, slow (amber, the pipe
  coughs) once an hour is overdue, down (the pipe bursts) past three hours or when the endpoint doesn't answer.

## Reading it

- `GET /api/world` → the feed (state, the last 12 hours, the day index, remarks, this month's spend, and the day's
  story's Gemini spend as `story`), cached at the edge for five minutes.
- `GET /api/day-story?day=2026-10-13` → the day's story (transcript and audio link) or why there is none;
  `&audio=1` → the WAV. `POST { day? }` → make today's or yesterday's now (signed in on the Desk).
- `GET /api/world?day=2026-10-13` → one day's page.
- `GET /api/world-step` → the world clock, without running a step: `{ at, step, nextAt, store, claude, source,
  spend: { month, usd, budget, calls, scripted } }` (`api/_world/clock.ts`), never cached. Only times, counts and
  dollars. `POST` runs one (if due).
