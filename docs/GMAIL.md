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
  unless the mail genuinely asks him to act ("confirm this sign-in or your account locks"). Automated senders
  (no-reply, notifications, alerts, security, receipts, shipping) and List-Unsubscribe mail are told to Dialtone as
  FYI-by-default. Each tick also drops stored FYI items and automated needs-you items with no explicit ask, free.
- For **needs-you** mail only, **Blasto** (`claude-sonnet-5-5`) writes two or three sentences of advice and, when a
  reply makes sense, a short draft for Nikita to copy and send himself.
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

**Nothing is ever sent, archived, labelled or deleted.** The OAuth scope is `gmail.readonly`, so Gmail itself refuses
anything else, and the code only makes four kinds of GET (profile, history, the catch-up list, one message). A draft is
text on the Desk.

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
`gmail.readonly` with `access_type=offline` and `prompt=consent`. Google sends the browser back to
`/api/gmail-callback`, behind the site gate, which takes the code only when the cookie is ours, unexpired, its passkey
still enrolled, and its value equals `state` (constant-time). The code is traded for tokens server-side; a grant
wider than read-only is refused. The browser never sees a token.

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
6. **The scope.** Left menu → **Data Access** → **Add or remove scopes** → in the filter type `gmail.readonly` → tick
   the row `.../auth/gmail.readonly` ("View your email messages and settings") → **Update** → **Save**.
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
   verified, **Continue** → tick **View your email messages and settings** → **Continue**.
4. Back on Relay it says **"Gmail is connected"**. Unread mail from the last two days is caught up over the next few
   minutes, and every new email shows within about a minute.

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
nothing on a mismatch; a grant wider than read-only is refused); the skip rules (the private skip list, the money and
legal pre-filter, the urgent count with nothing kept, the purge of stored items, Dialtone's skip, and nothing stored for skipped mail); the
catch-up (queued once, drained within the per-minute limit, never pinged, re-armed by a reconnect); and that a whole
minute logs nothing.
