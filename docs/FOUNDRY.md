# The Foundry playbook

The Foundry is the C.E.O. repo's coding crew. All of its coding happens in one Claude Code thread (the
"Skippy, the Builder" thread (formerly "Foundry") in Nikita's C.E.O. project), on Nikita's Claude Code plan. Routines wake that thread; this file
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
| Rivet (agent id `semicolon`, Haiku) | First responder | Reads every new job and sizes it; fixes on rung 1 |
| The Builder, the Foundry's submind (agent id `ember`, Opus) | Room lead | Decides who takes each job and on which model; plans, reviews and ships; conducts the room |
| Rusty (agent id `tessellate`, Sonnet or Opus) | Builder, upkeep and ideas | The default builder for every fix and build (rungs 2 and 3), upkeep and maintenance, the morning ideas |
| Rocky (agent id `caret`, Opus) | Master builder | Only the high-level work: architecture, big-picture design, open-ended ideas where deciding what to build is most of the job |

Who and which model is the Builder's call (the Foundry's submind, on Opus), made up front for every job (Nikita,
2026-10-13). A `**Builder:**` line written when an idea is shaped on the Desk is only a suggestion: when the Builder
picks the job up, it confirms or changes it and updates the line. The Builder's rules of thumb:
- **Rusty** builds almost everything. He picks his model per job: **Sonnet** when the shape is clear (a button, a
  form field, an upload, an API call, wiring data through, a fix with a known cause, docs, refactors), **Opus** when
  it needs taste or judgement (tricky fixes, and always anything with design or animation in it: 3D scenes, models,
  animation, lighting, layout and visual polish). Extra jobs go to
  Rusty clones: spare units come off the dock in the room, each a subagent on the model its job needs.
- **Rocky (Opus)** is held for the high-level work: architecture, big-picture design and open-ended ideas.
- **Rivet (Haiku)** answers first: triage, one-line fixes, copy tweaks, labels.

This holds for chat work too: the Builder's thread plans, reviews and ships, and hands the coding to the matching
crew member as a subagent on that model. Every issue carries a `**Builder:**` line naming who and on what, e.g.
`**Builder:** Rusty (Opus)`, and the Desk and the room show that crew member on it.

## The queue: GitHub issues

Every piece of Foundry work is a GitHub issue in this repo with the `foundry` label, plus exactly one kind label.
The Desk and the Lattice read these labels straight from GitHub, so keep them accurate.

| Label | Meaning |
| --- | --- |
| `foundry` | Foundry work (required) |
| `foundry:fix`, `foundry:idea`, `foundry:build`, `foundry:upkeep`, `foundry:chat` | The kind (exactly one) |
| `foundry:working` | Someone is on it |
| `foundry:ready` | Done and checked, waiting for Nikita's OK |
| `foundry:stuck` | Rung 3 failed; Nikita needs to look |
| `foundry:shipped` | Landed on `main` (add it, then close the issue) |
| `foundry:revise` | An idea Nikita sent back with notes from the Desk, or proposed there; Rusty rewrites it |
| `foundry:passed` | An idea Nikita passed on (closed, not planned): on the shelf, not in the bin |
| `rung:1`, `rung:2`, `rung:3` | Which model rung a fix is on |

An issue with no state label is queued. Close an issue without `foundry:shipped` to drop it.

