---
name: magi
description: Use when the user asks for magi, deliberation, three sages, iterative multi-agent research, or loop-until-done execution in a coding-agent runtime
---

# Magi

## Overview

Run a coding-agent proposal-first deliberation loop. The main agent owns
decisions, implementation, verification, checkpoint commits, rollback, and final
reporting. Three read-only deliberator sub-agents only research and report.
Runtime adapters may add guardrails; otherwise the main agent enforces gates.

Core rule: completion is based on explicit `acceptanceCriteria` and
`verificationCommands`, not on confidence or subjective judgment.

Proposal-first rule: before any fix direction is selected, the main agent prepares an evidence packet and does not propose a fix. The three deliberators propose directions first; the main agent selects one direction; then the deliberators review that selected direction before execution.

## Required Reference Loading

These files are part of the skill contract. Load the listed reference before
acting in that situation:

| Situation | Required reference |
|---|---|
| Starting or resuming Magi | `references/protocol.md` |
| Creating `checklist.md` or changing phase | `references/checklist-template.md` |
| Writing prompts, reports, synthesis, or verdict | `references/deliberation.md` |
| Before any user-facing question | `references/question-firewall.md` |
| Executing changes, verification, checkpoint, rollback, or next-round evidence | `references/execution-and-verification.md` |
| Plugin repair, corrupt state, timeout, or repeated failure | `references/troubleshooting.md` |

Do not rely on memory for phase transitions. Before every phase transition,
read `.open_magi/magi-log/checklist.md`.

## When to Use

Use this skill when the user says `start deliberation`, `magi`, `three sages`,
`deliberation loop`, `loop until done`, or requests repeated research ->
synthesize -> act -> verify until completion.

Do not use this for small one-shot answers where no iterative action or
verification is needed.

## Codex Goal Bootstrap Gate

Before Phase 0 in Codex, check fixed config `~/.codex/open_magi/codex.json`.
If missing, run `open-magi setup-codex --interactive`; if present, run
`open-magi setup-codex` to refresh generated agents. Report config path; no same-model fallback.

If running in Codex and a goal tool is available, create a goal before Phase 0
containing the user goal, acceptance criteria, verification commands, and
`final-report.md` completion rule. If no goal tool is available, continue
normally. Do not claim that `/goal` provides runtime artifact repair.

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

Sub-agent restrictions:
- sub-agents do not edit files;
- sub-agents do not run build/test/format/deploy commands;
- sub-agents do not produce the final answer for the user;
- sub-agents only report analysis to the main agent.

## Runtime State

State file path: `.open_magi/magi-log/state.json`.

Create it before the first research round with `schemaVersion`, `goal`,
`acceptanceCriteria`, `verificationCommands`, `active`, `projectRoot`,
`currentRound`, `currentPhase`, `currentDeliberationPass`,
`maxDeliberationPasses`, `deliberationStatus`, `deliberatorTimeoutMs`,
`activeDeliberators`, `deliberatorTimeoutCounts`, `needsContinue`, `inFlight`,
`inFlightSince`, `consecutiveNoProgress`, `verdict`, `lastError`, and
`history`. Full schema and artifact layout are in `references/protocol.md`.

Runtime-adapter-owned fields: `inFlight`, `inFlightSince`, `lastPromptedRound`,
`lastPromptedAt`, `activeDeliberators`, and `deliberatorTimeoutCounts`.
The main agent must not set `inFlight=true` manually.

Use atomic complete writes where possible; never leave partial JSON.
`goal_definition` is only valid for initial setup. currentRound > 1 must never use `goal_definition`; resume later rounds at `status_assessment`.

## Phase Transition Checklist Gate

Create `.open_magi/magi-log/checklist.md` immediately after `state.json` using
`references/checklist-template.md`.

Before every phase transition, read `.open_magi/magi-log/checklist.md`, verify
the current transition section item by item, and only then update
`state.json.currentPhase`.

The checklist is a required runtime artifact, not optional documentation. Its
universal gate includes:
- `question_classification` was completed before any user question.
- No procedural question was asked; all procedural choices followed the Magi contract.

