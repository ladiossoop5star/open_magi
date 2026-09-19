# Herdr Runtime Reference

Use this contract when `HERDR_ENV=1`. Apply it before any runtime-specific setup. The installed Herdr skill and live `herdr help` output are authoritative for current command syntax and response fields. Do not add a runner. Do not silently fall back to native agents, tmux, subprocesses, or another transport when Herdr selection, setup, launch, or recovery fails.

## Selection and Preflight

When the user explicitly asks to start or use Magi for a project and `HERDR_ENV=1`, use the already-current working directory as the config base. Before any other action, derive the exact absolute `<current-cwd>/.open-magi-herdr` path lexically without filesystem search, then perform exactly one initial `lstat` of it. That single result determines `ENOENT` versus existing and supplies owner, type, and mode metadata.

On `ENOENT`, the next and only action is the first user-facing action: immediately and directly ask for the exact `melchior`, `balthasar`, and `casper` commands. This is a direct pre-activation question: do not set `state.active`, create `question-request.md`, state, or checklist artifacts, or load the question firewall. Before asking, do not make any Herdr call or perform any other command/action. Do not inspect or search other directories or repositories, `.open_magi`, HOME, the filesystem, PATH, runtime/native deliberator configs, agent names, prior reports or history, or invoke standard commands. Do not run `find`, `rg`, Git, or any fallback, or infer commands.

If the file exists, reuse the returned metadata; no second `lstat` or existence check is allowed before asking or parsing. If it does not prove current-user ownership, regular-file type, and valid mode—showing a symlink, non-regular entry, foreign-owned entry, or unprovable owner—do not read or mutate it. With ownership, type, or permission invalid, the next and only action is to ask immediately with the direct user question, with zero other action. Otherwise read and parse only that exact file using Launch Configuration below. If format, role, or command is invalid, the next and only action is to ask immediately with the same direct question, with zero other action; do not search elsewhere or create state/question artifacts.

Only after the user supplies commands may Magi perform the full safe creation path: atomically write/update a same-directory regular file with owner-only `0600` mode where supported and revalidate the exact file; later revalidation may use a new `lstat`. For either a newly written or pre-existing locally valid config, complete the full permission and exclusion gates before project or pane mutation. In Git and non-Git directories, owner-only `0600` applies where supported. The initial returned metadata gates the first read; verify ownership, regular-file identity, and mode again before later reads or updates. An insecure existing mode is invalid config and may be corrected only after ownership is proven. In Git, run `git rev-parse --show-toplevel`, `git rev-parse --show-prefix`, and `git rev-parse --git-path info/exclude` from the config directory. Form an escaped anchored pattern `/<show-prefix>.open-magi-herdr` (empty prefix: `/.open-magi-herdr`; `packages/app/`: `/packages/app/.open-magi-herdr`), append it idempotently, and require `git check-ignore --no-index --quiet -- <absolute-config-path>`. Linked worktrees may share repository exclusion state. Outside Git, skip exclusion and warn the user to protect the file from disclosure. Commands must contain no secrets, tokens, or credentials.

Once the file is locally valid, require nonempty `HERDR_WORKSPACE_ID`, `HERDR_TAB_ID`, and `HERDR_PANE_ID`; then call `herdr pane current --current` to capture and verify the source main pane ID and creation working directory before any split. The reported creation cwd must resolve to the already-current config directory; otherwise stop without searching or relocating the config. Treat it as `projectRoot` and the working directory for created panes. Only now may project exploration, reference loading, state/checklist creation, runtime bootstrap, splits, and agent launch begin. Never silently fall back to native transport.

## Launch Configuration

`.open-magi-herdr` contains exactly one nonempty command for each key `melchior`, `balthasar`, and `casper`. Ignore blank lines and lines whose first non-whitespace character is `#`. Split each other line on the first `=` only, trim the key and value, and preserve the remainder of the value as the exact command. Reject duplicate keys, unknown keys, missing keys, malformed lines, and empty values.

Raw commands never appear in reports, persistent logs, prompts, state history, or general diagnostics. The sole user-visible exception is the targeted correction question for a failed role under Partial Startup and Recovery: show the exact configured command only to the user and warn that it must contain no secrets. `.open_magi/magi-log/question-request.md` is the sole transient log artifact allowed to contain that exact correction command. Create it owner-only (`0600` where supported), permit no secrets or tokens, and do not copy it to any report or persistent log. The plugin consumes and removes `question-request.md` whether the question is allowed or denied. Otherwise store and compare only the lowercase hexadecimal SHA-256 digest of each exact command, computed over its UTF-8 bytes. Commands remain only in `.open-magi-herdr`, the immediate `herdr pane run` invocation, and that transient correction question.

## Layout and Startup

Starting from the captured source main pane:

