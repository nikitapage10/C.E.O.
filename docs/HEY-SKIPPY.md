# Hey Skippy on the iPhone

Skippy on the iPhone's Action Button (#627): press it, say something, and Skippy answers out loud.

## What this does

- Press the Action Button and say what you need. A "Skippy" shortcut sends the words to C.E.O. (`POST /api/capture`).
- Shopping ("garlic and lemons", "we're out of coffee") goes on the Kitchen list; a reminder ("remind me to call the
  dermatologist tomorrow") goes on your to-dos. Both are sorted by plain rules, so they cost nothing.
- Anything else goes to Desk Skippy, with the same brain, caps and hand-offs as on the Desk. He answers in a sentence
  or two, and puts anything long on the Desk.
- He speaks back with the phone's own voice or, in the second version below, his ElevenLabs voice.

## First, a key for the phone

On the Desk, signed in: **Boiler Room → Security → Phones → Add a phone**. Name it (say "iPhone 17") and press **Add a
phone**. The key shows **once**. Press **Copy** and paste it straight into the shortcut (step 2 below). The Desk keeps
only a hash of it, so it can't show it again. If you lose it, revoke that phone and add it again.

Optional: on the same panel, press **Record greeting clips** once. Skippy records a few short greetings in his voice
("Yeah, what?", "Go on, monkey.") for the shortcut to play when it opens.

## The shortcut (simple version: the phone's voice)

In the Shortcuts app, tap **+**, name it **Skippy**, and add these actions in order:

0. *(Optional greeting)* **Get Contents of URL**: `https://ceo.nikita.page/hey-skippy/hello.mp3` (method GET), then
   **Play Sound** with the Contents of URL. If that address ever stops answering, use
   `https://ceo.nikita.page/api/hey-skippy` instead.
1. **Dictate Text**. Leave the prompt **empty** (it only shows on screen). Set **Stop Listening** to **After Pause**.
2. **Get Contents of URL**:
   - URL: `https://ceo.nikita.page/api/capture`
   - Method: **POST**
   - Headers: add one named `x-ceo-phone-key` whose value is the key from the Desk (it starts `skp_`). Use this header,
     not `Authorization`: the site's front door replaces `Authorization` before it reaches C.E.O.
   - Request Body: **JSON**, add a **Text** field named `text` and set it to the **Dictated Text** variable.
3. **Get Dictionary Value**: get the value for `say` in **Contents of URL**.
4. **Speak Text**: the **Dictionary Value**.

Then put it on the button: **Settings → Action Button**, swipe to **Shortcut**, and choose **Skippy**.

## The shortcut with Skippy's own voice

The same shortcut, with two changes:

- In step 2, add a second JSON field: a **Boolean** named `voice`, set to **True**.
- Replace steps 3 and 4 with:
  1. **Get Dictionary Value**: get the value for `audio` in **Contents of URL**.
  2. **If** the Dictionary Value **has any value**:
     - **Get Contents of URL**: the **Dictionary Value** (method GET),
     - **Play Sound**: the Contents of URL from that step.
  3. **Otherwise**:
     - **Get Dictionary Value**: get the value for `say` in the **first** Contents of URL (the answer from step 2),
     - **Speak Text**: that Dictionary Value.
  4. **End If**.

The answer always has `say`; `audio` is there only when ElevenLabs could read it (it is left out once the month's
voice cap is spent, and the phone speaks `say` instead). The audio link works once and for five minutes, and carries
nothing secret.

## What the phone gets back

`POST /api/capture` with the header `x-ceo-phone-key: <key>` and `{ "text": "…", "voice": true }` (voice is optional):

| Answer | When |
| --- | --- |
| `200 { "say": "Added garlic and lemons to the list." }` | Done; `audio` is added when `voice` was true and ElevenLabs read it |
| `401 { "error": "unauthorized" }` | No key, a wrong key, or a revoked one. Nothing else is said |
| `429 { "say": … }` | More than 30 in an hour from this phone; it says when to try again (`Retry-After`) |
| `400 { "say": … }` | Nothing heard, or more than 300 characters |

## Things to say

- "Garlic and lemons." "Add oat milk." "We need eggs, bread and coffee." "We're out of dish soap." Each thing goes on
  the Kitchen list once: something already on it isn't added twice. One word on its own ("milk") goes to Skippy, so
  say "add milk".
- "Remind me to call the dermatologist tomorrow." "To-do: renew the passport." "Email Sam on Friday."
- The home devices (#632, [HOME-DEVICES.md](HOME-DEVICES.md)): "Vacuum, go clean the kitchen." "Pause the vacuum."
  "Vacuum, go home." "Feed the cat a portion." "Give the cat wet food." "Run a litter clean cycle." The server's rails
  still apply (the daily feed cap per feeder, the Litter-Robot only when it says it's ready), and Skippy says what
  happened.
- Anything else: "How's the Green looking?" "Is anything broken?" Skippy answers in a sentence or two; for real work he
  gives the quick take and says he'll put the rest on the Desk, where his answer arrives like any Desk hand-off.

Skippy remembers the last few turns from each phone for ten quiet minutes, so a second press follows on from the
first: "garlic and lemons", then "and milk too"; or "who do I start at flex?", then "what about Godwin?".

The Kitchen list shows on **Today** as a small **Kitchen list** chip (signed in: open it and tick things off). Phone
to-dos are kept privately until Today's own voice to-dos (#622) take them over.

## Privacy and limits

- **The key.** 32 random bytes, shown once. Only its hash is stored (HMAC-SHA256 under a pepper derived from the Desk
  key in the Key Vault). Revoke a phone on the Desk and its key stops at once. Changing the Desk key in the vault
  revokes every phone.
- **The short memory** (the last six turns per phone: what you said and what Skippy said back) is kept only in the
  private store, forgotten after ten quiet minutes, and deleted when the phone is revoked.
- **What you say** is never logged. A shopping item or to-do is kept only in the private store. A question for Skippy
  goes through the same privacy check and room log as the Desk's chat (marked as from the phone).
- **Spend.** Shopping and to-dos make no model call. Skippy's answers come out of his existing monthly Claude share
  (`SKIPPY_BUDGET_USD`), and the voice out of ElevenLabs' existing cap (`ELEVENLABS_BUDGET_USD`). Nothing new is paid
  for.
- Details: [SECURITY.md](SECURITY.md), "Hey Skippy from the iPhone", and TB9 in [THREAT-MODEL.md](THREAT-MODEL.md).