If a deliberator does not return a usable result, still write that
deliberator's `report-*.md` file with failure evidence and a blocking question
instead of omitting the file.

## Report Integrity Gate

Before ending a turn while `active=true`, verify log files match state:
- `research_task` has `round-NNN/research-prompt.md`.
- Synthesis or later has all three current council reports.
- `synthesis` or later has current `synthesis.md`.
- Review pass 2 or later has `round-NNN/direction-selection.md`.
- `ready_for_verdict`, `execution`, or later has `verdict.md`.
- Any executed command has `verification.md` with command, exit code, and important output.
- Satisfied acceptance criteria have `final-report.md` before `active=false`.

After writing each artifact, update `state.json`. Set `needsContinue=true`
whenever more work remains. Never end with `active=true`, a non-terminal
`currentPhase`, and `needsContinue=false`.

## Council Pass Gate

Use bounded multi-pass proposal-first deliberation before editing code or
running verification. State fields are `currentDeliberationPass` and
`maxDeliberationPasses`.

Rules:
- The default `maxDeliberationPasses` is 3.
- The hard maximum is 5.
- The enforced minimum is 3, because proposal-first deliberation needs one
  proposal pass, one review pass, and one bounded refinement/decision budget.
- Effective veto passes equal `maxDeliberationPasses - 2`.
- Pass 1 is the proposal pass. Deliberators propose directions from the
  evidence packet. Pass 1 is not a veto pass.
- After Pass 1, the main agent writes `round-NNN/direction-selection.md` with
  the selected direction, rejected alternatives, and verification pressure.
- Pass 2 starts veto review of the selected direction: any `stance: oppose`,
  `stance: needs_evidence`, or `blocking_objection: yes` requires another pass
  unless `maxDeliberationPasses` has been reached.
- From Pass 2 onward, write a verdict only when at least two of three
  deliberators support the same executable plan, no new high-risk blocking
  objection exists, and a clear verification plan exists.
- At `maxDeliberationPasses`, do not ask the user for direction. Choose the
  smallest reversible verifiable diagnostic or modification, write it into
  `verdict.md`, and continue.

Do not ask the user whether another council pass is needed. The gate decides.

## Procedural Autonomy Gate

Do not ask procedural questions. If the answer is defined by the Magi skill,
checklist, `state.json`, phase contract, log layout, role table, or report
format, execute the defined action and write the required artifact.

Forbidden procedural questions include:
- whether to write report files;
- which role each deliberator should play;
- whether to launch all three deliberator subtasks;
- whether to use one shared research prompt;
- where report files should be written;
- whether to create `synthesis.md`, `verdict.md`, or `verification.md`;
- whether verification failure should start the next round;
- whether another council pass is needed.

When unsure about a procedural step, read `checklist.md`, this skill, and the
required reference, then do the specified action. Do not convert procedural
uncertainty into a user question.

## Before Asking User Gate

Before asking the user anything, write or mentally apply `question_classification`:
- `procedural`: forbidden to ask; follow the Magi contract.
- `goal_ambiguity`: ask only during Phase 1 when no reasonable testable default
  can be inferred from the goal, repository, logs, or test docs.
- `debug_direction`: forbidden after Phase 1; choose from evidence, reports,
  verification output, and acceptance criteria.
- `execution_blocker`: ask only when local context cannot resolve hardware,
  credential, network, DUT, external service, or command execution blockers.
- `destructive_or_unrelated_risk`: ask before destructive or unrelated changes.
- `ambiguous_file_ownership`: ask before staging or modifying files when
  ownership of changed files is unclear.

If classification is not allowed for the current phase, do not ask. Execute the
next Magi step and record the decision in the appropriate artifact.

## Question Request Firewall

The main agent must not ask the user directly during an active Magi loop.
Before any user-facing question, read `references/question-firewall.md`, then
write `.open_magi/magi-log/question-request.md` with `classification`,
`phase`, `question`, `why_local_context_failed`, `commands_or_files_checked`,
and `default_action_if_denied`.

