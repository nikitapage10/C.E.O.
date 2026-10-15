# @ceo/hub (phase 2 — not built yet)

The always-on service that will run on the MacBook and connect real agents to the Lattice.

- Runs **event sources** (Claude Code hooks receiver, OpenAI/Claude agent loops, BlueBubbles webhooks, Sleeper and
  Kalshi pollers) and normalises their activity into `AgentEvent`s from `@ceo/core`.
- Streams those events to the world over a WebSocket. The world's simulator is the stand-in until then.
- Holds the **approval queue**: every outbound action is checked with `evaluate()` from `@ceo/core`'s policy
  engine. `ask` → the dashboard shows a card; `auto` → an **action executor** runs it; `block` → logged only.

`src/index.ts` defines the interfaces (`EventSource`, `ActionExecutor`, `HubConfig`). See
[`docs/AGENT_STACK.md`](../../docs/AGENT_STACK.md) for which services plug in where.

**Relay's privacy rules come first.** What Relay may read, keep, send to OpenAI and show on the site, how long it
keeps anything and how to wipe it are in [`docs/RELAY-PRIVACY.md`](../../docs/RELAY-PRIVACY.md). The site gets
counts and states only, in the allowlisted shape `RelayStatus` from `@ceo/core` (`packages/core/src/relay.ts`).