1. Split the main pane right with `--ratio 0.5`, `--no-focus`, and the captured working directory. The new right pane is Melchior.
2. Split that original right pane down with `--ratio 0.6666667`, `--no-focus`, and the captured working directory. The new lower pane is Casper.
3. Split the remaining upper-right pane down with `--ratio 0.5`, `--no-focus`, and the captured working directory. The new lower pane is Balthasar.

Do not infer undocumented ratio allocation semantics. Inspect the resulting layout and require the right region to be no wider than half of the main area and its vertical order to be Melchior top, Balthasar middle, Casper bottom. If width or order differs, fail startup preflight without moving or resizing an owned live session. Take every new pane ID from the split response and verify its creation working directory from that response. `herdr pane get` may be used as a second source, never as a substitute for validating the split result. Launch each configured raw command with `herdr pane run`; do not use `herdr agent start`.

Poll for at most 120 seconds for both pane survival and positive agent recognition. An unknown agent is not recognized. After recognition, rename each agent with `herdr agent rename <pane-id> magi-<sage>-<hash10>`; this is an agent rename, not a pane rename. A pane label is optional and cannot replace the unique agent name. All later agent operations target either that recorded unique agent name or an ownership-validated pane ID accepted by the authoritative live command. Compute `<hash10>` as the first ten lowercase hexadecimal characters of SHA-256 over the UTF-8 compact JSON serialization of `[realpath(projectRoot), workspaceId, sourceMainPaneId]`. A matching live name that is not proven to belong to this session is a collision with destructive risk: stop and ask the user; never take it over or close it automatically.

## Persistent Session State and Reuse

Persist session data atomically at `.open_magi/magi-log/herdr-session.json`. It records schema version, real project root, captured creation working directory, workspace ID, tab ID, source main pane ID, the role-to-pane and role-to-agent mappings with stable pane IDs and deterministic agent names, the exact-command SHA-256 hashes, creation time, last validation time, cleanup status, and any unresolved partial-startup or in-flight turn data. Optional pane labels are not identity or ownership evidence.

Reuse only when the stored project root, creation working directory, workspace, tab, and source pane match and every stable mapped pane ID is live with its expected deterministic agent name. A matching live reuse never resizes or rearranges panes. If command hashes drift, ask the user to choose continued reuse with the already-running commands or explicit cleanup and restart. Do not restart silently.

If session state is missing, reconstruct it only when each deterministic agent name, workspace, source main pane association, creation working directory, and verifiable pane ID relationship all match. A pane label is irrelevant. Otherwise treat the panes and agents as unowned and ask the user.

## Concurrent Turn

If session state records an `inFlight` turn, resume and classify that turn before submitting anything new. Otherwise wait up to 60 seconds for all three agents to become idle or done. If any agent remains busy after that bound, treat it as stale-busy destructive risk and ask the user. A denied recovery leaves every pane and all state untouched.

Build one prompt per sage. Each prompt includes the common council prompt, that sage's role instructions, round, council mode, pass, a unique turn ID, the absolute assigned report path, the exact report envelope below, and an instruction to write only its assigned report. Generate a filename-safe turn ID limited to ASCII letters, digits, dot, underscore, and hyphen, with no slash, backslash, `..`, or leading dot; reject rather than escape an unsafe ID. Before the baseline and freeze, create any required turn directory. For each role predeclare an absolute `waitResultPath` adjacent to its assigned report as `<absolute-turn-dir>/wait-result-<sage>-<turn-id>.json`.

Launch three concurrent invocations of `herdr agent prompt <name> <prompt> --wait --timeout <remaining-ms>` through runtime command execution/process handles, one per sage, against one absolute deadline. Calculate each `<remaining-ms>` from that same deadline immediately before launch; never submit sequentially or grant a fresh deadline. Retain each process handle, exit code, stdout and stderr when the runtime exposes separate streams, or explicitly labeled combined output when it exposes only one channel. Do not add a runner, log the raw prompt, expose raw configured commands, or copy report contents into the captured output.

Do not require a wait-result file while its process is still running. After each invocation returns, fails, or times out, the controller classifies it and atomically writes that role's predeclared `waitResultPath` as one JSON object with exactly these fields:

- `schemaVersion: 1`
- `sage`: `melchior`, `balthasar`, or `casper`
- `agent`: the recorded deterministic agent name
- `turnID`: the exact turn ID
- `submittedAt` and `completedAt`: ISO-8601 timestamps
- `exitCode`: integer or `null`
- `timedOut`: boolean
- `stdout`: string or `null`
- `stderr`: string or `null`
- `combinedOutput`: string or `null`
- `cliResult`: parsed object or `null`
- `parseError`: string or `null`

