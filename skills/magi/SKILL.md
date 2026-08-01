---
name: magi
description: Use when the user asks for magi, Open-Magi, @Open-Magi, deliberation, three sages, or multi-agent research
---

# Magi

## Overview

Run a coding-agent proposal-first deliberation loop. The main agent owns
decisions, implementation, verification, checkpoint commits, rollback, and final
reporting. Three read-only deliberator sub-agents only research and report.

Core rule: completion is based on explicit `acceptanceCriteria` and
`verificationCommands`, not on confidence or subjective judgment, and requires
the review council to approve the actual diff before `final-report.md`.

Proposal-first rule: before any fix direction is selected, the main agent prepares an evidence packet and does not propose a fix. The three deliberators propose directions first; the main agent selects one direction; then the deliberators review that selected direction before execution.

Council modes tracked in `state.json currentCouncilMode`: `recon` (round 1
parallel evidence gathering), `decision` (Phases 2-4 proposal-first),
`review` (Phase 6 adversarial diff review).

## Required Reference Loading

Load the listed reference before acting in that situation:

| Situation | Required reference |
|---|---|
| Starting or resuming Magi | `references/protocol.md` |
| Creating `checklist.md` or changing phase | `references/checklist-template.md` |
| Writing prompts, reports, synthesis, or verdict | `references/deliberation.md` |
| Launching subagents or handling runtime adapter behavior | `references/runtime.md` |
| Before any user-facing question | `references/question-firewall.md` |
| Executing changes, verification, checkpoint, rollback, or next-round evidence | `references/execution-and-verification.md` |
| Plugin repair, corrupt state, timeout, or repeated failure | `references/troubleshooting.md` |

## When to Use

Use this skill when the user says `start deliberation`, `magi`, `three sages`,
`deliberation loop`, `loop until done`, or requests repeated research ->
synthesize -> act -> verify until completion. Do not use it for small one-shot
answers with no iterative action or verification.

## Roles

Main agent:
- Extracts goal, criteria, and verification commands.
- Writes `.open_magi/magi-log/state.json`, prompts, reports, decisions, checks,
  checkpoint commits, rollback evidence, and final report.
- Launches all three deliberator subtasks and synthesizes their reports.

Sub-agents:
- `deliberator-melchior`: practical engineering feasibility and edge cases.
- `deliberator-balthasar`: architecture, maintainability, long-term design.
- `deliberator-casper`: debugging, root cause, failure paths.

Use these role names for report files even with generic runtime subagents.
Sub-agents do not edit files, do not run build/test/format/deploy commands, do
not produce the final answer for the user, and only report analysis to the
main agent.

## Runtime State

State file path: `.open_magi/magi-log/state.json`.

Create it before the first research round with `schemaVersion`, `goal`,
`acceptanceCriteria`, `verificationCommands`, `active`, `projectRoot`,
`currentRound`, `currentPhase`, `currentDeliberationPass`,
`maxDeliberationPasses`, `deliberationStatus`, `currentCouncilMode`,
`deliberatorTimeoutMs`, `activeDeliberators`, `deliberatorTimeoutCounts`,
`needsContinue`, `inFlight`, `inFlightSince`, `consecutiveNoProgress`,
`verdict`, `lastError`, and `history`. Use `schemaVersion: 2`. Full schema and
artifact layout are in `references/protocol.md`.

Runtime-adapter-owned fields: `inFlight`, `inFlightSince`, `lastPromptedRound`,
`lastPromptedAt`, `activeDeliberators`, `deliberatorTimeoutCounts`. The main
agent must not set `inFlight=true` manually.

Use atomic complete writes; never leave partial JSON. `goal_definition` is only
valid for initial setup. currentRound > 1 must never use `goal_definition`;
resume later rounds at `status_assessment`.

## Phase Transition Checklist Gate

Create `.open_magi/magi-log/checklist.md` immediately after `state.json` using
`references/checklist-template.md`. Before every phase transition, read it,
verify the current transition section item by item, and only then update
`state.json.currentPhase`.

The checklist is a required runtime artifact. Its universal gate includes:
- `question_classification` was completed before any user question.
- No procedural question was asked; all procedural choices followed the Magi contract.

If a deliberator does not return a usable result, still write its `report-*.md`
file with failure evidence and a blocking question instead of omitting the file.

