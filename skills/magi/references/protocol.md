# Magi Protocol Reference

Use this when starting or resuming a Magi loop.

## State Contract

State file path:

```text
.open_magi/magi-log/state.json
```

Create this file before the first research round:

```json
{
  "schemaVersion": 2,
  "goal": "final user goal",
  "acceptanceCriteria": ["observable completion condition"],
  "verificationCommands": ["command that proves completion"],
  "active": true,
  "sessionID": null,
  "projectRoot": "/absolute/project/root",
  "mainAgent": "build",
  "currentRound": 1,
  "currentPhase": "goal_definition",
  "currentDeliberationPass": 1,
  "maxDeliberationPasses": 3,
  "deliberationStatus": "not_started",
  "currentCouncilMode": "recon",
  "deliberatorTimeoutMs": 1800000,
  "activeDeliberators": {},
  "deliberatorTimeoutCounts": {},
  "needsContinue": false,
  "inFlight": false,
  "inFlightSince": null,
  "lastPromptedRound": 0,
  "lastPromptedAt": null,
  "consecutiveNoProgress": 0,
  "verdict": null,
  "lastError": null,
  "history": []
}
```

`schemaVersion: 2` enables council modes. `currentCouncilMode` is one of:
- `recon`: Phase 1b parallel evidence gathering (round 1 only). Reports land in
  `round-NNN/recon-001/`.
- `decision`: the proposal-first council passes before execution. Reports land
  in `round-NNN/council-PPP/`.
- `review`: the adversarial completion review before `final-report.md`.
  Reports land in `round-NNN/review-001/`.

Set `currentCouncilMode` before launching deliberators so the runtime adapter
can route timeout and hard-error reports to the correct directory. Reset it to
`decision` when entering Phase 2 and on every round transition.

If the current runtime `sessionID` is unavailable, set `sessionID` to `null`.
Runtime adapters may bind it from later session events.

The default `maxDeliberationPasses` is 3. The hard maximum is 5. Raise it above
3 only for difficult problems with unclear root cause, high-risk changes, or
conflicting verification evidence, and record the reason in `state.history` or
the current synthesis.

The default `deliberatorTimeoutMs` is 1800000 (30 minutes). Runtime adapters
may enforce it by tracking and stopping timed-out child sessions. Runtimes
without enforcement must still produce timeout reports instead of waiting
indefinitely.

Every Phase 6 history entry for an incomplete round must include
`progress: true|false`. Use `true` only when the round produced evidence,
diagnosis, verified code movement, or a safer narrowed plan. Use `false` when
the round did not reduce uncertainty or move acceptance criteria closer.

## Log Layout

```text
.open_magi/magi-log/
├── state.json
├── checklist.md
├── question-request.md
├── question-denied.md
├── round-001/
│   ├── recon-001/
│   │   ├── prompt.md
│   │   ├── report-melchior.md
│   │   ├── report-balthasar.md
│   │   └── report-casper.md
│   ├── evidence-base.md
│   ├── research-prompt.md
│   ├── council-001/
│   │   ├── prompt.md
│   │   ├── report-melchior.md
│   │   ├── report-balthasar.md
│   │   ├── report-casper.md
│   │   └── synthesis.md
│   ├── council-002/
│   │   ├── prompt.md
│   │   ├── report-melchior.md
│   │   ├── report-balthasar.md
│   │   ├── report-casper.md
│   │   └── synthesis.md
│   ├── direction-selection.md
│   ├── verdict.md
│   ├── verification.md
│   ├── cleanup.md
│   ├── review-001/
│   │   ├── prompt.md
│   │   ├── report-melchior.md
│   │   ├── report-balthasar.md
│   │   └── report-casper.md
│   └── review-verdict.md
└── final-report.md
```

`recon-001/` exists only in round 1. Later rounds reuse the previous round's
verification and diagnostic evidence instead of running a new recon pass.
`cleanup.md`, `review-001/`, and `review-verdict.md` exist only in the round
where the main agent claims completion.

## Phase Details

### Phase 0: Goal Definition

1. Extract the user's goal.
2. Define `acceptanceCriteria`.
3. Define `verificationCommands`.
4. Inspect relevant context: project instructions, structure, build/test docs.
5. Write initial `state.json`.

If criteria are unclear, infer a reasonable testable default and record it.

### Phase 1: Status Assessment

Compare current state against `acceptanceCriteria`, latest `verification.md`,
and current repository/filesystem state. Choose `complete`, `needs_research`,
`needs_action`, or `blocked`.

If complete, do not stop immediately. Run the completion review pass (Phase 6)
before writing `final-report.md`.

Round 1 splits Phase 1 into two stages:

