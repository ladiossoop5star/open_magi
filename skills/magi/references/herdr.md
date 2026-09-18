# Herdr Runtime Reference

Use this contract when `HERDR_ENV=1`. Apply it before any runtime-specific setup. The installed Herdr skill and live `herdr help` output are authoritative for current command syntax and response fields. Do not add a runner. Do not silently fall back to native agents, tmux, subprocesses, or another transport when Herdr selection, setup, launch, or recovery fails.

## Selection and Preflight

Require nonempty `HERDR_WORKSPACE_ID`, `HERDR_TAB_ID`, and `HERDR_PANE_ID`. Before any split, call `herdr pane current --current` and capture the source main pane ID and its creation working directory from the response. Treat that captured directory, resolved with `realpath`, as `projectRoot` and as the working directory for every created pane.

Before setting `state.active=true`, read `<captured-cwd>/.open-magi-herdr`. If it is missing or invalid, ask the user for the configuration, write a valid file, and read it back to revalidate it. In a Git worktree, add only `.open-magi-herdr` to that worktree's `.git/info/exclude`; do not edit a shared global ignore file. Never infer a launch command from runtime configuration, an agent name, PATH conventions, or an earlier report.

## Launch Configuration

`.open-magi-herdr` contains exactly one nonempty command for each key `melchior`, `balthasar`, and `casper`. Ignore blank lines and lines whose first non-whitespace character is `#`. Split each other line on the first `=` only, trim the key and value, and preserve the remainder of the value as the exact command. Reject duplicate keys, unknown keys, missing keys, malformed lines, and empty values.

Do not put raw commands in reports, logs, prompts, state history, or user-visible diagnostics. Store and compare only the lowercase hexadecimal SHA-256 digest of each exact command, computed over its UTF-8 bytes. The commands themselves remain only in `.open-magi-herdr` and the immediate `herdr pane run` invocation.

## Layout and Startup

Starting from the captured source main pane:

1. Split the main pane right with ratio `0.5`, `--no-focus`, and the captured working directory. The new right pane is Melchior.
2. Split the original right pane down with ratio `2/3`, `--no-focus`, and the captured working directory. The new lower pane is Casper.
3. Split the remaining upper-right pane down with ratio `1/2`, `--no-focus`, and the captured working directory. The new lower pane is Balthasar, below Melchior.

Take every new pane ID from the split response and verify its creation working directory from that response. `herdr pane get` may be used as a second source, never as a substitute for validating the split result. Launch each configured raw command with `herdr pane run`; do not use `herdr agent start`.

Poll for at most 120 seconds for both pane survival and positive agent recognition. An unknown agent is not recognized. Rename recognized panes to `magi-<sage>-<hash10>`, where `<sage>` is `melchior`, `balthasar`, or `casper`. Compute `<hash10>` as the first ten lowercase hexadecimal characters of SHA-256 over the UTF-8 compact JSON serialization of `[realpath(projectRoot), workspaceId, sourceMainPaneId]`. A matching live name that is not proven to belong to this session is a collision with destructive risk: stop and ask the user; never take it over or close it automatically.

## Persistent Session State and Reuse

Persist session data atomically at `.open_magi/magi-log/herdr-session.json`. It records schema version, real project root, captured creation working directory, workspace ID, tab ID, source main pane ID, the role-to-pane and role-to-agent mappings, the exact-command SHA-256 hashes, pane names, creation time, last validation time, cleanup status, and any unresolved partial-startup or in-flight turn data.

Reuse only when the stored project root, creation working directory, workspace, tab, and source pane match and every mapped pane is live with the expected agent. A matching live reuse never resizes or rearranges panes. If command hashes drift, ask the user to choose continued reuse with the already-running commands or explicit cleanup and restart. Do not restart silently.

If session state is missing, reconstruct it only when each pane's deterministic name, workspace, source main pane association, and creation working directory all match. Otherwise treat the panes as unowned and ask the user.

## Concurrent Turn

If session state records an `inFlight` turn, resume and classify that turn before submitting anything new. Otherwise wait up to 60 seconds for all three agents to become idle or done. If any agent remains busy after that bound, treat it as stale-busy destructive risk and ask the user. A denied recovery leaves every pane and all state untouched.

Build one prompt per sage. Each prompt includes the common council prompt, that sage's role instructions, round, council mode, pass, a unique turn ID, the absolute assigned report path, the exact report envelope below, and an instruction to write only its assigned report. Before submission, freeze `controllerMutablePaths` and the workspace fingerprint described below.