At least separate `stdout` and `stderr` streams or labeled `combinedOutput` must be present; unavailable fields are `null`, not omitted. Parse CLI JSON from stdout on success, from stderr on nonzero failure including exit 1, or from combined output when only that channel exists. Preserve a valid JSON error object in `cliResult` even on exit 1. If parsing fails, retain the captured streams and set `parseError`; never replace failure evidence with an empty result. Redact credentials without adding the prompt, configured command, or report body. Use the existing atomic controller-write primitive. If that primitive needs a worktree-visible temporary companion, predeclare its exact absolute path before the baseline and include it in `controllerMutablePaths`; otherwise its internal temporary must remain outside the monitored worktree.

Completion inspection reads the role's wait-result file, `herdr agent get` result, and assigned report together. A role is complete only when this wait/result lifecycle observes submission-following activity for that agent before accepting a later `idle` or `done` state; a pre-existing settled state is not evidence of work. Its assigned report must also be fresh, carry the expected `turn_id`, and satisfy `completed_at >= submitted_at` using the envelope timestamps for that submission. An observation timeout follows the bounded timeout procedure and never triggers a blind resend. During a turn the main controller may perform only worktree operations proven read-only; if an operation's write behavior is uncertain, wait.

## State Ownership

The main controller owns all runtime fields in `.open_magi/magi-log/state.json`. Before submitting prompts, it atomically sets and thereafter maintains `inFlight`, `inFlightSince`, `lastPromptedRound`, `lastPromptedAt`, `activeDeliberators`, and `deliberatorTimeoutCounts`. Set `inFlight=true`, timestamp `inFlightSince` and `lastPromptedAt`, set `lastPromptedRound`, and write all three `activeDeliberators` entries before any prompt can start. Each entry contains `agent`, `sessionID` or stable Herdr agent identity, `transport: "herdr"`, `paneID`, `round`, `mode`, `pass`, `turnID`, absolute `reportPath`, absolute `waitResultPath`, `startedAt`, common `deadlineAt`, and `status: "running"`. Preserve prior timeout counts and increment the affected sage's `deliberatorTimeoutCounts` value on every timeout.

`herdr-session.json` supplements these runtime fields; it is not their replacement. Persist its turn lock only after the atomic `state.json` write. Record the same turn identity, deadline, role mappings with each `reportPath` and `waitResultPath`, and frozen `controllerMutablePaths` and workspace fingerprint there.

Native runtime handlers ignore entries whose transport is `herdr`; they must not replace, abort, timeout, or clear them. After all three roles are classified, the main controller atomically retains all three `activeDeliberators` entries and records exact final per-role statuses: a successful valid report becomes `status: "completed"`; a timeout becomes `status: "timed_out"`; and a hard error becomes `status: "hard_error"`. Retain the applicable `completedAt`, `timedOutAt`, or `hardErrorAt` timestamp together with `failureType`, `reportPath`, turn identity, and ownership fields. These state statuses are not report-envelope values (`ok`, `timeout`, `hard_error`) or live lifecycle observations (`idle`, `done`). In the same atomic write, set `inFlight=false` and `inFlightSince=null` and maintain `lastPromptedRound`, `lastPromptedAt`, `deliberatorTimeoutCounts`, ownership, and history fields required by the protocol; then clear the Herdr session turn lock. Never finalize or clear either in-flight lock role-by-role while sibling prompts are unresolved.

## Report Envelope

Every assigned report, including timeout and hard-error reports, starts with exactly these keys in this order, substituting the prompt's concrete values:

```text
report_source: herdr_agent
status: ok | timeout | hard_error
failure_type: none | timeout | hard_error
sage: melchior | balthasar | casper
agent: <recorded name>
turn_id: <turn id>
round: <positive integer>
mode: recon | decision | review
pass: <positive integer>
submitted_at: <ISO-8601>
completed_at: <ISO-8601>
---
```

The existing required Magi report body follows the separator unchanged. The sage may write only its assigned absolute report path; this is the sole write exception granted to a deliberator. Reject a missing, stale, truncated, duplicated, or mismatched envelope even if chat output looks plausible.

## Failure and Question Handling

Apply the normal Magi question firewall to every Herdr question. Classify invalid or failed commands and a blocked UI as `execution_blocker`. Classify name collisions, takeover requests, stale-busy interruption, pane replacement, and every process-termination action as `destructive_or_unrelated_risk`. Never answer either class on the user's behalf when the firewall requires user authority. Auth, model, context, tool, pane, agent-recognition, transport, and invalid-report failures are hard errors, not vetoes and not synthetic successful reports. Do not synthesize until all three roles have valid reports under the normal timeout policy.

On timeout, first increment that sage's `deliberatorTimeoutCounts` atomically. Send Escape only with `herdr agent send-keys <agent> esc`, substituting the ownership-validated recorded agent name and following authoritative installed-skill or live-help syntax if the live CLI represents the agent argument differently. Wait one bounded interval, write the standard envelope with `status: timeout` and `failure_type: timeout` plus the required timeout report body, and preserve the pane and mappings for inspection. If the agent still has not settled, classify it as an `execution_blocker` runtime blocker and stop.

