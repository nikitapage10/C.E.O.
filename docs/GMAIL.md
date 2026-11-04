# The email agent: Relay reads Gmail

Relay's first real line (#263; Nikita, 2026-10-22: "add an email checking agent and connect to my Gmail … keep me up
to date on it almost in real time … add them into the relay", "the 1 minute version", "just use the Claude Code API,
let's start with a 10 dollars a month cap"). It runs **on the Azure copy only**, in the Function App, with keys that
live only there. The Vercel copy's Desk says "Email: on the Azure copy".

## What it does

**Every minute** a timer function (`email_tick` in [`azure/src/index.ts`](../azure/src/index.ts), the code in
[`api/_email/`](../api/_email)) asks Gmail what was added to the inbox since the last check (`users.history.list`
from the last history id). That costs nothing: no Claude, no message read. Only for **new inbox mail** does it read
the message, made plain text, links taken out and trimmed to 2,500 characters.

- **A private skip list** and **money and legal mail** come first (see "What it skips"): counted as skipped, never
  read by a model, never kept.
- Gmail's own **Promotions** and **Social** tabs are noise by rule: counted, never sent to a model.
- **Dialtone** (`claude-haiku-5-5`) sorts everything else: **needs you**, **FYI**, **noise** or **skip** (money and
  legal mail the first look missed), with a one-line summary and a suggested next step. Only **needs you** is kept
  (#495): it must name a concrete action Nikita has to take (reply, sign, pay, decide, show up, confirm). Sign-in and
  security alerts, receipts, shipping, notifications and newsletters are FYI and are not kept (counted with the noise),
  unless the mail genuinely asks them to act ("confirm this sign-in or your account locks"). Automated senders
  (no-reply, notifications, alerts, security, receipts, shipping) and List-Unsubscribe mail are told to Dialtone as
  FYI-by-default. Each tick also drops stored FYI items and automated needs-you items with no explicit ask, free.
- For **needs-you** mail only, **Blasto** (`claude-sonnet-5-5`) writes two or three sentences of advice and, when a
  reply makes sense, a short draft for Nikita to copy and send themselves.
- New needs-you mail **pings the phone** (the Desk's own Web Push pings, `api/_desk/pings.ts`): "An email needs you"
  or "3 emails need you", a count and nothing else, never between 10pm and 7am Mountain (held for the morning).
- The **Desk's Relay page** shows the needs-you list (sender, subject, summary, step, advice, draft with **Copy draft**,
  **Open in Gmail**, **Done**). **Today** shows "N emails need you". The Lattice's Relay room has a
  brass inbox board with the counts (needs you, FYI, noise, and a dial and sounder for the last check), its tubes drop
  one canister per new mail, and the Boiler Room has a Gmail pipe; Systems has a Gmail card. Live since 2026-10-23
  (#322).

**The catch-up** (#323). History only shows what arrives after the first check, so once per connection (on the first
connect, after a reconnect, and once for the connection that existed before the catch-up shipped) the agent also lists
the **unread inbox mail of the last 48 hours** (`in:inbox is:unread newer_than:2d`, at most 24) and sorts it through
the same path over the next minutes, in whatever room each minute's limit of 12 reads leaves after new mail. It costs
what new mail costs, under the same cap; it **never pings** (it isn't new); its queue is message ids only, in the sealed
state. The Relay page's empty list says it watches mail that arrives after connecting, plus that catch-up.

**Nothing is ever archived, labelled or deleted, and nothing is sent without Nikita's yes.** The OAuth grant is
`gmail.readonly` plus, since #615, `gmail.send` (send only: it can't read, label, archive or delete), so Gmail itself
refuses anything else. The sorting only ever makes four kinds of GET (profile, history, the catch-up list, one
message). The one write is a reply Nikita confirmed on the Desk (see "Sending a reply" below). A grant without
`gmail.send` still works: the agent reads, and a draft is copied for Gmail.

## What it skips

Nikita keeps money and legal mail out of the agent (2026-10-22). [`api/_email/filter.ts`](../api/_email/filter.ts)
looks first, before any Claude call, and new mail and the catch-up both go through it:

1. **A private skip list** (`EMAIL_SKIP_TERMS`, the Key Vault secret `email-skip-terms`): comma-separated terms,
   matched case-insensitively against the sender, the subject and the body. A match is counted as skipped and nothing
   else: no model, no summary, no draft, no item, no heads-up, and nothing says which term matched. Missing or empty,
   it skips nothing.
2. **Money and legal mail**, by sender and subject: bills, payments, debts, bank and card statements, invoices,
   receipts, collections, loans, taxes, contracts and legal notices. Counted as skipped; nothing of it is stored, not
   even in the sealed list.
3. **Urgent money or legal mail** (a fraud alert, a final or overdue notice, a legal deadline, a locked account) is
   counted the same way, plus one number: the Desk's Relay page says "N urgent money or legal alerts skipped; check
   those accounts directly". No heads-up item, no sender, no reason is kept (#415), and it never pings or reaches Blasto.
4. **A purge on every tick** (#415): the same skip list and filter run over the kept items, so mail sorted before the
   filter existed, or before it grew, is dropped on the next minute and whenever the filter widens.

Mail that passes goes to Dialtone, whose instructions carry the same rule as a **skip** kind (with the same urgent
exception, chosen from the same fixed reasons). Dialtone's own words about skipped mail are dropped, and skipped mail
never reaches Blasto. People, plans, work, school, appointments and anything else that needs Nikita come through as
before. The public status carries a **skipped** count for the day, a number and nothing else.

To set or change the skip list (Azure Cloud Shell; the terms are typed hidden and never echoed):

```bash
KV=kv-ceo-besgu7fnckib2; read -rsp "Skip terms, comma-separated: " TERMS; echo; az keyvault secret set --vault-name $KV -n email-skip-terms --value "$TERMS" -o none && echo "set email-skip-terms"; unset TERMS; az functionapp config appsettings set -g rg-ceo-prod -n func-ceo-besgu7fnckib2 --settings "EMAIL_SKIP_TERMS=@Microsoft.KeyVault(VaultName=$KV;SecretName=email-skip-terms)" -o none && az functionapp restart -g rg-ceo-prod -n func-ceo-besgu7fnckib2 -o none && echo "skip list in; function app restarted"
```

## Nikita's own priorities (#522)

An optional private list (`EMAIL_PRIORITY`, the Key Vault secret `email-priority`, pasted on the Desk's Keys page into a
multi-line box; about 1.3 KB, 4,096 characters at most). Missing or empty, the agent behaves exactly as above. With it:

- **Dialtone reads it after the hard rules, below them.** The skip list, the money and legal pre-filter and the skip
  kind still run first and cannot be overridden, even by a line that says "keep money mail".
- **Three tiers.** *Needs you* (kept, pings, Blasto advises). *Can wait* (the old FYI: kept on the Relay page, no ping,
  no Blasto spend). *Noise* (dropped and counted). Without the list, FYI is still dropped as before.
- **Applications.** A plain "thanks for applying" confirmation leaves no item; it adds to "N applications confirmed",
  counted per month (it restarts each month) and shown only to a signed-in Desk. The public status has no such count.
- **Their own threads.** When the Gmail thread's first message is from their own address (`users.getProfile`, and thread
  headers only, covered by `gmail.readonly`), a reply is forced to needs you, unless the filters skip it.
- **Mail to themselves** (from and to are their own address) is noise before any model call.

The list goes to Claude only as part of Dialtone's instructions, never to the public site, and nothing logs it.

## Relay's Thread (#615)

The Desk's Relay page shows one exchange at a time. Three small actions on `POST /api/email` (passkey session only)
back it, all in `api/_email/reply.ts`:

- **A reply from a few words** (`reply`, id, said): Nikita's words ("tell them Thursday works") and the item the Desk
  already has (sender, subject, Dialtone's summary, the earlier draft) go to Blasto on Sonnet, fenced as data, under
  this agent's own cap. The new draft is kept on the item with their words. Never a number, an address, a card or a key
  in their words (the privacy check refuses them first). Writing a draft never sends it.
- **Sender rules** (`block` / `filter`, id; `unblock`, rule): block matches the sender's address, filter the sender's
  whole domain. The state keeps only an HMAC of the address or domain (under a key derived from `GMAIL_TOKEN_KEY`)
  and the display name the Desk showed. The tick counts a ruled sender's new mail as filtered, after the money, legal
  and skip-list rules and before any model, and keeps nothing of it. Every rule can be taken back.
- **How Nikita writes** (`learn-style`): on request only, up to 20 of their own sent mails from the last 90 days
  (money, legal and skip-list mail left out, quoted replies cut) go to Sonnet once, which answers with a few short
  style traits. Only the traits are kept, never a quote; Blasto's drafts read them.

### Sending a reply

`send`, id, draft: the reply goes out on the mail's own thread (`In-Reply-To` and `References` from the mail's
`Message-ID`, Gmail's `threadId`), to its `Reply-To` or else its `From`, plain text. The guard rails, each in code and
each tested (`api/_email/thread.test.ts`):

- **Only on Nikita's yes.** The Desk calls it only after a spoken "yes" or a tap on the item in focus, with its draft on
  screen, and only once the 5-second Undo window has passed. Nothing auto-sends.
- **Only the draft on screen.** The request carries the draft's text; the server sends it only when it equals the draft
  it keeps for that item (`changed`, 409, otherwise).
- **Single use.** The item is claimed (`sending`) before Gmail is called; a sent item is done and keeps `sentAt`, so a
  second yes finds nothing to send.
- **Counted against the agent's cap.** At most 40 sends a Mountain day, and none once the month's $10 cap is spent
  (`cap`, 429).
- **Needs the grant.** Without `gmail.send` in the stored grant the answer is `no-send` (403), and the Desk shows
  Copy and Open in Gmail with a quiet "Reconnect Gmail to send from here".
- Header values from the mail are stripped of line breaks before they are reused; the body is base64 UTF-8.


## What Nikita says, and the simpler Thread (#642)

- **Advice on arrival, the draft on request.** A needs-you mail arrives with Dialtone's summary and Blasto's advice
  only (Sonnet, at most 300 output tokens, `ADVICE_MAX_TOKENS`). The draft is written only when Nikita taps **Draft it**
  (or says "draft it"): `reply` with an empty `said` asks Blasto for a draft from his own advice. Texts keep their ready
  drafts from the Mac, folded until **Reply**. Mail Nikita deals with elsewhere never costs a draft.
- **Closing intent, free.** "already did it", "sent it", "done", "handled", "no worries", "taken care of" mark the item
  done with no draft and no question; "skip", "pass", "nah", "not this one" remove it like Done until the sender writes
  again (`skip`, with a few seconds of Undo on the Desk, Z). Both are matched in code
  ([`api/_email/intentWords.ts`](../api/_email/intentWords.ts)), shared by the Desk and the server, before any model.
- **The closing check.** Each minute up to 8 open items whose thread hasn't been looked at for 3 minutes get one
  `threads.get` (format=metadata: ids, dates and labels, never a body). When Nikita's own message (label `SENT`) is the
  newest in the thread, the item closes silently (`closed: "replied"`). It comes back only when the other side writes
  again. Dialtone sees Nikita's latest reply snippet in that thread as context (`<nikita-last-reply>`, fenced), so a
  "thanks" after his answer sorts as nothing to do.
- **One item per thread or invite.** `dedupe` keeps the newest open item per Gmail thread and per calendar invite (the
  iCal UID from the `text/calendar` part, hashed; older items by sender and title), so an updated invite doesn't show
  twice.
- **The intent layer.** Anything else Nikita says or types goes to one Haiku call
  ([`api/_email/intent.ts`](../api/_email/intent.ts)) with a closed answer: `reply` (words for Blasto), `rule`,
  `disposition` (done, skip, later), `question` (answered only from what the Desk already shows) or `unclear` (one
  question back). The utterance and the item are fenced as data; the call runs under this agent's cap (`SORT_MODEL`,
  200 output tokens at most) and the privacy check refuses a number, address, card or key first. About 800 tokens in
  and 80 out: **about $0.00012 an utterance**, $0.00025 at its ceiling; the free phrases cost nothing. Texts get reply,
  disposition and question only. It never sends: the Desk carries out the answer through the same gate as a tap.
- **Rules from a sentence.** "calendar invites can wait", "stop showing me newsletters", "filter everyone from this
  company" become a `tier` rule: what it matches (invites, newsletters, automated, this sender, this domain) and where
  it sends them (`can-wait`: kept off the to-do list; `filtered`: never shown). A new rule applies to the open items it
  matches at once and says how many moved; Undo puts them back as they were. A rule only ever moves mail already kept:
  the money and legal pre-filter and the skip list run first and no rule can bring that mail back.
- **Sender logos** ([`api/_email/logos.ts`](../api/_email/logos.ts)). For a kept mail's sender domain, the tick fetches
  `/apple-touch-icon.png` then `/favicon.ico` once per domain (at most 3 new domains a tick), with every guard tested:
  200 KB at most (by length and as it streams), image types only (PNG, ICO, JPEG, GIF, WebP; never SVG) and the bytes
  must match the type, one 3-second budget for the whole domain, https only, redirects followed by hand and only within
  the sender's own domain, and no private or local address. Freemail, money, legal and skip-list senders are never
  fetched. The logo is sealed in the private store under the domain's keyed hash for 30 days and served only to the
  passkey Desk (`GET /api/email?logo=`, `nosniff`, a sandboxing CSP). The Desk shows the Mac's contact photo first,
  then the logo, then the initial.

## The cap

Its own **$10 a month** (`EMAIL_BUDGET_USD`, an app setting; the template sets 10), separate from the world's,
Skippy's and Rivet's. Each call's cost comes from the response's `usage`, priced from one table
(`PRICES` in [`api/_email/budget.ts`](../api/_email/budget.ts)): Haiku 5.5 $0.10 in / $0.50 out per million tokens
(up to 100K-token prompts), Sonnet 5.5 $2 / $10. Before every call the agent checks that this month's spend plus that
call at its most stays under the cap. A sort costs about a fiftieth of a cent and advice about a cent, so $10 covers
thousands of mails.

**At the cap it pauses**: Gmail is still checked every minute and new mail is still counted (the "unsorted" count),
but no model reads it. The Desk says **"Email agent paused: monthly cap reached"** until the calendar month (UTC)
turns. The Relay page shows the month's spend against the cap.

## Privacy

Mail content is private and stays on the private path:

- **In the store**, two sealed blobs in the Azure copy's private `ceo-state` container: `email/token.json` (the
  refresh token) and `email/state.json` (history id, the last 500 message ids, the catch-up queue of ids, the mail list kept a week, the month's
  spend). Both are AES-256-GCM with a key derived from `GMAIL_TOKEN_KEY`, a Key Vault secret
  ([`api/_email/seal.ts`](../api/_email/seal.ts)), so the nightly backup holds nothing readable.
- **To the browser**, only `GET /api/email` in the Desk's passkey session (`private, no-store`), and every subject,
  sender, summary, advice and draft is wrapped in `<Private>`, so **Hide** masks it.
- **To the public** (the Lattice, Today's count, Systems, `/api/world`'s `email` field, `GET /api/email?view=status`):
  `EmailStatus` only ([`api/_email/status.ts`](../api/_email/status.ts)), an allowlist of counts, enum states and
  timestamps that refuses any unknown key or free string. A test runs a whole minute over made-up mail and checks no
  subject, sender or address reaches it.
- **To Claude**, one trimmed mail per call, as untrusted data: fenced in `<email>` blocks the mail can't close, a system
  prompt that says to ignore instructions inside it, structured output checked in code (enum kind, capped strings,
  links taken out), no tools. Anthropic's API doesn't train on it.
- **Logs** hold no content: the timer logs nothing on success and only "email tick: error" on failure.
- **Disconnect Gmail** on the Relay page asks Google to revoke the token, deletes it, and clears the mail list.

### Where the token lives

The refresh token is sealed into the private blob store, not written to Key Vault. Writing a secret would need the
Function App's identity to hold **Key Vault Secrets Officer** on it. Since #330 it holds that role only on the twelve
third-party secrets the Desk's Keys form may set, one by one ([AZURE.md](AZURE.md), "The template on every deploy"),
never on the vault and never on `gmail-token-key` or the Desk key. With the sealed blob the token needs no further
role: everything else in the vault stays **Key Vault Secrets User** (read) for the app, and nothing changes in
`infra/resources.bicep`'s roles.

### Connect Gmail (the OAuth flow)

The **Connect Gmail** button on the Relay page works only in the passkey session. It asks `POST /api/email
{action:"connect"}`, which makes a random state, sets it in a signed, HttpOnly, Secure, SameSite=Lax `__Host-` cookie
good for ten minutes (naming the passkey that asked), and sends the browser to Google's consent page for
`gmail.readonly` and `gmail.send` with `access_type=offline` and `prompt=consent`. Google sends the browser back to
`/api/gmail-callback`, behind the site gate, which takes the code only when the cookie is ours, unexpired, its passkey
still enrolled, and its value equals `state` (constant-time). The code is traded for tokens server-side; a grant
must hold `gmail.readonly`, may hold `gmail.send`, and anything wider (modify, labels, full mail) is refused. Whether
send was granted is kept beside the sealed token. The browser never sees a token.

## Setup for Nikita (from the PC's browser)

About ten minutes. Signed in to Google as the Gmail account Relay should read, and to Azure as usual.

### 1. Google Cloud Console: the OAuth client

1. Open <https://console.cloud.google.com>. If it asks, accept the terms.
2. **Create a project.** Top bar, the project picker (next to "Google Cloud") → **New project** → Project name
   `CEO Relay` → **Create**. When the notification says it's ready, click **Select project**.
3. **Turn on the Gmail API.** Top search bar: type `Gmail API` → click **Gmail API** (Marketplace result) → **Enable**.
4. **The consent screen.** Left menu (☰) → **APIs & Services** → **OAuth consent screen** → **Get started**.
   - App information: App name `C.E.O. Relay`, User support email: your Gmail → **Next**.
   - Audience: **External** → **Next**.
   - Contact information: your Gmail → **Next**.
   - Tick **I agree to the Google API Services: User Data Policy** → **Continue** → **Create**.
5. **Add yourself as a test user.** Left menu of that page → **Audience** → under **Test users**, **+ Add users** →
   your Gmail address → **Save**. Leave **Publishing status** on **Testing**.
6. **The scopes.** Left menu → **Data Access** → **Add or remove scopes** → in the filter type `gmail.readonly` → tick
   the row `.../auth/gmail.readonly` ("View your email messages and settings"); then filter `gmail.send` → tick
   `.../auth/gmail.send` ("Send email on your behalf") → **Update** → **Save**.
7. **The OAuth client.** Left menu → **Clients** → **+ Create client**.
   - Application type: **Web application**. Name: `C.E.O. Azure`.
   - **Authorized redirect URIs** → **+ Add URI** →
     `https://thankful-forest-019308c1e.5.azurestaticapps.net/api/gmail-callback` (exactly, no trailing slash), then
     **+ Add URI** again → `https://ceo.nikita.page/api/gmail-callback`. A connect comes back to the address it was
     started on (#314, docs/DOMAIN.md), so both are listed while both answer.
   - Leave **Authorized JavaScript origins** empty → **Create**.
   - The dialog shows the **Client ID** and **Client secret**. Copy both now (or **Download JSON**): the secret is
     shown only once. Keep them for step 2; don't paste them anywhere else.

While the app is in **Testing**, Google lets a refresh token live 7 days: the Relay page then says "Google stopped
accepting the connection" and **Reconnect Gmail** takes two clicks. To stop that, once it works: **Audience** →
**Publish app** → **Confirm**. Google then shows "Google hasn't verified this app" on the consent screen (it is your
own app, used only by you): **Advanced** → **Go to C.E.O. Relay (unsafe)** → continue.

### 2. Azure Cloud Shell: the three secrets (one paste)

Open <https://shell.azure.com> (Bash). Paste this one line and press Enter. It asks for the client ID, then the client
secret (typing is hidden), and makes `gmail-token-key` itself (32 random bytes; kept if it already exists, since a new
one would lock the stored token away):

```bash
KV=kv-ceo-besgu7fnckib2; read -rp "Gmail OAuth client ID: " GID; read -rsp "Gmail OAuth client secret: " GSECRET; echo; az keyvault secret set --vault-name $KV -n gmail-client-id --value "$GID" -o none && echo "set gmail-client-id" && az keyvault secret set --vault-name $KV -n gmail-client-secret --value "$GSECRET" -o none && echo "set gmail-client-secret"; unset GSECRET; if [ -n "$(az keyvault secret show --vault-name $KV -n gmail-token-key --query value -o tsv 2>/dev/null)" ]; then echo "kept gmail-token-key"; else az keyvault secret set --vault-name $KV -n gmail-token-key --value "$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')" -o none && echo "set gmail-token-key"; fi
```

### 3. Azure Cloud Shell: point the Function App at them (one paste)

CI never deploys the Bicep template, so the Function App needs its settings added by hand. In the same Cloud Shell:

```bash
az functionapp config appsettings set -g rg-ceo-prod -n func-ceo-besgu7fnckib2 --settings "GMAIL_CLIENT_ID=@Microsoft.KeyVault(VaultName=kv-ceo-besgu7fnckib2;SecretName=gmail-client-id)" "GMAIL_CLIENT_SECRET=@Microsoft.KeyVault(VaultName=kv-ceo-besgu7fnckib2;SecretName=gmail-client-secret)" "GMAIL_TOKEN_KEY=@Microsoft.KeyVault(VaultName=kv-ceo-besgu7fnckib2;SecretName=gmail-token-key)" "EMAIL_BUDGET_USD=10" -o none && az functionapp restart -g rg-ceo-prod -n func-ceo-besgu7fnckib2 -o none && echo "Gmail settings in; function app restarted"
```

`CLAUDE_API_KEY` is already set on Azure (`claude-api-key`), and the Function App's identity can already read the
vault, so **no role assignment is needed** (see "Where the token lives"). The next template run writes the same
references (`infra/resources.bicep`, `secrets`, and `emailBudgetUsd`), so nothing changes then.

### 4. Connect

1. Wait for the pull request to merge and **Deploy to Azure** to finish (Actions tab, 3 to 4 minutes).
2. Open <https://ceo.nikita.page/relay> (or the azurestaticapps.net address) and sign in with your passkey.
3. In the **Email** section, press **Connect Gmail** → pick your Gmail account → if Google says the app isn't
   verified, **Continue** → tick **View your email messages and settings** (and **Send email on your behalf**, to
   send replies from Relay) → **Continue**.
4. Back on Relay it says **"Gmail is connected"**. Unread mail from the last two days is caught up over the next few
   minutes, and every new email shows within about a minute.

### 5. Sending from Relay (once, when Gmail was connected before #615)

A grant from before #615 is read-only, so Relay offers Copy and Open in Gmail with a quiet "Reconnect Gmail to send
from here". To turn sending on:

1. Google Cloud Console → the `CEO Relay` project → **APIs & Services** → **OAuth consent screen** → **Data Access**
   → **Add or remove scopes** → filter `gmail.send` → tick `.../auth/gmail.send` ("Send email on your behalf") →
   **Update** → **Save**. It is a restricted scope; while the app stays in **Testing** with you as the test user, no
   Google review is needed.
2. On <https://ceo.nikita.page/relay>, signed in: **Open the codex** → **Gmail** → **Reconnect Gmail**.
3. On Google's page, **Continue** past "isn't verified", tick both **View your email messages and settings** and
   **Send email on your behalf** → **Continue**.
4. Back on Relay, an email's "Yes" now sends the reply on its thread after the 5-second Undo.

Unticking send on Google's page keeps Relay read-only; it still works, with Copy and Open in Gmail.

For pings on the phone, turn on **Pings on this device** on the Azure Desk (Foundry tab) on the phone, as in
SECURITY.md, "Pings on the phone": the Azure copy has its own subscriptions.

**To turn it off:** **Disconnect Gmail** on the Relay page. To be sure Google forgot the grant too:
<https://myaccount.google.com/permissions> → **C.E.O. Relay** → **Delete all connections**. To stop the agent
entirely, set `EMAIL_BUDGET_USD=0` (it then only counts) or delete the `GMAIL_*` app settings.

## The checks

`api/_email/email.test.ts` (with `npm test`, every network call mocked): the history diff; the prompt shaping (the
mail stays inside its blocks, the models are told it's data, schemas are closed, hostile answers are refused); the
budget stop (no Claude past the cap, mail still counted, the status says paused); privacy (the public status and the
world feed's `email` carry no subject or sender; the private list needs the passkey; sealed blobs are unreadable
without the key); the OAuth state check (only our signed, unexpired state for the same nonce; the callback stores
nothing on a mismatch; a grant wider than read and send is refused; whether send was granted is kept); the skip rules (the private skip list, the money and
legal pre-filter, the urgent count with nothing kept, the purge of stored items, Dialtone's skip, and nothing stored for skipped mail); the
catch-up (queued once, drained within the per-minute limit, never pinged, re-armed by a reconnect); and that a whole
minute logs nothing.