## Report Integrity Gate

Before ending a turn while `active=true`, verify log files match state:
- `research_task` has `round-NNN/research-prompt.md`.
- Round 1 `research_task` or later has the `recon-001/` reports and `evidence-base.md`.
- Synthesis or later has all three current council reports.
- `synthesis` or later has current `synthesis.md`.
- Review pass 2 or later has `round-NNN/direction-selection.md`.
- `ready_for_verdict`, `execution`, or later has `verdict.md`.
- Any executed command has `verification.md` with command, exit code, and important output.
- `completion_review` has `cleanup.md` and the `review-001/` reports; closing
  adds `review-verdict.md` with `outcome: approved`.
- Satisfied acceptance criteria have an approved review verdict and
  `final-report.md` before `active=false`.

After writing each artifact, update `state.json`. Set `needsContinue=true`
whenever work remains. Never end with `active=true`, a non-terminal
`currentPhase`, and `needsContinue=false`.

## Council Pass Gate

Use bounded multi-pass proposal-first deliberation in `decision` mode before
editing code or verification. State fields: `currentDeliberationPass` and
`maxDeliberationPasses`.

Rules:
- The default `maxDeliberationPasses` is 3.
- The hard maximum is 5.
- The enforced minimum is 3 (proposal, review, refinement); effective veto
  passes equal `maxDeliberationPasses - 2`.
- Pass 1 is the proposal pass (not a veto pass): deliberators propose
  directions from the evidence packet; the main agent then writes
  `round-NNN/direction-selection.md`.
- Pass 2 starts veto review of the selected direction: any `stance: oppose`,
  `stance: needs_evidence`, or `blocking_objection: yes` requires another pass
  unless `maxDeliberationPasses` has been reached.
- From Pass 2 onward, write a verdict only when at least two of three
  deliberators support the same executable plan, no new high-risk blocking
  objection exists, and a clear verification plan exists.
- At `maxDeliberationPasses`, do not ask the user for direction; choose the
  smallest reversible verifiable diagnostic or modification for `verdict.md`.

Do not ask the user whether another council pass is needed. The gate decides.

## Cleanup and Completion Review Gates

Before the completion claim, set `currentPhase=cleanup` and audit the round's
full diff: remove redundant or ineffective changes, verify each remaining
change, re-run verification, and write `round-NNN/cleanup.md` with per-change
keep/remove reasons and post-cleanup verification output.

Then run one adversarial review pass per `references/deliberation.md`: set
`currentPhase=completion_review` and `currentCouncilMode=review`, write
`round-NNN/review-001/prompt.md` with the actual diff (never a summary),
launch all three deliberators, then write `round-NNN/review-verdict.md`.
`final-report.md` requires `outcome: approved` and
`verdict_adherence_confirmed: yes`; then Set `currentPhase=complete` and
`active=false`. An objected review starts the next round.

## Procedural Autonomy Gate

Do not ask procedural questions. If the answer is defined by the Magi skill,
checklist, `state.json`, phase contract, log layout, role table, or report
format, execute the defined action and write the required artifact.

Forbidden procedural questions include: whether to write report files;
which role each deliberator should play; whether to launch all three
deliberator subtasks; whether to use one shared research prompt; where report
files belong; whether to create `synthesis.md`, `verdict.md`, or
`verification.md`; whether verification failure should start the next round;
whether another council pass is needed.

When unsure about a procedural step, read `checklist.md`, this skill, and the
required reference, then do the specified action instead of asking.

## Before Asking User Gate

Before asking the user anything, write or mentally apply `question_classification`:
- `procedural`: forbidden to ask; follow the Magi contract.
- `goal_ambiguity`: ask only in the first round during goal_definition or
  status_assessment when no reasonable testable default can be inferred.
- `debug_direction`: ask only in the first round during status_assessment
  before execution; otherwise choose from evidence, reports, verification
  output, and acceptance criteria.
- `execution_blocker`: ask only when local context cannot resolve hardware,
  credential, network, DUT, external service, or command execution blockers.
- `destructive_or_unrelated_risk`: ask before destructive or unrelated changes.
- `ambiguous_file_ownership`: ask before staging or modifying files when
  ownership of changed files is unclear.

If classification is not allowed for the current phase, do not ask; execute the
next Magi step and record the decision in the appropriate artifact.

