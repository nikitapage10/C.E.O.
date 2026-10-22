# Which agents should do the work?

Phase 1 is visual only: every agent in the Lattice is played by the simulator. This is the plan for who plays
them for real, and how their activity reaches the world. Check each service's current docs and terms before
wiring it up — these APIs change often.

## The shape of it

```
 Real agents & services ──▶ Hub (always-on MacBook) ──▶ AgentEvents over WebSocket ──▶ The Lattice
                               │  policy engine: approve / auto-with-limits / read-only
                               └─ approval queue ◀── Approve / Deny from the dashboard (or your phone)
```

- **The hub** (`apps/hub`, stub today) is a small Node service on the MacBook, kept alive by `launchd`. It runs
  agent loops, receives webhooks, normalises everything into `AgentEvent`s (`packages/core/src/events.ts`) and
  streams them to the world. The world already speaks this format; swapping the simulator for the hub is a
  connection change, not a rewrite.
- **Autonomy is configuration** (`packages/core/src/policy.ts`). Everything starts at `approve`: agents draft, you
  tap. Later you add rules — "the Relay may auto-reply to Mom", "the Exchange may trade up to $5, $25/day" —
  without touching agent code.

## Recommendations, by room

| Room | Job | Recommended | What to know |
| --- | --- | --- | --- |
| **Foundry** | Fixes, morning ideas and upkeep for this repo | **Claude Code** (a project thread woken by routines) | Live now: the Foundry thread keeps its queue as `foundry`-labelled GitHub issues and GitHub Actions runs the checks; the Desk and the room read both from GitHub. See [FOUNDRY.md](FOUNDRY.md). |
| **Spire** | Small-business ops: inbox, orders, listings, invoices | **Claude Agent SDK** agents with the relevant connectors (email, Shopify/Stripe, etc.) | Anything outbound (emails, refunds, purchases) goes through `email.send` / `purchase.make` approvals. |
| **Exchange** | Polymarket markets and portfolio research (Polymarket replaced Kalshi, #240) | Polymarket's public **Gamma/CLOB** market data for the odds, and Nikita's **Polymarket US Retail API** key for his own positions, read-only by code (#253) | Research can be fully automatic; nothing places an order. If trading ever comes, `trade.place` stays approval-gated, with per-trade and daily caps. |
| **Green** | Sleeper fantasy football | **Sleeper API** + projections | Sleeper's public API is read-only (rosters, matchups, players, transactions), so the agent recommends and you tap it in the Sleeper app. FantasyPros has no general public API (partner access only), so use free projection sources or request access. |
| **Relay** | Reading and replying to your texts | **BlueBubbles** server on the MacBook (REST + webhooks) → OpenAI agents sort and draft in your voice → you approve on the Desk | Needs the Mac signed in to iMessage and left on, plus Full Disk Access for the server. Some features (reactions, typing indicators) need BlueBubbles' Private API, which has extra setup. Start with "draft only", then allowlist contacts for auto-replies. |
| **Archive** | The Tide: lore drafting, session prep | **ChatGPT** (where you already author Tide content) and/or a Claude agent producing `tide.publication.v1` bundles | Bundles go through the Tide's own preview → publish flow, so nothing reaches canon without you. |
| **Anywhere** | Long, browser-heavy errands | **Manus** (API) | Optional. Worth it for "go research 40 tabs and come back with a table". |

## About ChatGPT Pro

The ChatGPT app's own agent features (agent mode, scheduled tasks and similar) run inside ChatGPT and don't
stream their activity to outside apps, so the Lattice can't *watch* them. Two ways to use it anyway:

1. Use the **OpenAI API / Agents SDK** from the hub for anything you want to see working in the Lattice (that's
   what the Gepetti are mapped to).
2. Keep using the ChatGPT app for ad-hoc work, and have its results land somewhere the hub can see (an email,
   a file, a webhook), which the hub turns into a "task completed" event.

## Rollout

1. **Phase 2 — first real agents.** Hub skeleton + WebSocket; Claude Code hook adapter; the world switches from
   simulator to hub (simulator stays as a demo mode).
2. **Phase 3 — your phone and your league.** BlueBubbles (draft-only) and Sleeper (read); approvals become real
   actions; push notifications for pending approvals.
3. **Phase 4 — money, carefully.** Polymarket positions read-only first (done, #253); any trading only behind approval and caps.
4. **Phase 5 — trust.** Move specific, boring, well-understood actions to `auto` with limits.
