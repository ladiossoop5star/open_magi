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
  "schemaVersion": 1,
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
│   └── verification.md
└── final-report.md
```

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

If complete, do not stop immediately. Write `final-report.md` first, then close
the loop state.

### Phase 6: Goal Check

If complete:
- write `.open_magi/magi-log/final-report.md` in the user's preferred language;
- set `currentPhase=complete`;
- set `active=false`;
- set `needsContinue=false`;
- set `inFlight=false`;
- set `inFlightSince=null`.

If incomplete with progress:
- append a history entry with `progress: true|false` set to `true`;
- include any failure diagnostic evidence needed by the next deliberation;
- include any checkpoint commit hash;
- reset `consecutiveNoProgress=0`;
- set `needsContinue=true`;
- increment `currentRound`;
- reset `currentDeliberationPass=1`;
- reset `deliberationStatus=not_started`;
- set `currentPhase=status_assessment`.

If incomplete with no progress:
- append a history entry with `progress: true|false` set to `false`;
- increment `consecutiveNoProgress`;
- if `< 5`, set `needsContinue=true`, increment `currentRound`, reset
  `currentDeliberationPass=1`, reset `deliberationStatus=not_started`, set
  `currentPhase=status_assessment`, and return to Phase 1;
- if `>= 5`, set `currentPhase=blocked`, `active=false`,
  `needsContinue=false`, and wait for user input.