Submit three concurrent invocations of `herdr agent prompt ... --wait`, one per sage, under one absolute deadline. Never submit them sequentially and never give each invocation a fresh deadline. A role is complete only when its agent is idle or done and its assigned report is fresh and has the matching envelope. During a turn the main controller may perform only worktree operations proven read-only; if an operation's write behavior is uncertain, wait.

## State Ownership

Before submitting prompts, atomically write all three entries under `state.activeDeliberators` and then persist the Herdr session turn lock. Each entry contains `agent`, `sessionID` or stable Herdr agent identity, `transport: "herdr"`, `paneID`, `round`, `mode`, `pass`, `turnID`, absolute `reportPath`, `startedAt`, common `deadlineAt`, and `status: "running"`. Also record `inFlight`, the same turn identity, deadline, report paths, and the frozen `controllerMutablePaths` and workspace fingerprint in `herdr-session.json`.

Native runtime handlers ignore entries whose transport is `herdr`; they must not replace, abort, timeout, or clear them. After all three roles are classified, atomically write final role statuses and clear the in-flight lock. Never clear the lock role-by-role while sibling prompts are unresolved.

## Report Envelope

Every successful assigned report starts with exactly these keys in this order, substituting the prompt's concrete values:

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

Apply the normal Magi question firewall to every Herdr question. Never answer a destructive-risk question on the user's behalf. Auth, model, context, tool, pane, agent-recognition, transport, and invalid-report failures are hard errors, not vetoes and not synthetic reports. Do not synthesize until all three reports are valid or the normal timeout policy explicitly permits a recorded timeout outcome.

On timeout, send Escape only to the affected recorded pane, wait for a bounded interval, preserve the pane and state for inspection, and classify the outcome. Do not blindly resend a prompt: first prove whether the original turn completed, remains busy, or was cancelled. Do not silently fall back to any other execution path.

## Explicit Cleanup

Cleanup is allowed only after an explicit user request. Re-read state and prove that it maps to the current real project root and captured source main pane. Revalidate every recorded subordinate pane before acting. Send Escape, wait a bounded interval, then use `herdr pane close` only on the recorded Melchior, Balthasar, and Casper panes. Closing a pane terminates its process, so it is always destructive.

Verify each recorded pane is absent before deleting `.open_magi/magi-log/herdr-session.json`. Preserve `.open-magi-herdr`. If any pane cannot be closed or its absence cannot be proved, retain state with the unresolved mapping and report partial cleanup; never erase evidence or close an unrecorded pane.

## Workspace Integrity

Before every concurrent turn, capture a workspace fingerprint that covers tracked changes, untracked paths, and file metadata or content hashes sufficient to detect changes. Fingerprint `.open_magi/` separately and recursively so allowed report writes cannot conceal other mutations.

Freeze the exact `controllerMutablePaths` for that turn. The complete allowlist is the three assigned report paths; `.open_magi/magi-log/state.json`; `.open_magi/magi-log/herdr-session.json`; `.open_magi/magi-log/question-request.md`; `.open_magi/magi-log/question-denied.md`; `.open_magi/magi-log/plugin-error.log`; and the wait-result files created under `.open_magi/magi-log/` by the runtime's existing wait-result artifact convention. No other path is allowed, and the list must not expand after prompts start.

After all prompts settle, compare against the frozen fingerprint. Permit only the assigned report-path writes and controller writes to the frozen allowed paths. Any other delta, including an unexpected file under `.open_magi/`, blocks synthesis until ownership is established or the user resolves it.

## Partial Startup and Recovery

If startup succeeds for only some roles, preserve live validated siblings and record the partial mapping and failure atomically. Correct only the failed role, create or launch only its missing pane, and retry only that role. Do not close, relaunch, move, resize, or reprompt healthy siblings. Reuse never resizes.

If a split response is ambiguous, do not guess which pane was created. Re-query safely, retain all evidence, and ask before any operation that could affect an unowned pane. Recovery ends only when all mappings and creation working directories are revalidated.

## Busy Reuse

For a reused session with busy agents, first determine whether the busy work matches the recorded in-flight turn. If it does, resume waiting under its original absolute deadline. If it does not, offer the user explicit choices: keep waiting, send Escape and preserve panes for inspection, or perform explicit cleanup. State the affected roles and destructive consequences without exposing raw commands.

Never steal a busy pane, overwrite its report, submit a second prompt blindly, or reset its state merely to make progress. If the user declines interruption or cleanup, leave the session unchanged and stop the Herdr path cleanly.
