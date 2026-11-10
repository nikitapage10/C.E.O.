# Hey Skippy on the iPhone

Skippy on the iPhone's Action Button (#627): press it, say something, and Skippy answers out loud.

## What this does

- Press the Action Button and say what you need. A "Skippy" shortcut sends the words to C.E.O. (`POST /api/capture`).
- Shopping ("garlic and lemons", "we're out of coffee") goes on the Kitchen list; things that aren't groceries ("add a
  phone charger to my Amazon list", "I need to buy batteries") go on the **Things to buy** list (#735); a reminder
  ("remind me to call the dermatologist tomorrow") goes on your to-dos. All of it is sorted by plain rules, so it costs
  nothing.
- Anything else goes to Desk Skippy, with the same brain, caps and hand-offs as on the Desk. He answers in a sentence
  or two, and puts anything long on the Desk.
- He speaks back with the phone's own voice or, in the second version below, his ElevenLabs voice.

## First, a key for the phone

On the Desk, signed in: **Boiler Room → Controls → Phones → Add a phone**. Name it (say "iPhone 17") and press **Add a
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
- Replace steps 3 and 4 with the steps below. They keep the quick things quiet (#652): a finished action (a Kitchen list
  add, a to-do, a home device that did what you asked) comes back with `quiet` set to true and a short `say`, and the
  phone shows it as a notification instead of reading it out. A question, an answer, a refusal, a failure or a warning
  comes back with `quiet` false and is spoken, as before.

  3. Tap **+** (Add Action), search **Get Dictionary Value**, and tap it. Tap **Dictionary** and choose **Contents of
     URL**. Tap **Key** and type `quiet`. (The action now reads "Get Value for `quiet` in Contents of URL".)
  4. Tap **+**, search **If**, tap it. Tap the grey **Input** and choose **Dictionary Value** (the one from step 3).
     Tap **Condition**, choose **is**, then tap the value and choose **Yes**. (If your iPhone shows **1** instead of
     **Yes**, use **is** `1`.)
  5. Inside the If, tap **+** under it, search **Get Dictionary Value**, tap it, choose **Contents of URL** (the answer
     from step 2) and type the key `say`.
  6. Tap **+** under that, search **Show Notification**, tap it. Tap its text and choose **Dictionary Value** (the one
     from step 5, `say`). Tap the arrow to open the options and turn **Play Sound** off.
  7. Tap **Otherwise** (the grey line in the If block). Under it, tap **+**, search **Get Dictionary Value**, choose
     **Contents of URL** (from step 2) and type the key `audio`.
  8. Tap **+**, search **If**, tap it. Tap **Input**, choose **Dictionary Value** (the `audio` one from step 7), tap
     **Condition** and choose **has any value**.
  9. Inside that second If, tap **+**, search **Get Contents of URL**, tap it, tap **URL** and choose **Dictionary
     Value** (`audio`). Leave the method as **GET**. Then tap **+**, search **Play Sound**, tap it, and leave it on
     **Contents of URL** (from the step just above).
  10. Tap **Otherwise** of that second If. Under it, tap **+**, search **Get Dictionary Value**, choose **Contents of
      URL** (from step 2) and type the key `say`. Then tap **+**, search **Speak Text**, tap it, and choose
      **Dictionary Value** (that `say`).
  11. The two **End If** lines are already there; leave them.

In words: get `quiet`; if it is true, show `say` as a notification; otherwise run the audio branch (play `audio` if
there is one, else speak `say`).

