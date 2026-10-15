<!-- One issue per PR, titled like the issue. The lines below match the issue's Trail (docs/DELIVERY.md). -->
Closes #

**Origin:** where it came from, with a link (the Desk, a morning idea, a chat ask, a red check, an upkeep tick)
**Decision:** who decided (approved on the Desk, Ship on the card, small green fix, upkeep, a chat ask)
**Builder:** who built it and on which model, e.g. Rusty (Sonnet)

### What changes

-

### How it was checked

- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass
- [ ] Browser tests (`npm run test:e2e`) when the Lattice or the Desk changed
- [ ] Pictures on the issue (`scripts/issue-shots.sh`): screenshots for a visual change, a change card (`scripts/change-card.mjs`) for anything else
- [ ] Lore ships with any new agent, costume, body, pet or room (CLAUDE.md)
- [ ] No secrets, personal data or message contents in the diff, the issue or this PR

### Risk and rollback

Risk: low, medium or high, and why. To undo: revert this PR. Anything a revert won't undo (settings, env vars,
stored data):
