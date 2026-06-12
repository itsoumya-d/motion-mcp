# Motion MCP Auto-Research Engine

## Objective

Create a local, mockable first tranche that makes Motion MCP smarter at auto-research and context engineering, so it can produce source-backed research, rank implementation opportunities, and drive at least one verified repo improvement toward becoming best-in-category for apps, mobile apps, mobile games, Unity, Flutter, Expo, React, and related platforms.

## Original Request

“Use GitHub/auto research and Andrew Karpathy-style context engineering to make this plugin the best in its category across mobile games, apps, Unity, Flutter, and all platforms.”

## Intake Summary

- Input shape: `existing_plan`
- Audience: Motion MCP users building polished apps, mobile apps, games, and cross-platform motion/state-machine experiences.
- Authority: `approved`
- Proof type: `test`
- Completion proof: A working MCP workflow or tool path produces source-backed research, ranked implementation opportunities, and at least one verified local repo improvement.
- Goal oracle: Run the new/updated MCP workflow in local/mock mode and show it returns cited/source-backed research plus ranked implementation opportunities; then verify at least one implemented improvement with tests/typechecks/smoke checks.
- Likely misfire: Producing a large research report or roadmap without a usable MCP workflow and without a verified implementation improvement.
- Blind spots considered: “Best in category” could sprawl into hosted crawling, billing, design, emitters, demos, and platform rewrites; tranche one is constrained to a local/mockable research engine.
- Existing plan facts:
  - Create a fresh GoalBuddy board at `docs/goals/motion-mcp-auto-research-engine/`.
  - Use the local live board by default.
  - First tranche focus is the Research Engine.
  - No paid/hosted backend in tranche one.
  - “Andrew Karpathy-style” means context engineering: curate the right code, docs, examples, constraints, and verification context per agent step instead of one giant prompt.

## Goal Oracle

The oracle for this goal is:

`A local/mockable MCP research workflow produces source-backed research, ranked implementation opportunities, and at least one verified repo improvement, with tests/typechecks/smoke checks proving the workflow and improvement.`

The PM must keep comparing task receipts to this oracle. Planning, discovery, a passing tiny slice, or a clean-looking board is not enough. The goal finishes only when a final Judge/PM audit maps receipts and verification back to this oracle and records `full_outcome_complete: true`.

## Goal Kind

`existing_plan`

## Current Tranche

Complete successive safe verified slices until Motion MCP has a local auto-research/context-engineering workflow that can study source-backed patterns, turn them into ranked implementation opportunities, and prove at least one implemented repo improvement. The first implementation slice must be selected after Scout evidence and Judge prioritization, not guessed from vibes.

## Non-Negotiable Constraints

- Keep tranche one local, mockable, and reviewable.
- Do not add production Supabase/Stripe work, hosted crawlers, or non-mockable paid external API dependencies in tranche one.
- Preserve the existing MCP tools and generated `dist` workflow unless a task explicitly allows changing them.
- Use source-backed research for claims about category leaders, open-source patterns, or platform best practices.
- Prefer working MCP behavior and verification over static research documents.
- React/Next and Expo/React Native remain the first stable targets; Flutter and Unity may stay beta unless the board explicitly proves otherwise.

## Stop Rule

Stop only when a final audit proves the full original outcome for this tranche is complete.

Do not stop after planning, discovery, or Judge selection if a safe Worker task can be activated.

Do not stop after a single verified Worker package when the broader owner outcome still has safe local follow-up work. Advance the board to the next highest-leverage safe Worker package and continue unless a phase, risk, rejected-verification, ambiguity, or final-completion review is due.

Do not create one Worker/Judge pair per repeated file, table, route, or helper. Put repeated same-shape work into one Worker package and review the package as a whole.

Do not stop because a slice needs owner input, credentials, production access, destructive operations, or policy decisions. Mark that exact slice blocked with a receipt, create the smallest safe follow-up or workaround task, and continue all local, non-destructive work that can still move the goal toward the full outcome.

## Slice Sizing

Safe means bounded, explicit, verified, and reversible. It does not mean tiny.

A good task is the largest safe useful slice.

Small is not the goal. Useful is the goal.

A Worker should finish the whole assigned slice. A Judge should judge the whole assigned slice. A PM should reorient the board when tasks are safe but not moving the outcome.

Tiny tasks are allowed when the failure is isolated, the risk is high, the scope is unknown, or the tiny task unlocks a larger slice. Tiny tasks are bad when they keep happening, do not change behavior, only add wrappers/contracts/proof files, or avoid the real milestone.

## Canonical Board

Machine truth lives at:

`docs/goals/motion-mcp-auto-research-engine/state.yaml`

If this charter and `state.yaml` disagree, `state.yaml` wins for task status, active task, receipts, verification freshness, and completion truth.

## Run Command

```text
/goal Follow docs/goals/motion-mcp-auto-research-engine/goal.md.
```

## PM Loop

On every `/goal` continuation:

1. Read this charter.
2. Read `state.yaml`.
3. Run the bundled GoalBuddy update checker when available and mention a newer version without blocking.
4. Re-check the intake: original request, input shape, authority, proof, blind spots, existing plan facts, and likely misfire.
5. Work only on the active board task.
6. Assign Scout, Judge, Worker, or PM according to the task.
7. Write a compact task receipt.
8. Update the board.
9. If safe local work remains, choose the next largest reversible Worker package and continue unless blocked.
10. Review at phase, risk, rejected-verification, ambiguity, or final-completion boundaries; do not review every small Worker by habit.
11. Finish only with a Judge/PM audit receipt that maps receipts and verification back to the original user outcome and records `full_outcome_complete: true`.
