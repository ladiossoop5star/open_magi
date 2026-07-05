# Question Firewall Reference

Use this before any user-facing question during an active Magi loop.

## Request File

The main agent must not ask the user directly during an active Magi loop. Before
any user-facing question, first write `.open_magi/magi-log/question-request.md`.

Use this format:

```md
# Question Request
classification: procedural | debug_direction | execution_blocker | impossible_verification | destructive_or_unrelated_risk | ambiguous_file_ownership | goal_ambiguity
phase: currentPhase
question: exact question the main agent wants to ask
why_local_context_failed: what could not be resolved locally
commands_or_files_checked: repo files, logs, reports, commands, or docs already checked
default_action_if_denied: concrete action to take if the plugin denies the question
```

The plugin may deny the request and write
`.open_magi/magi-log/question-denied.md`. If denied, do not repeat the question.
Find the answer from local context, choose the safest verifiable default action,
write the decision into the next Magi artifact, and continue.

The plugin consumes `question-request.md` after handling it, whether the request
is allowed or denied. If a question is allowed and the external blocker is later
resolved, continue from `state.json` and do not recreate the old request file.
If a request is denied, read `question-denied.md` once, self-answer, and
continue without writing the same request again.

## Allowed Requests

- `goal_ambiguity` only in the first round during goal definition or status
  assessment, and only when no reasonable testable default can be inferred.
- `debug_direction` only in the first round during `status_assessment`, before
  any execution attempt has started.
- `execution_blocker`, `impossible_verification`,
  `destructive_or_unrelated_risk`, and `ambiguous_file_ownership` when local
  evidence cannot resolve the blocker safely.

## Denied Requests

- `procedural` is always denied.
- `debug_direction` is denied after the first round and from Phase 2 onward.
- missing or unknown `classification` is denied.

When denied, self-answer instead of asking:
- Unknown procedure: read this skill, checklist.md, and state.json.
- Unknown debug direction: compare reports, verification output, history, and
  acceptanceCriteria; choose the highest-evidence direction.
- Missing data after a failed attempt: add it to `failure_diagnostic_commands`.
- Missing file location: search the repository with `rg` or `find`.
- Sub-agent blocking question: record it in that report, then main agent
  decides from available evidence.