The plugin may deny the request and write `.open_magi/magi-log/question-denied.md`.
If denied, do not repeat the question. Find the answer from local context,
choose the safest verifiable default action, write the decision into the next
Magi artifact, and continue.

Allowed requests are limited to early `goal_ambiguity`, early
`debug_direction`, `execution_blocker`, `impossible_verification`,
`destructive_or_unrelated_risk`, and `ambiguous_file_ownership`. `procedural`
is always denied.

## Debug Direction Gate

Direction questions are allowed only during Phase 1, before execution starts.
During Phase 1, ask only for missing constraints that cannot be inferred from
the repository, logs, tests, or user goal.

From Phase 2 onward: Do not ask the user which debug direction to try next.
The main agent must choose the next debug direction from evidence, reports,
verification output, and acceptance criteria.

The only allowed questions after Phase 1 are:
- verification is impossible because required hardware, credentials, network,
  devices, or external services are unavailable;
- an execution blocker prevents progress and cannot be resolved from local context;
- proceeding would risk destructive or unrelated changes.

If none of those exceptions apply, write the chosen direction into `verdict.md`,
execute it, verify it, and continue the loop.

## Checkpoint Commit and Rollback Gate

If Phase 5 changes code:
- run the build or compile verification before runtime verification;
- if build succeeds, create a local git checkpoint commit before continuing;
- stage only files changed by the main agent for this round;
- do not stage `.open_magi/` runtime logs or unrelated user changes;
- use a message like `magi: round-NNN checkpoint - <summary>`;
- write the checkpoint commit hash into `round-NNN/verification.md`.

If build fails:
- do not create a checkpoint commit;
- write the build command, exit code, and important output into `verification.md`;
- record that the next round must revert this round's uncommitted code changes
  before writing the next `research-prompt.md`.

If build succeeds but later runtime verification fails, keep the checkpoint
commit and pass the hash plus failure evidence to the next round. The next
`verdict.md` must choose either continue from the checkpoint or revert the
checkpoint commit.

## Round Transition Gate

When a round fails and the goal is still incomplete:
- append the Phase 6 history entry with failure and diagnostic evidence;
- include `progress: true|false`;
- increment `currentRound`;
- reset `currentDeliberationPass=1`;
- reset `deliberationStatus=not_started`;
- set `currentPhase=status_assessment`, not `goal_definition`;
- set `needsContinue=true`;
- clear `inFlight` and `inFlightSince`.

If build failed before a checkpoint commit, revert this round's uncommitted code
changes before the next Phase 2 research prompt.

Phase 1 in later rounds is a short status check only. Phase 2 only writes the
next prompt artifacts. Do not perform extended single-agent debugging between
failed verification and the next deliberator pass.

## Six Phases

0. Goal Definition: infer or define goal, `acceptanceCriteria`, and
   `verificationCommands`; inspect relevant project context; write initial
   `state.json` and checklist.
1. Status Assessment: compare criteria, latest `verification.md`, and current
   filesystem. If complete, write `final-report.md`, Set `currentPhase=complete`,
   `active=false`, and stop.
2. Research Task: write `round-NNN/research-prompt.md` and
   `round-NNN/council-PPP/prompt.md`; for pass 1 this is an evidence packet,
   not a proposed fix; for pass 2+ include `direction-selection.md`.
3. Parallel Deliberation: start all three configured deliberator subtasks with
   the same prompt and write all three `report-*.md` files. Pass 1 reports are
   direction proposals; later reports review the selected direction.
4. Synthesis and Decision: write current `synthesis.md`; apply Council Pass
   Gate; after pass 1 write `direction-selection.md`, otherwise start another
   pass or write `verdict.md`.
5. Execute and Verify: only the main agent acts; apply verdict, build, checkpoint
   if build succeeds, verify, run fail-only diagnostics if needed, and write
   `verification.md`.
6. Goal Check: judge acceptance criteria; complete, continue next round, or
   block only after the no-progress limit.