`foundry:chat` is work Nikita asked for in chat (any thread, any model), built outside the lanes and pushed straight
to `main` as the repo's CLAUDE.md says. It is still listed: whichever thread starts such work opens a `foundry` +
`foundry:chat` + `foundry:working` issue for it first (title, a `**Pitch:**` line, `**Size:**`, a `**Builder:**`
line naming the crew member for the model the thread really codes on (Rocky for Opus, Rusty for Sonnet, Rivet for
Haiku), the branch), and labels it `foundry:shipped` and closes it when the work lands. The Desk's Foundry tab lists
it under "In flight" with everything else, and in the Foundry room that crew member (or a clone, when they are
already busy) is seen working on it (Nikita, 2026-10-12: "any development-based idea should end up in the Foundry
somewhere as well"; 2026-10-13: the crew shown must match the model doing the work).

## Decisions go through Skippy

The Builder, the Foundry's submind, picks the model for each job (the fix ladder below). When a decision isn't settled by
this playbook (a Ship on a bigger fix, a stuck rung, a question an idea didn't answer), it goes to Skippy's thread
("Skippy, the Magnificent") first, as [SKIPPY.md](SKIPPY.md) describes, and Skippy decides or asks Nikita. Anything this
playbook already allows needs no one.

## Branches and deploys

Everything the Foundry codes on its own lands through a branch and a pull request, never a direct push to `main`.
(Changes Nikita asks for in chat still go straight to `main`.)

| Lane | Branch | Merges when |
| --- | --- | --- |
| Fix | `foundry/fix/<issue>-<slug>` | Small green fix: by itself once the PR's checks pass. Anything bigger: on Nikita's Ship. |
| Build (approved idea) | `foundry/build/<issue>-<slug>` | By itself once the PR's checks pass: the approval was the decision (Nikita, 2026-10-12). Only a red check, a stuck rung or a question that needs a human stops it, and then it waits with `foundry:ready` or `foundry:stuck`. |
| Upkeep | `foundry/upkeep/<issue>-<slug>` | By itself once the PR's checks pass |

The path for every change:

1. **Branch** from the latest `main`, named as above. One issue per branch, one branch per PR.
2. **Pull request** into `main`, titled like the issue, with `Closes #<issue>` and the lane label (`foundry:fix`,
   `foundry:build` or `foundry:upkeep`) on it.
3. **Checks** run on the PR (`checks.yml`). Red means back to the ladder; never merge red.
4. **Preview:** Vercel builds a preview site for the PR. Bigger fixes and builds put the preview link on the
   "Ship?" card so Nikita can try it first.
5. **Merge** with a squash commit, then delete the branch. Vercel deploys `main` to the site.
6. **Watch:** the push to `main` runs the checks again. If they go red there, the merge is reverted with a
   `git revert` commit through a `foundry/fix/` branch, and the fix starts over.

## The checks (the furnace)

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. GitHub Actions runs them on every push to
`main`, on every pull request and nightly (`.github/workflows/checks.yml`). When they fail on `main`, the workflow opens (or comments on) a
`foundry:fix` issue titled "Checks failing on main". The Foundry thread picks it up at its hourly queue check
(the "Foundry: hourly queue check" routine, six past every hour). Routines fired from outside the thread open a
fresh session instead of reaching it, so nothing wakes the thread from GitHub or the Desk.

## Lane 1: Fix

1. Label the issue `foundry:working` and `rung:1`.
2. Reproduce the failure first (the failing check, or a failing test you add).
3. Climb the ladder. Each rung is a subagent (the Agent tool's `model` option) working in a git worktree:
   - **Rung 1, Rivet on `haiku`:** one try, only for a plainly tiny fix.
   - **Rung 2, Rusty on `sonnet`:** two tries. Change the label to `rung:2`. Start here for any fix with a known cause.
   - **Rung 3, Rusty on `opus`:** one try. Change the label to `rung:3`. Start here when the cause isn't clear.
   - Move up a rung when the checks are still red, or when the fix spreads past the failing area.
4. When every check passes:
   - **Small green fix** (rung 1, a few lines, no change Nikita would notice): this counts as upkeep. Open its PR
     from `foundry/fix/…`, merge it once the PR's checks pass, label `foundry:shipped`, and say nothing unless asked.
   - **Anything bigger:** open its PR from `foundry/fix/…`, label the issue `foundry:ready`, and post a decision
     card in the Foundry thread (`ask_decision`: "Ship <the fix>?" with Ship / Hold, and the preview link). On Ship,
     merge the PR, label `foundry:shipped`. On Hold, leave it labelled `foundry:ready`.
5. If rung 3 fails: label `foundry:stuck`, comment on the issue with what was tried and the best lead, and reply
   once in the Foundry thread.

## Lane 2: Morning ideas

At 9:00 Mountain, review the repo (recent commits, open issues, TODOs, slow or fragile spots, the Desk and the
Lattice) and propose **exactly three** ideas: a new feature, an improvement, or an efficiency.

- Open each as a `foundry` + `foundry:idea` issue: a two-line pitch, what it does for Nikita, its size (small,
  medium or large) and who would build it.
- Post one decision card in the Foundry thread listing all three, so Nikita can pick (Build 1 / Build 2 / Build 3 /
  None today).
- Passed ideas are shelved, not dropped (Nikita, 2026-10-12: "I might have just not been interested in it at the
  time"). Before proposing, read the shelf (closed issues labelled `foundry:passed`). At most one of the morning's
  three may be a shelved idea brought back in a genuinely different shape: a new angle, a smaller first step, or a
  different room, with a line saying what it grew out of. Never the same pitch twice; an idea passed twice rests
  for a month.
- Write each idea's body with `**Pitch:** …` and `**Size:** small|medium|large`: the Desk's Foundry tab shows
  these on the idea cards.
- Nikita picks on the Desk's Foundry tab (Build this / Revise / Not this one) or on the thread's card. The Desk's
  buttons go through `api/foundry.ts` on Vercel, which needs `FOUNDRY_DESK_KEY` and `FOUNDRY_GITHUB_TOKEN` set
  there; a click changes the issue at once. A proposed or revised idea goes up straight away in Nikita's words,
  labelled `foundry:revise`, and Rusty shapes it in the background on Claude Haiku (`CLAUDE_API_KEY`), which
  drops the label. At the hourly check, any `foundry:idea` still labelled `foundry:revise` is yours to shape:
  rewrite the title, pitch, size and builder from Nikita's words and notes, and drop the label. Any
  `foundry:build` nobody is working is yours to build. Post nothing unless a question needs Nikita.
- On approval, relabel that issue `foundry:build` + `foundry:working` and build it on a `foundry/build/…` branch
  (the builder and model the card names: Rusty unless it says Rocky). It goes through the same PR and checks as a fix, and merges by itself once they are green: the
  approval on the Desk was the decision, so there is no "Ship?" card (Nikita, 2026-10-12: "when I approve an idea,
  you don't need me to decide to ship it"). It stops for Nikita only when something needs a human: red checks after
  every rung (`foundry:stuck`), a change that can't be checked by the checks (a look, a feel, a new model), or a
  question the idea didn't answer; then it waits labelled `foundry:ready` with the preview link in the Foundry
  thread. Close the ideas that weren't picked after a week.
- Any new agent, room, pet, costume or model an idea adds ships with its lore (see the repo's CLAUDE.md).

## Lane 3: Upkeep

Only when no fix or build is open and unstuck. One change per tick, on the cheapest model that can do it:

- make a flaky or slow test reliable;
- shrink the bundle or the 3D assets so the world loads faster;
- remove dead code, tidy types, clear lint warnings;
- bump one dependency, with the checks as proof;
- keep docs and setup notes in step with the code.

Open a `foundry:upkeep` issue, do the work on a `foundry/upkeep/…` branch, open its PR, and merge it without
asking once the PR's checks pass, then label `foundry:shipped`. Upkeep never changes what Nikita sees or how the agents behave. If a change
would, it becomes an idea instead.

## Rules that always hold

- The checks pass before anything reaches `main`. Never skip, disable or weaken a test to get green.
- Follow the repo's CLAUDE.md for lore and costumes. Its "push to `main`" rule is for chat work; the Foundry uses
  the branches above.
- No secrets in the repo, issues or comments.
- Keep replies in the Foundry thread to results, blockers and decisions. Routine progress lives in the issue labels.