The answer always has `say` and `quiet`; `audio` is there only when `quiet` is false and ElevenLabs could read it (it
is left out once the month's voice cap is spent, and the phone speaks `say` instead). A quiet answer makes no
ElevenLabs call at all. The audio link works once and for five minutes, and carries nothing secret.

## What the phone gets back

`POST /api/capture` with the header `x-ceo-phone-key: <key>` and `{ "text": "…", "voice": true }` (voice is optional):

| Answer | When |
| --- | --- |
| `200 { "say": "Added garlic and lemons to the list.", "quiet": true }` | A finished action (list add, to-do, device action that worked): show `say`, no `audio`. A Things to buy add says "Added phone charger to Things to buy." |
| `200 { "say": "…", "quiet": false }` | A question, answer, refusal, failure or warning: speak it; `audio` is added when `voice` was true and ElevenLabs read it |
| `401 { "error": "unauthorized" }` | No key, a wrong key, or a revoked one. Nothing else is said |
| `429 { "say": … }` | More than 30 in an hour from this phone; it says when to try again (`Retry-After`) |
| `400 { "say": … }` | Nothing heard, or more than 300 characters |

## Things to say

- "Garlic and lemons." "Add oat milk." "We need eggs, bread and coffee." "We're out of dish soap." Each thing goes on
  the Kitchen list once: something already on it isn't added twice. One word on its own ("milk") goes to Skippy, so
  say "add milk".
- Things to buy (#735), the Amazon-style list for things that aren't groceries: "Add a phone charger to my Amazon
  list." "Put batteries on things to buy." "Add a yoga mat to my to-buy list." "Order a bath mat from Amazon." "I need
  to buy a phone charger." "Buy light bulbs." It answers quietly ("Added phone charger to Things to buy."). How it
  picks the list:
  - Naming the list (Amazon, the Amazon list or cart, things to buy, the to-buy list, things I need) always sends it
    to Things to buy.
  - "I need to buy …", "we have to order …", "gotta buy …" go to Things to buy, unless it's food: "I need to buy eggs"
    is groceries. "Remind me to buy …" stays a to-do.
  - Anything else goes on the Kitchen list unless every item is plainly not groceries (a charger, batteries, light
    bulbs, a lamp): "we need batteries and milk", "add salt" and "we're out of dish soap" are groceries. Saying
    "grocery list", "shopping list" or "kitchen list" always means the Kitchen list.
  - Taking things off works the same way: "remove the phone charger from my Amazon list", "take batteries off things
    to buy". Nothing is ever bought; there's no Amazon connection.
- "Remind me to call the dermatologist tomorrow." "To-do: renew the passport." "Email Sam on Friday."
- The home devices (#632, [HOME-DEVICES.md](HOME-DEVICES.md)): "Vacuum, go clean the kitchen." "Pause the vacuum."
  "Vacuum, go home." "Feed the cat a portion." "Give the cat wet food." "Run a litter clean cycle." The server's rails
  still apply (the daily feed cap per feeder, the Litter-Robot only when it says it's ready), and Skippy says what
  happened.
- The lights (#931, #1011): "Turn on the lights." "Lights off." "Switch the study lamp on." "Run movie night." A plain
  order runs straight away, with no Yes on the Desk (that tap is only for typing in Skippy's chat). "The lights" means
  every light; Skippy says they're on only once each switch took, and names any that didn't. A question ("are the
  lights on?") never switches anything.
- Taking things off the list (#657): "remove garlic", "take milk off the list", "cross off eggs". It answers quietly when everything went; if something wasn't on the list, or "milk" could be two items, Skippy says so out loud.
- Logging a workout (#660): "did core day A", "log core workout", "core workout done". The session goes in the Haven Gym's log (`api/_haven/gym.ts`, private store) with a quiet "Logged Core day A. 1 of 2 this week."; a question ("did I do core this week?") or "remind me to…" isn't a log, and a day the plan doesn't have is said out loud.
- Anything else: "How's the Green looking?" "Is anything broken?" Skippy answers in a sentence or two; for real work he
  gives the quick take and says he'll put the rest on the Desk, where his answer arrives like any Desk hand-off.

Skippy remembers the last few turns from each phone for ten quiet minutes, so a second press follows on from the
first: "garlic and lemons", then "and milk too"; or "who do I start at flex?", then "what about Godwin?".

Every list shows in the **Haven**, in a folded panel on the left of the page, under **Lists** (#735): a section for
Groceries (the Kitchen list) and one for Things to buy, each with its count and each folded until you open it (the
open or shut state is remembered on that device). Signed in, tick things off, × one away (Undo for a few seconds), add
with the quick-add line, or **Clear ticked**; signed out it shows the counts only. The Haven's Kitchen page keeps its own
view of the groceries. On the Desk, Skippy's chat puts things on it too ("add a desk lamp to my Amazon list"). Phone
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
