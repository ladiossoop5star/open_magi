# Herdr Runtime Reference

Use this contract when `HERDR_ENV=1`. Apply it before any runtime-specific setup. The installed Herdr skill and live `herdr help` output are authoritative for current command syntax and response fields. Do not add a runner. Do not silently fall back to native agents, tmux, subprocesses, or another transport when Herdr selection, setup, launch, or recovery fails.

## Selection and Preflight

Require nonempty `HERDR_WORKSPACE_ID`, `HERDR_TAB_ID`, and `HERDR_PANE_ID`. Before any split, call `herdr pane current --current` and capture the source main pane ID and its creation working directory from the response. Treat that captured directory, resolved with `realpath`, as `projectRoot` and as the working directory for every created pane.

Before setting `state.active=true`, read `<captured-cwd>/.open-magi-herdr`. If it is missing or invalid, ask the user for the configuration, write a valid file, and read it back to revalidate it. If the captured directory is in a Git repository, resolve the repository-local exclude file with `git rev-parse --git-path info/exclude`, then append the exact root-relative `/.open-magi-herdr` entry only if it is absent. Linked worktrees may share repository exclusion state; do not claim or assume a per-worktree exclude file. Outside a Git repository, skip exclusion. Never infer a launch command from runtime configuration, an agent name, PATH conventions, or an earlier report.

## Launch Configuration

`.open-magi-herdr` contains exactly one nonempty command for each key `melchior`, `balthasar`, and `casper`. Ignore blank lines and lines whose first non-whitespace character is `#`. Split each other line on the first `=` only, trim the key and value, and preserve the remainder of the value as the exact command. Reject duplicate keys, unknown keys, missing keys, malformed lines, and empty values.

Do not put raw commands in reports, logs, prompts, state history, or routine user-visible diagnostics. Store and compare only the lowercase hexadecimal SHA-256 digest of each exact command, computed over its UTF-8 bytes. The commands themselves remain only in `.open-magi-herdr`, the immediate `herdr pane run` invocation, and the explicit failed-role correction question required under Partial Startup and Recovery.

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

Build one prompt per sage. Each prompt includes the common council prompt, that sage's role instructions, round, council mode, pass, a unique turn ID, the absolute assigned report path, the exact report envelope below, and an instruction to write only its assigned report. Before submission, freeze `controllerMutablePaths` and the workspace fingerprint described below.

Submit three concurrent invocations of `herdr agent prompt ... --wait`, one per sage, under one absolute deadline. Never submit them sequentially and never give each invocation a fresh deadline. Record each submission time and its exact wait-result path. A role is complete only when the wait/result lifecycle observes submission-following activity for that agent before accepting a later `idle` or `done` state; a pre-existing settled state is not evidence of work. Its assigned report must also be fresh, carry the expected `turn_id`, and satisfy `completed_at >= submitted_at` using the envelope timestamps for that submission. During a turn the main controller may perform only worktree operations proven read-only; if an operation's write behavior is uncertain, wait.

## State Ownership

The main controller owns all runtime fields in `.open_magi/magi-log/state.json`. Before submitting prompts, it atomically sets and thereafter maintains `inFlight`, `inFlightSince`, `lastPromptedRound`, `lastPromptedAt`, `activeDeliberators`, and `deliberatorTimeoutCounts`. Set `inFlight=true`, timestamp `inFlightSince` and `lastPromptedAt`, set `lastPromptedRound`, and write all three `activeDeliberators` entries before any prompt can start. Each entry contains `agent`, `sessionID` or stable Herdr agent identity, `transport: "herdr"`, `paneID`, `round`, `mode`, `pass`, `turnID`, absolute `reportPath`, `startedAt`, common `deadlineAt`, and `status: "running"`. Preserve prior timeout counts and increment the affected sage's `deliberatorTimeoutCounts` value on every timeout.

`herdr-session.json` supplements these runtime fields; it is not their replacement. Persist its turn lock only after the atomic `state.json` write. Record the same turn identity, deadline, report paths, exact wait-result paths, and frozen `controllerMutablePaths` and workspace fingerprint there.

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

Freeze the exact `controllerMutablePaths` for that turn. Before submit, enumerate the complete allowlist as concrete absolute paths: the three assigned report paths; `.open_magi/magi-log/state.json`; `.open_magi/magi-log/herdr-session.json`; `.open_magi/magi-log/question-request.md`; `.open_magi/magi-log/question-denied.md`; `.open_magi/magi-log/plugin-error.log`; and each exact predeclared wait-result path used by the three `--wait` invocations under the runtime's existing wait-result artifact convention. A category, directory, glob, or path discovered after submit is not an allowlist entry. No other path is allowed, and the list must not expand after prompts start.

An allowed path does not prove who wrote it. After every expected controller write to a controller-owned mutable file, record the intended digest and, where structured, the intended canonical content or schema-relevant values. After all prompts settle, compare the workspace against the frozen fingerprint and verify every controller-owned file exactly against its last recorded intended digest, content, and schema. Validate each of the three agent report files only through its matching envelope, timestamps, turn identity, assigned path, and required body content. Any unexpected content or digest on an allowed path blocks synthesis, as does any path delta outside the allowlist, including an unexpected file under `.open_magi/`.

## Partial Startup and Recovery

If startup succeeds for only some roles, preserve live validated siblings and record the partial mapping and failure atomically. Show the user the affected role's exact configured command and captured pane output, classify the correction question as `execution_blocker`, and ask for the corrected command. Update `.open-magi-herdr`, parse the whole file again, and revalidate all three exact commands and hashes before retrying.

After revalidating ownership, close only the failed role pane proven to have been created by this recorded startup attempt when replacement is necessary. If that proof is absent, do not close it; ask the user under the destructive-risk firewall. Create or launch only the failed role's missing or corrected pane and retry only that role. Do not close, relaunch, move, resize, reprompt, or otherwise disturb successful siblings. Reuse never resizes.

If a split response is ambiguous, do not guess which pane was created. Re-query safely, retain all evidence, and ask before any operation that could affect an unowned pane. Recovery ends only when all mappings and creation working directories are revalidated.

## Busy Reuse

For a reused session with busy agents, first determine whether the busy work matches the recorded in-flight turn. If it does, resume waiting under its original absolute deadline. If it does not, offer the user explicit choices for each affected role: wait another bounded interval; send Escape and preserve the pane for inspection; or replace the affected role pane. Do not require whole-session cleanup for a single busy role.

Replacement is `destructive_or_unrelated_risk`. Before it, revalidate project, source-pane, role, pane, and agent ownership; use the same exact configured command and its recorded hash; close only that affected role pane; and leave every sibling unchanged.

Never steal a busy pane, overwrite its report, submit a second prompt blindly, or reset its state merely to make progress. If the user declines interruption or replacement, leave the session unchanged and stop the Herdr path cleanly.
