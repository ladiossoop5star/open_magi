# Herdr Runtime Reference

Use this contract when `HERDR_ENV=1`. Apply it before any runtime-specific setup. The installed Herdr skill and live `herdr help` output are authoritative for current command syntax and response fields. Do not add a runner. Do not silently fall back to native agents, tmux, subprocesses, or another transport when Herdr selection, setup, launch, or recovery fails.

## Selection and Preflight

Require nonempty `HERDR_WORKSPACE_ID`, `HERDR_TAB_ID`, and `HERDR_PANE_ID`. Before any split, call `herdr pane current --current` and capture the source main pane ID and its creation working directory from the response. Treat that captured directory, resolved with `realpath`, as `projectRoot` and as the working directory for every created pane.

The config path is the absolute `<captured-cwd>/.open-magi-herdr`, which may be below the repository root. Before setting `state.active=true` or creating, reading, or updating that file, determine whether the captured directory is in Git. From that directory run `git rev-parse --show-toplevel`, `git rev-parse --show-prefix`, and `git rev-parse --git-path info/exclude`. Form an anchored repository-relative ignore pattern as `/<show-prefix>.open-magi-herdr`, escaping Git-ignore metacharacters in the prefix as needed. An empty prefix yields `/.open-magi-herdr`; a `packages/app/` prefix yields `/packages/app/.open-magi-herdr`. Append that exact pattern idempotently to the resolved repository-local exclude file, then validate the actual absolute config path with `git check-ignore --no-index --quiet -- <absolute-config-path>`. If validation fails, stop before writing command content or continuing. Linked worktrees may share repository exclusion state; do not claim or assume a per-worktree exclude file.

In Git and non-Git directories, create and maintain `.open-magi-herdr` with restrictive owner-only mode, `0600` where supported. Verify ownership, regular-file identity, and mode before writing command content and before every read or update. For creation or replacement, create a same-directory temporary regular file exclusively with mode `0600`, verify it before writing, then atomically rename and verify the destination again. An insecure existing mode makes it an invalid config: correct permissions safely only when current-file ownership is proven, otherwise stop and ask the user; never read or continue first. Outside a Git repository, there is no exclude step, so the user must also protect the file manually from copying, backup leakage, or disclosure.

After those gates, read the absolute config path. If it is missing or invalid, ask the user for the command configuration, write it without echoing values, revalidate permissions and exclusion when applicable, and read it back to validate contents. Commands must contain no tokens, credentials, or other secrets. Never infer a launch command from runtime configuration, an agent name, PATH conventions, or an earlier report.

## Launch Configuration

`.open-magi-herdr` contains exactly one nonempty command for each key `melchior`, `balthasar`, and `casper`. Ignore blank lines and lines whose first non-whitespace character is `#`. Split each other line on the first `=` only, trim the key and value, and preserve the remainder of the value as the exact command. Reject duplicate keys, unknown keys, missing keys, malformed lines, and empty values.

Raw commands never appear in reports, logs, prompts, state history, or general diagnostics. The sole user-visible exception is the targeted correction question for a failed role under Partial Startup and Recovery: show the exact configured command only to the user and warn that it must contain no secrets. Otherwise store and compare only the lowercase hexadecimal SHA-256 digest of each exact command, computed over its UTF-8 bytes. Commands remain only in `.open-magi-herdr`, the immediate `herdr pane run` invocation, and that one correction question.

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

Launch three concurrent invocations of `herdr agent prompt <name> <prompt> --wait --timeout <remaining-ms>`, one per sage, against one absolute deadline. Calculate each `<remaining-ms>` from that same deadline immediately before launch; never submit sequentially or grant a fresh deadline. Use the runtime tool's structured capture and an atomic controller write, or safely quoted temporary-file stdout redirection followed by atomic rename, to capture each invocation's stdout/result JSON directly into that role's predeclared `waitResultPath`. Record the exit status and process handle separately. Do not add a runner, log the raw prompt, expose raw configured commands, or copy report contents into the wait artifact.

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

Freeze the exact `controllerMutablePaths` for that turn. Before submit, enumerate the complete allowlist as concrete absolute paths: the three assigned report paths; `.open_magi/magi-log/state.json`; `.open_magi/magi-log/herdr-session.json`; `.open_magi/magi-log/question-request.md`; `.open_magi/magi-log/question-denied.md`; `.open_magi/magi-log/plugin-error.log`; and the exact predeclared wait-result paths, exactly three wait-result paths with one `waitResultPath` per sage. A category, directory, glob, convention, or path discovered after submit is not an allowlist entry. No other path is allowed, and the list must not expand after prompts start.

An allowed path does not prove who wrote it. After every expected controller write to a controller-owned mutable file, record the intended digest and, where structured, the intended canonical content or schema-relevant values. For every wait-result file, record and later verify the expected command identity without its raw prompt or configured command, its exit-status association, result schema, and digest; reject raw prompts, configured commands, or report bodies in that file. After all prompts settle, compare the workspace against the frozen fingerprint and verify every controller-owned file exactly against its last recorded intended digest, content, and schema. Validate each of the three agent report files only through its matching envelope, timestamps, turn identity, assigned path, and required body content. Any unexpected content or digest on an allowed path blocks synthesis, as does any path delta outside the allowlist, including an unexpected file under `.open_magi/`.

## Partial Startup and Recovery

If startup succeeds for only some roles, preserve live validated siblings and record the partial mapping and failure atomically. In the targeted correction question, show the user the affected role's exact configured command with the no-secrets warning. Treat captured pane output as credential-sensitive: perform a credential-safe review, redact tokens, credentials, and unrelated private data before showing necessary output to the user, and never persist unredacted output in reports or logs. Classify the correction question as `execution_blocker` and ask for the corrected command. Update `.open-magi-herdr` through the permission and exclusion gates, parse the whole file again, and revalidate all three exact commands and hashes before retrying.

After revalidating ownership, close only the failed role pane proven to have been created by this recorded startup attempt when replacement is necessary. If that proof is absent, do not close it; ask the user under the destructive-risk firewall. Create or launch only the failed role's missing or corrected pane and retry only that role. Do not close, relaunch, move, resize, reprompt, or otherwise disturb successful siblings. Reuse never resizes.

If a split response is ambiguous, do not guess which pane was created. Re-query safely, retain all evidence, and ask before any operation that could affect an unowned pane. Recovery ends only when all mappings and creation working directories are revalidated.

## Busy Reuse

For a reused session with busy agents, first determine whether the busy work matches the recorded in-flight turn. If it does, resume waiting under its original absolute deadline. If it does not, offer the user explicit choices for each affected role: wait another bounded interval; send Escape and preserve the pane for inspection; or replace the affected role pane. Do not require whole-session cleanup for a single busy role.

Replacement is `destructive_or_unrelated_risk`. Before it, revalidate project, source-pane, role, pane, and agent ownership; use the same exact configured command and its recorded hash; close only that affected role pane; and leave every sibling unchanged.

Never steal a busy pane, overwrite its report, submit a second prompt blindly, or reset its state merely to make progress. If the user declines interruption or replacement, leave the session unchanged and stop the Herdr path cleanly.