1. **Phase 1a (minimal scoping, main agent only).** Read the error messages,
   failing test output, and `git status`/`git diff` summary. Do not deep-dive
   and do not diagnose. The only goal is to write a focused
   `round-NNN/recon-001/prompt.md` with the goal, the observed symptoms, the
   files or areas already identified, and one precise recon question per sage
   angle. Set `currentCouncilMode=recon` before launching deliberators.
2. **Phase 1b (parallel recon, deliberators).** Launch all three deliberators
   with the recon prompt. Each investigates read-only from its own angle:
   Melchior maps implementation status and risk points, Balthasar maps
   architecture boundaries and dependencies, Casper maps reproduction
   conditions and unverified assumptions. Write the three
   `round-NNN/recon-001/report-*.md` files, then synthesize them into
   `round-NNN/evidence-base.md` with confirmed facts, open questions, key
   files, and constraints. Reset `currentCouncilMode=decision` and continue to
   Phase 2.

Later rounds skip recon: the previous round's `verification.md` and diagnostic
evidence are the evidence base. Phase 1 in later rounds is a short status
check only.

### Phase 6: Goal Check

If the main agent judges acceptance criteria satisfied, do not write
`final-report.md` yet. First run the cleanup gate, then the adversarial
completion review.

Cleanup gate (`currentPhase=cleanup`):

1. Collect the round's full diff (`git diff` against the round start or
   checkpoint).
2. Split the changes into two groups:
   - fix changes: the hunks that directly repair the problem;
   - supporting changes: protective mechanisms, defensive checks, refactors,
     or implementation not strictly required by the problem.
3. Audit every fix change one by one: remove redundant or ineffective fix
   changes; every remaining fix change must be necessary for the acceptance
   criteria. Verify each kept fix change individually: record what breaks
   without it and the evidence (targeted test, command output, or trace)
   that proves it is required.
4. Do not remove supporting changes here. List them in `cleanup.md` and defer
   their judgment to the completion review council.
5. Re-run the verification commands after cleanup.
6. Write `round-NNN/cleanup.md` with per-fix-change `kept | removed` entries
   (each with a reason and its individual verification evidence), the list of
   supporting changes deferred to the review council, and the post-cleanup
   verification output (command, exit code, important output). If the round
   made no code changes, record that explicitly.
7. Only then set `currentPhase=completion_review` and continue to the review
   pass.

Completion review (`currentPhase=completion_review`,
`currentCouncilMode=review`):

1. Write `round-NNN/review-001/prompt.md` containing the acceptance criteria,
   `verdict.md`, `verification.md`, `cleanup.md`, and the actual diff (`git
   diff` output or the changed-file list with contents), never only a summary
   of the diff.
2. Launch all three deliberators for the review pass and write the three
   `round-NNN/review-001/report-*.md` files.
3. Write `round-NNN/review-verdict.md` with `outcome: approved | objected`,
   `verdict_adherence_confirmed: yes | no`, each sage's stance, and any
   blocking objections.
4. `outcome: approved` requires all three review reports at `stance: approve`
   with `blocking_objection: no`, plus `verdict_adherence_confirmed: yes`.
5. If approved, squash before the final report:
   - combine all checkpoint commits created by this loop into a single commit
     (for example `git reset --soft <base>` plus one commit); do not leave the
     fix scattered across several checkpoint commits;
   - re-run the verification commands after the squash;
   - then write `final-report.md` in the user's preferred language, including
     a standalone `squash_commit: <hash>` line and the post-squash
     verification output. Use `squash_commit: none` only when the loop made
     no code commits;
   - set `currentPhase=complete`, `active=false`, `needsContinue=false`,
     `inFlight=false`, and `inFlightSince=null`.
6. If objected: treat the objections as new evidence. Append a history entry,
   increment `currentRound`, reset `currentDeliberationPass=1`, reset
   `deliberationStatus=not_started`, reset `currentCouncilMode=decision`, set
   `currentPhase=status_assessment`, set `needsContinue=true`, and start the
   next round.

If incomplete with progress:
- append a history entry with `progress: true|false` set to `true`;
- include any failure diagnostic evidence needed by the next deliberation;
- include any checkpoint commit hash;
- reset `consecutiveNoProgress=0`;
- set `needsContinue=true`;
- increment `currentRound`;
- reset `currentDeliberationPass=1`;
- reset `deliberationStatus=not_started`;
- reset `currentCouncilMode=decision`;
- set `currentPhase=status_assessment`.

If incomplete with no progress:
- append a history entry with `progress: true|false` set to `false`;
- increment `consecutiveNoProgress`;
- if `< 5`, set `needsContinue=true`, increment `currentRound`, reset
  `currentDeliberationPass=1`, reset `deliberationStatus=not_started`, reset
  `currentCouncilMode=decision`, set `currentPhase=status_assessment`, and
  return to Phase 1;
- if `>= 5`, set `currentPhase=blocked`, `active=false`,
  `needsContinue=false`, and wait for user input.