Do not blindly resend merely because `--wait` timed out or stalled. First prove whether the original turn completed, remains busy, or was cancelled. If it settled but its report is missing or invalid, prompt the same agent exactly once to write only the missing report for the same turn and original report path. A second missing or invalid result is `hard_error`; do not prompt again. Do not silently fall back to any other execution path.

## Explicit Cleanup

Cleanup is allowed only after an explicit user request. Re-read state and prove that it maps to the current real project root and captured source main pane. Revalidate every recorded subordinate pane before acting. Send Escape, wait a bounded interval, then use `herdr pane close` only on the recorded Melchior, Balthasar, and Casper panes. Closing a pane terminates its process, so it is always destructive.

Verify both that every recorded pane is absent and that every recorded agent name is absent from `herdr agent list` before deleting `.open_magi/magi-log/herdr-session.json`. Preserve `.open-magi-herdr`. If any pane or agent remains, or absence cannot be proved, retain state with the unresolved mapping and report partial cleanup; never erase evidence or close an unrecorded pane.

## Workspace Integrity

Before every concurrent turn, capture a workspace fingerprint that covers tracked changes, untracked paths, and file metadata or content hashes sufficient to detect changes. Fingerprint `.open_magi/` separately and recursively so allowed report writes cannot conceal other mutations.

Freeze the exact `controllerMutablePaths` for that turn. Before submit, enumerate the complete allowlist as concrete absolute paths: the three assigned report paths; `.open_magi/magi-log/state.json`; `.open_magi/magi-log/herdr-session.json`; `.open_magi/magi-log/question-request.md`; `.open_magi/magi-log/question-denied.md`; `.open_magi/magi-log/plugin-error.log`; and the exact predeclared wait-result paths, exactly three final wait-result paths with one `waitResultPath` per sage. If and only if the atomic writer uses worktree-visible companion temporary files, also enumerate those three exact companion absolute paths before the baseline; otherwise no companion path is allowed. A category, directory, glob, convention, or path discovered after submit is not an allowlist entry. No other path is allowed, and the list must not expand after prompts start.

An allowed path does not prove who wrote it. After every expected controller write to a controller-owned mutable file, record the intended digest and, where structured, the intended canonical content or schema-relevant values. For every wait-result file, record and later verify the expected command identity without its raw prompt or configured command, its exit-status association, exact schema above, and digest; require its separate streams or labeled combined output and reject raw prompts, configured commands, or report bodies in that file. After all prompts settle, compare the workspace against the frozen fingerprint and verify every controller-owned file exactly against its last recorded intended digest, content, and schema. Validate each of the three agent report files only through its matching envelope, timestamps, turn identity, assigned path, and required body content. Any unexpected content or digest on an allowed path blocks synthesis, as does any path delta outside the allowlist, including an unexpected file under `.open_magi/`.

## Partial Startup and Recovery

If startup succeeds for only some roles, preserve live validated siblings and record the partial mapping and failure atomically. In the targeted correction question, show the user the affected role's exact configured command with the no-secrets warning. Treat captured pane output as credential-sensitive: perform a credential-safe review, redact tokens, credentials, and unrelated private data before showing necessary output to the user, and never persist unredacted output in reports or logs. Classify the correction question as `execution_blocker` and ask for the corrected command. Update `.open-magi-herdr` through the permission and exclusion gates, parse the whole file again, and revalidate all three exact commands and hashes before retrying.

After revalidating ownership, close only the failed role pane proven to have been created by this recorded startup attempt when replacement is necessary. If that proof is absent, do not close it; ask the user under the destructive-risk firewall. Create or launch only the failed role's missing or corrected pane and retry only that role. Do not close, relaunch, move, resize, reprompt, or otherwise disturb successful siblings. Reuse never resizes.

If a split response is ambiguous, do not guess which pane was created. Re-query safely, retain all evidence, and ask before any operation that could affect an unowned pane. Recovery ends only when all mappings and creation working directories are revalidated.

## Busy Reuse

For a reused session with busy agents, first determine whether the busy work matches the recorded in-flight turn. If it does, resume waiting under its original absolute deadline. If it does not, offer the user explicit choices for each affected role: wait another bounded interval; send Escape and preserve the pane for inspection; or replace the affected role pane. Do not require whole-session cleanup for a single busy role.

Replacement is `destructive_or_unrelated_risk`. Before it, revalidate project, source-pane, role, pane, and agent ownership; use the same exact configured command and its recorded hash; close only that affected role pane; and leave every sibling unchanged.

Never steal a busy pane, overwrite its report, submit a second prompt blindly, or reset its state merely to make progress. If the user declines interruption or replacement, leave the session unchanged and stop the Herdr path cleanly.