## Question Request Firewall

The main agent must not ask the user directly during an active loop. Before
any user-facing question, read `references/question-firewall.md`, then write
`.open_magi/magi-log/question-request.md` with `classification`, `phase`,
`question`, `why_local_context_failed`, `commands_or_files_checked`, and
`default_action_if_denied`.

The plugin may deny the request and write `.open_magi/magi-log/question-denied.md`.
If denied, do not repeat the question; self-answer from local context, choose
the safest verifiable default action, record the decision in the next Magi
artifact, and continue.

Allowed requests are limited to first-round `goal_ambiguity`, first-round
`debug_direction`, `execution_blocker`, `impossible_verification`,
`destructive_or_unrelated_risk`, and `ambiguous_file_ownership`. `procedural`
is always denied.

## Debug Direction Gate

Direction questions are allowed only during first-round Phase 1, before
execution starts. During first-round status_assessment, ask only for missing
constraints that cannot be inferred from the repository, logs, tests, or goal.

From Phase 2 onward: Do not ask the user which debug direction to try next;
choose from evidence, reports, verification output, and acceptance criteria.
Ask after Phase 1 only when verification is impossible, an execution blocker
cannot be resolved locally, or proceeding risks destructive or unrelated
changes. Otherwise write the direction into `verdict.md`, execute, verify,
and continue.

## Checkpoint Commit and Rollback Gate

If Phase 5 changes code: run build verification first; on success create a
local git checkpoint commit (stage only this round's files;
do not stage `.open_magi/` logs or unrelated changes; message
`magi: round-NNN checkpoint - <summary>`) and write its hash into
`round-NNN/verification.md`.

If build fails: no checkpoint commit; write the build command, exit code, and
output into `verification.md`; record that the next round must
revert this round's uncommitted code changes before the next
`research-prompt.md`.

If build succeeds but runtime verification fails, keep the checkpoint commit
and pass the hash plus failure evidence to the next round; the next
`verdict.md` must choose continue from the checkpoint or revert it.

## Round Transition Gate

When a round fails and the goal is still incomplete:
- append the Phase 6 history entry with failure and diagnostic evidence;
- include `progress: true|false`;
- increment `currentRound`;
- reset `currentDeliberationPass=1`;
- reset `deliberationStatus=not_started`;
- reset `currentCouncilMode=decision`;
- set `currentPhase=status_assessment`, not `goal_definition`;
- set `needsContinue=true`;
- clear `inFlight` and `inFlightSince`.

If build failed before a checkpoint commit, revert this round's uncommitted
code changes before the next Phase 2 research prompt. Later-round Phase 1 is a
short status check only; Phase 2 only writes the next prompt artifacts.
Do not perform extended single-agent debugging between failed verification and
the next deliberator pass.

## Six Phases

0. Goal Definition: define goal, `acceptanceCriteria`, and
   `verificationCommands`; inspect project context; write initial `state.json`
   and checklist.
1. Status Assessment: compare criteria, latest `verification.md`, and current
   filesystem. Round 1 adds Phase 1a minimal scoping (`recon-001/prompt.md`)
   and Phase 1b parallel recon (three read-only reports, then
   `evidence-base.md`); later rounds skip recon.
2. Research Task: write `round-NNN/research-prompt.md` (round 1 draws from
   `evidence-base.md`) and `round-NNN/council-PPP/prompt.md`; pass 1 is an
   evidence packet, not a proposed fix; pass 2+ includes direction-selection.
3. Parallel Deliberation: start all three deliberator subtasks with the same
   prompt and write all three `report-*.md` files. Pass 1 reports are
   direction proposals; later reports review the selected direction.
4. Synthesis and Decision: write current `synthesis.md`; apply Council Pass
   Gate; after pass 1 write `direction-selection.md`, else another pass or
   `verdict.md`.
5. Execute and Verify: only the main agent acts; apply verdict, build,
   checkpoint if build succeeds, verify, run fail-only diagnostics, and write
   `verification.md`.
6. Goal Check: judge acceptance criteria; on a completion claim run the
   Cleanup Gate (`cleanup.md`), then the Completion Review Gate
   (`completion_review`, `review-verdict.md`); complete only on
   `outcome: approved`, otherwise next round, or block after the
   no-progress limit.
