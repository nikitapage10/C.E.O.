# The Foundry playbook

The Foundry is the C.E.O. repo's coding crew. All of its coding happens in one Claude Code thread (the
"Foundry" thread in Nikita's C.E.O. project), on Nikita's Claude Code plan. Routines wake that thread; this file
is what it follows. Nothing here uses the Claude API.

Scope: this repository only (Nikita, 2026-10-12).

## The three lanes, in priority order

1. **Fix** (top priority). Something broke: the checks on `main` went red, the site build fails, or Nikita flagged
   a bug. Drop everything else.
2. **Ideas** (every morning at 9:00 Mountain). Propose exactly three ideas. Never code an idea before Nikita
   approves it.
3. **Upkeep** (slow, every six hours, only when nothing above is open). One small change that makes things run
   smoother without changing what Nikita sees.

## The crew

The Foundry's agents in the Lattice play the lanes. The room reads the issue labels below, so the labels are what
moves them.

| Agent | Job | Takes |
| --- | --- | --- |
| Tallboy (agent id `semicolon`) | First responder | Fixes on rung 1 |
| Rocky (agent id `caret`) | Master builder | Fixes on rungs 2 and 3, approved builds |
| Rusty (agent id `tessellate`) | Upkeep and ideas | Upkeep, the morning ideas |

## The queue: GitHub issues

Every piece of Foundry work is a GitHub issue in this repo with the `foundry` label, plus exactly one kind label.
The Desk and the Lattice read these labels straight from GitHub, so keep them accurate.

| Label | Meaning |
| --- | --- |
| `foundry` | Foundry work (required) |
| `foundry:fix`, `foundry:idea`, `foundry:build`, `foundry:upkeep` | The kind (exactly one) |
| `foundry:working` | Someone is on it |
| `foundry:ready` | Done and checked, waiting for Nikita's OK |
| `foundry:stuck` | Rung 3 failed; Nikita needs to look |
| `foundry:shipped` | Landed on `main` (add it, then close the issue) |
| `rung:1`, `rung:2`, `rung:3` | Which model rung a fix is on |

An issue with no state label is queued. Close an issue without `foundry:shipped` to drop it.

## The checks (the furnace)

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. GitHub Actions runs them on every push to
`main` and nightly (`.github/workflows/checks.yml`). When they fail on `main`, the workflow opens (or comments on) a
`foundry:fix` issue titled "Checks failing on main" and fires the Foundry's wake routine.

## Lane 1: Fix

1. Label the issue `foundry:working` and `rung:1`.
2. Reproduce the failure first (the failing check, or a failing test you add).
3. Climb the ladder. Each rung is a subagent (the Agent tool's `model` option) working in a git worktree:
   - **Rung 1, `haiku`:** two tries.
   - **Rung 2, `sonnet`:** two tries. Change the label to `rung:2`.
   - **Rung 3, `opus`:** one try. Change the label to `rung:3`.
   - Move up a rung when the checks are still red, or when the fix spreads past the failing area.
4. When every check passes:
   - **Small green fix** (rung 1, a few lines, no change Nikita would notice): this counts as upkeep. Commit it
     to `main`, push, label `foundry:shipped`, close the issue, and say nothing unless asked.
   - **Anything bigger:** push it to a branch `foundry/<issue>-<slug>`, label the issue `foundry:ready`, and post a
     decision card in the Foundry thread (`ask_decision`: "Ship <the fix>?" with Ship / Hold). On Ship, merge the
     branch into `main`, push, label `foundry:shipped` and close. On Hold, leave it labelled `foundry:ready`.
5. If rung 3 fails: label `foundry:stuck`, comment on the issue with what was tried and the best lead, and reply
   once in the Foundry thread.

## Lane 2: Morning ideas

At 9:00 Mountain, review the repo (recent commits, open issues, TODOs, slow or fragile spots, the Desk and the
Lattice) and propose **exactly three** ideas: a new feature, an improvement, or an efficiency.

- Open each as a `foundry` + `foundry:idea` issue: a two-line pitch, what it does for Nikita, its size (small,
  medium or large) and who would build it.
- Post one decision card in the Foundry thread listing all three, so Nikita can pick (Build 1 / Build 2 / Build 3 /
  None today).
- Read the comments on ideas Nikita turned down before proposing, and don't repeat them.
- On approval, relabel that issue `foundry:build` + `foundry:working` and build it (Rocky's lane). It ships through
  the same checks and the same "Ship?" card as a bigger fix. Close the ideas that weren't picked after a week.
- Any new agent, room, pet, costume or model an idea adds ships with its lore (see the repo's CLAUDE.md).

## Lane 3: Upkeep

Only when no fix or build is open and unstuck. One change per tick, on the cheapest model that can do it:

- make a flaky or slow test reliable;
- shrink the bundle or the 3D assets so the world loads faster;
- remove dead code, tidy types, clear lint warnings;
- bump one dependency, with the checks as proof;
- keep docs and setup notes in step with the code.

Open a `foundry:upkeep` issue, do the work, and when every check passes, commit to `main` and push without asking,
then label `foundry:shipped` and close. Upkeep never changes what Nikita sees or how the agents behave. If a change
would, it becomes an idea instead.

## Rules that always hold

- The checks pass before anything reaches `main`. Never skip, disable or weaken a test to get green.
- Follow the repo's CLAUDE.md (in-world lore rules, costumes, pushing to `main`).
- No secrets in the repo, issues or comments.
- Keep replies in the Foundry thread to results, blockers and decisions. Routine progress lives in the issue labels.
