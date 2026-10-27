# The living Lattice

The Lattice keeps living when Nikita isn't looking (issue #41). It doesn't run in real time on a server: once an
hour the world takes one **step**, which writes that hour's history and saves the world. When Nikita opens the
Lattice the agents pick up where they left off, and the Desk's **Chronicle** has everything that happened meanwhile.

## The hourly step

- **Trigger:** the Azure Function App's timer `world_tick` (`azure/src/tick.ts`, #271) runs at :05 and :35 every
  hour: it steps the world in-process (Azure is the only home since #313; the old knock on Vercel's step is off, and
  `WORLD_TICK_VERCEL=on` would bring it back while the adapter stays). No secret: the step is idempotent per hour,
  and the site gate lets a POST to `/api/world-step` through. `.github/workflows/world-step.yml` still knocks at :05
  on the Azure site (GitHub Actions, free), but
  GitHub's schedule is best-effort (on 2026-10-13 it didn't fire for hours; on 2026-10-21/22 only every four to five
  hours, which left the Boiler Room's world clock DOWN), and the Builder's doorbell (`scripts/foundry-watch.sh`) also
  POSTs to the Azure site every ten minutes while it runs; the extra calls do nothing until the hour is up.
- **Idempotent:** if the last step is under 55 minutes old, the call changes nothing and spends nothing, and
  says when the saved hour was written (`{ stepped: false, at, nextAt }`; never the hour's words, since the site lock
  lets this trigger through, #236). Two calls racing for the same hour can't both land:
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
- **The cast:** the step runs as a bundled function and can't load the simulator package, so `npm run world:cast`
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
- Skippy's chat on the Desk (#224) has its own share, **$2** by default (Claude Sonnet 5.5, Opus 5.5 for the hard ones, web lookups, since #264) (`SKIPPY_BUDGET_USD`), kept in its own
  ledger (`desk/skippy/spend.json`, `api/_skippy/budget.ts`). Before every call it checks both its share and the
  whole month: the world's spend plus the chat's plus one call must stay under $10 less $2 kept for idea shaping.
  Past that Skippy answers with a scripted line until the month turns.
- The Desk's **Usage** panel shows the world's spend this month, how many hours Claude wrote and how many were
  scripted, and counts it against the shared cap meter.

## The day's story

**Skippy, the Magnificent presents "today in Ilyr"** (#365; the Historian read it from #95 to #365, and still writes
the notes): a short update in 30 to 45 seconds, one speaker, not a podcast and not two hosts, made in **editions**
through the day. `api/_world/story.ts`.

- **Editions (#365):** about every five hours the world step makes a fresh **so far** edition of today: at the first
  step after 5 am, 10 am, 3 pm and 8 pm Mountain (editions 1 to 4; `editionAt`), and only when the Chronicle has an
  hour newer than the last edition (else `no-news`, nothing spent). The step that writes a recap (the first after
  midnight Mountain) makes the **final** edition, which replaces the day so far. Both run after the step has answered
  (`waitUntil` in `api/world-step.ts`; on Azure the timer's step waits for them, `settleMs: Infinity`), so the step stays
  fast. About five readings a day. The latest edition is the one kept and served; a "so far" that finishes after the
  final one has landed never covers it. The Chronicle also has **Make it now** for today or yesterday (`POST
  /api/day-story` in the Desk's passkey session, #132): yesterday when its recap is filed and it has no story yet,
  else today's edition for the current 5-hour mark (edition 0 before 5 am).
- **Claims:** each edition is claimed once per day, edition and style (`world/stories/<day>.so-far-<n>.v4.claim`, and
  `<day>.final.v4.claim`), created without overwrite, so a second call, or two runners racing, spends nothing. A claim
  with no story behind it after ten minutes was a call that died and may be taken again; a failed reading gives its
  claim back.
- **Style versions:** each story carries the style it was made with (`STORY_STYLE`, now 4: Skippy's voice, #365; the
  first, slow Gacrux stories of #95 carry none and count as 1). A final story in an older style shows on the
  Chronicle with **Make it now**, which remakes it once in the current style: still Desk-key gated, still inside the
  voice caps, and the claims carry the version, so each style is paid for at most once per day and edition. The world
  step never remakes an old final story by itself; an old "so far" is simply followed by the next edition.
- **The script:** Claude Haiku (the world's model and key, plain text out, about a tenth of a cent) writes 70 to 120
  words, 30 to 45 seconds aloud, from the day's Chronicle page only: the recap, each hour's summary, the real Foundry
  events (what shipped and who built it) and the builders' remarks. Its shape: a one-line hook ("Today in Ilyr..."),
  the two to four biggest things that shipped or happened and who built them, one bit of character colour, a quick
  sign-off. Those lines were scrubbed when the step wrote them; they reach Claude fenced in tagged blocks, and the
  script is scrubbed again, stripped of markup and bracketed cues, and capped at 140 words on a sentence
  (`cleanScript`). Without a Claude key, or when it doesn't answer, the script is put together from the Chronicle's
  own lines in the same shape (`chronicleScript`: the hook, the recap's first sentence, the top three builds, one
  remark, the sign-off). Never a demo: no key, no audio.
- **Skippy's script (#365):** the brief (`STORY_SYSTEM`) is Skippy's: pompous, smug, theatrical, secretly fond of the
  C.E.O., calling the crew "monkeys", one boast and one quip at most, the news first; in Ilyr, legally his own. The
  public rules stay: never personal data, contacts, message contents, money or keys.
- **ElevenLabs, the only voice (#365, #472):** when `ELEVENLABS_API_KEY` is set (on Azure from the Key Vault secret
  `elevenlabs`; read from the environment only, never logged), the script goes to ElevenLabs' text to speech over
  plain `fetch`: `POST https://api.elevenlabs.io/v1/text-to-speech/<voice>?output_format=pcm_24000`, header
  `xi-api-key`, model `eleven_multilingual_v2`, settings a little theatrical. The voice is **Daniel**
  (`onwK4e9ZLuTAKqWW03F9`, a premade British male voice, a news presenter's delivery). **One setting picks it for
  everything spoken:** `ELEVENLABS_VOICE_ID` (letters and digits only, else the default), read through `elevenVoice`
  in `api/_world/story.ts`, sets the voice of the day's story, the week in Ilyr and Skippy's live voice calls
  (`api/_skippy/voice.ts`) alike. It answers raw 16-bit mono PCM at **24 kHz**, wrapped as WAV (48 KB a second, a
  45-second story about 2.2 MB). Its **own cap**, `ELEVENLABS_BUDGET_USD` (default **$10**, never above $10, shared
  with the live calls), counted at the API rate of $0.08 per 1,000 characters (a plan's credits come cheaper, so the
  count errs high), kept in `world/stories/spend.json` (`elevenUsd`, `elevenChars`, `elevenCalls`); no reading starts
  once one more at its longest (2,000 characters, 16 cents, room for the week's script) could pass it. A day's story
  is under 1,000 characters, under 8 cents. Sources: https://elevenlabs.io/docs/api-reference/text-to-speech/convert
  and https://elevenlabs.io/pricing/api.
- **No fallback (#472):** Gemini no longer reads anything. When ElevenLabs can't read (no key, past its cap, refused
  or down), the script is still written once and kept with `audio: false`, the Desk shows the transcript and says
  plainly that the audio is waiting on ElevenLabs, and the next try (the next step's edition, or Make it now) reads
  that same script without a second Claude write. While it is still blocked, looking again costs nothing. Stories
  Gemini read before #472 stay as they were (`reader: "gemini"`); its old spend stays in the ledger (`usd`, `calls`,
  the tokens) and is never added to. The script's Claude cost is kept beside the voice's and counted in the shared
  Claude cap on the Usage panel.
- **Kept and served:** `world/stories/<day>.json` (the latest edition: the script, its length, model, voice, reader,
  edition and style, when it was made, what it cost) and `world/stories/<day>.wav` in the private Blob store. `GET /api/day-story?day=…` answers the transcript and the
  audio's link, with `stale` for an older style (or why there is none: `no-key`, `over-budget`, `not-yet`);
  `&audio=1` serves the WAV from our own origin (the CSP's `media-src` is `'self'`), cached at the edge, versioned by
  when it was made.
  Each edition replaces the day's audio, so only the current edition's versioned link is cached for good.
- **Where it shows:** on the Chronicle's day pages, "Hear the day in Ilyr" with its length, whether it is the day so
  far or the whole day, when the edition was made, a native player and the transcript (collapsed); an open player looks
  for a newer edition every five minutes while it isn't playing. On Today, yesterday's under "In Ilyr" once it is made.

## The storage layer

`api/_world/store.ts` is one small interface: `loadState`, `saveState`, `appendHistory`, `putRecap`, `readDay`.
`WORLD_STORE` picks the store:

- `azureblob` (what production runs, set by the Azure template): the private `ceo-state` container in Azure Blob
  Storage, signed in with the Function App's managed identity (no key in the code; docs/AZURE.md, "The port").
- `blob` (the code's default, kept until Vercel is off, #313): Vercel's private Blob store, signed in with Vercel's
  OIDC token the same way as the idea pictures. `world/state.json` holds the state; `world/days/<day>.json` holds each
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
- **The world clock** (issue #53): on the Desk's **Systems** page (`apps/world/src/desk/Systems.tsx`) and as
  the last pipe in the Lattice's **Boiler Room**. When the last hour ran, when the next is due, Claude or scripted,
  and this month's world spend against its $6 share. `apps/world/src/worldClock.ts` polls `GET /api/world-step`
  every minute while the tab is showing: working while the last step is under 70 minutes old, slow (amber, the pipe
  coughs) once an hour is overdue, down (the pipe bursts) past three hours or when the endpoint doesn't answer.

## Reading it

- `GET /api/world` → the feed (state, the last 12 hours, the day index, remarks, this month's spend, and the day's
  story's ElevenLabs spend as `story`), cached at the edge for five minutes.
- `GET /api/day-story?day=2026-10-13` → the day's story (transcript and audio link) or why there is none;
  `&audio=1` → the WAV. `POST { day? }` → make today's or yesterday's now (signed in on the Desk).
- `GET /api/world?day=2026-10-13` → one day's page.
- `GET /api/world-step` → the world clock, without running a step: `{ at, step, nextAt, store, claude, source,
  spend: { month, usd, budget, calls, scripted } }` (`api/_world/clock.ts`), never cached. Only times, counts and
  dollars. `POST` runs one (if due).
