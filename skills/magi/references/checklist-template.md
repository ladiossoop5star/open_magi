# Magi Phase Transition Checklist

Rule: before moving to the next phase, read this file and verify every item in
the current transition section.

Universal gate before any user question:
- [ ] `question_classification` was completed before any user question.
- [ ] No procedural question was asked; all procedural choices followed the Magi contract.

## Phase 0 -> Phase 1

- [ ] `state.json` exists with goal, acceptanceCriteria, and verificationCommands.
- [ ] `state.json.currentPhase` is `goal_definition`.
- [ ] Relevant project structure and build/test docs were inspected.

## Phase 1 -> Phase 2

- [ ] acceptanceCriteria, latest verification.md, and current filesystem state were compared.
- [ ] Status is `needs_research` before entering Phase 2.
- [ ] Round 1 only: `round-NNN/recon-001/prompt.md` exists and `state.json.currentCouncilMode` was set to `recon` before launching recon deliberators.
- [ ] Round 1 only: `round-NNN/recon-001/report-melchior.md`, `report-balthasar.md`, and `report-casper.md` exist.
- [ ] Round 1 only: `round-NNN/evidence-base.md` exists with confirmed facts, open questions, key files, and constraints.
- [ ] Round 1 only: `state.json.currentCouncilMode` was reset to `decision`.
- [ ] Later rounds: previous round's verification.md and diagnostic evidence were reviewed instead of running a new recon pass.

## Phase 2 -> Phase 3

- [ ] `round-NNN/research-prompt.md` exists.
- [ ] `round-NNN/council-PPP/prompt.md` exists for the current deliberation pass.
- [ ] If this is pass 1, the prompt is an evidence packet and does not propose a fix.
- [ ] If this is pass 2 or later, `round-NNN/direction-selection.md` exists and the prompt reviews the selected direction.
- [ ] `state.json.currentDeliberationPass` is set.
- [ ] `state.json.maxDeliberationPasses` is set to 3 by default and never above 5.
- [ ] `state.json.deliberatorTimeoutMs` is set to 1800000 by default unless a harder task requires a longer timeout.
- [ ] `state.json.currentPhase` is `research_task`.

## Phase 3 -> Phase 4

- [ ] All three deliberator subtasks were started.
- [ ] `round-NNN/council-PPP/report-melchior.md` exists.
- [ ] `round-NNN/council-PPP/report-balthasar.md` exists.
- [ ] `round-NNN/council-PPP/report-casper.md` exists.
- [ ] Every report includes `stance`, `blocking_objection`, `recommended_plan`, `verification_plan`, and `risk_level`.
- [ ] If a deliberator failed or timed out, its report file records failure evidence instead of being omitted.
- [ ] `state.json.currentPhase` is `parallel_deliberation`.

## Phase 4 -> Phase 5

- [ ] `round-NNN/council-PPP/synthesis.md` exists with consensus, disagreements, unique insights, blocking objections, and evidence.
- [ ] Council Pass Gate was applied before writing a verdict.
- [ ] If pass 1 just completed, `round-NNN/direction-selection.md` was written, `currentDeliberationPass` was incremented to 2, `currentPhase=research_task`, and no verdict was written yet.
- [ ] If another later pass is required, `currentDeliberationPass` was incremented, `currentPhase=research_task`, and no verdict was written yet.
- [ ] If ready for action, `round-NNN/verdict.md` exists with decision, rationale, allowed_files, allowed_changes, verification_commands, failure_diagnostic_commands, checkpoint_commit_plan, and rollback_plan.
- [ ] `state.json.currentPhase` is `synthesis`.

## Phase 5 -> Phase 6

- [ ] The verdict was applied.
- [ ] If code changed and build succeeded, a git checkpoint commit exists and its hash is recorded in verification.md.
- [ ] If build failed, no checkpoint commit was made and the next-round rollback requirement is recorded in verification.md and state.history.
- [ ] Every verificationCommand was executed.
- [ ] If verification failed, every applicable failure_diagnostic_command was executed.
- [ ] `round-NNN/verification.md` exists with command, exit code, important output, verdict_reference, verdict_adherence, applied_files, and checkpoint_commit when applicable.
- [ ] If `verdict_adherence: no`, no final report was written; the divergence evidence is recorded for the next round.
- [ ] `state.json.currentPhase` is `execution`.

## Phase 6 -> Cleanup -> Completion Review -> Next Round or Complete

- [ ] Completion was judged against acceptanceCriteria.
- [ ] Before the completion claim, `state.json.currentPhase` was set to `cleanup`.
- [ ] The round's full diff was split into fix changes and supporting changes (protective mechanisms, defensive checks, refactors, or problem-unrelated implementation).
- [ ] Every fix change was audited one by one; redundant or ineffective fix changes were removed.
- [ ] Every kept fix change has individual verification evidence (what breaks without it, plus the test, output, or trace that proves it is required).
- [ ] Supporting changes were not removed during cleanup; they are listed in `cleanup.md` for the review council to judge.
- [ ] Verification commands were re-run after cleanup.
- [ ] `round-NNN/cleanup.md` exists with per-change keep/remove reasons and post-cleanup verification output.
- [ ] Only after cleanup, `state.json.currentPhase` was set to `completion_review` and `state.json.currentCouncilMode` to `review` before launching review deliberators.
- [ ] If claiming completion, `round-NNN/review-001/prompt.md` exists and contains the actual diff, not only a summary of the diff.
- [ ] If claiming completion, `round-NNN/review-001/report-melchior.md`, `report-balthasar.md`, and `report-casper.md` exist.
- [ ] If claiming completion, `round-NNN/review-verdict.md` exists with `outcome`, `verdict_adherence_confirmed`, and all three sage stances.
- [ ] After `outcome: approved`, all checkpoint commits from this loop were squashed into a single commit and verification commands were re-run.
- [ ] `final-report.md` was written only after the squash and includes a standalone `squash_commit: <hash|none>` line plus post-squash verification output; then `state.json.active=false` and `state.json.currentPhase=complete`.
- [ ] If the review objected, no final report was written; history was appended, currentRound was incremented, `currentCouncilMode` was reset to `decision`, and `state.json.currentPhase` was set to `status_assessment`.
- [ ] If incomplete with progress, history was appended with `progress: true|false`, currentRound was incremented, and `state.json.currentPhase` was set to `status_assessment`.
- [ ] If incomplete with no progress, history was appended with `progress: true|false`, consecutiveNoProgress was incremented and only stops at >= 5.
- [ ] `state.json.needsContinue` is correct.
- [ ] `state.json.inFlight=false` and `state.json.inFlightSince=null` when the assistant is actively resuming or finishing.
