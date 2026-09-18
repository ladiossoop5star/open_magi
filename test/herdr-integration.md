# Herdr Integration Procedure

This procedure validates the Herdr transport without touching a current, default, or developer session or any of their panes. Never touch current, default, or developer sessions or panes. Run it only in a unique named isolated session. Interactive attachment is allowed only from a dedicated external terminal, not from the current developer Herdr pane. Stop if that terminal is not available.

## Safety boundary and evidence

Use only harmless test-owned commands that are known to become recognized Herdr agents and require no production credentials. Do not load tokens, production configuration, or production data. Do not hardcode pane, agent, session, or turn IDs: discover every ID from live JSON output and carry it forward exactly.

Before the scenario, create a temporary test report outside the repository and all other tracked paths, for example with `mktemp`. Append the exact command, exact JSON response, timestamp, and assertion result for every assertion. Preserve JSON as returned; a prose summary is not evidence. Record an initial inventory and a final inventory so unrelated sessions, panes, and agents can be compared.

First discover the installed interface:

```sh
herdr --help
herdr pane --help
herdr agent --help
herdr session --help
```

The live help is authoritative. Use only commands and flags supported by that help. The command fragments below name the required operations; adjust nonessential argument placement to the live help rather than guessing.

From the dedicated external terminal, assign the isolated name and attach it:

```sh
HERDR_TEST_SESSION="open-magi-itest-$(date +%Y%m%d%H%M%S)-$$"
herdr session attach "$HERDR_TEST_SESSION"
```

Perform every remaining scenario action only inside that exact named session. Before any scenario mutation, assert and record that `HERDR_ENV=1`, the active socket or session context is exactly the expected named session context for `$HERDR_TEST_SESSION`, and no discovered target belongs to the current/default/developer session. If `HERDR_ENV=1` is absent or the named socket or session context does not match, abort without mutation. Never redirect the test to an existing session.

Freeze these baselines in the external temporary report:

- Full JSON inventories of sessions, panes, and agents using the live help's JSON form.
- The isolated session identity and its initially owned panes.
- Repository status, configuration digest, layout, pane sizes, and the allowed test-owned paths.
- An absolute deadline for the run and the exact paths expected to contain reports.

## Scenario 1: raw command to recognized agent

1. In the isolated session, split a pane with the repository working directory. Capture the created pane ID from JSON; do not infer it from position.
2. Use `herdr pane run` with that pane ID to launch one harmless test wrapper from the verified working directory. The wrapper must be one of the three available test-owned recognized agent commands and must not require credentials.
3. Poll the live JSON form of `herdr agent get` for the captured pane ID until the raw command is recognized as an agent. Record the pane-to-agent relationship.
4. Rename the recognized agent deterministically with the live equivalent of `herdr agent rename <pane-id> <deterministic-test-name>`. Derive the name from the role and isolated run identity, and record it rather than hardcoding the ID.
5. Submit a harmless prompt to that discovered agent. Record the transition from prompt submission to activity, then idle, then done. A merely idle pane without observed submission and activity is not completion.
6. Validate a report with exactly this front-matter envelope, substituting recorded values only:

```text
---
transport: herdr
report_source: herdr_agent
status: ok
failure_type: none
sage: melchior | balthasar | casper
agent: <recorded deterministic name>
turn_id: <recorded turn id>
round: <positive integer>
mode: recon | decision | review
pass: <positive integer>
submitted_at: <ISO-8601>
completed_at: <ISO-8601>
---
```

Require `completed_at >= submitted_at`, the expected identity fields, the current turn, and the exact predeclared report path. Record the complete report and its validation result. Repeat only with the other available harmless test-owned recognized agent commands if they are required by later scenarios.

## Scenario 2: layout and reuse

Create the controller/worker layout in the isolated session only. Split the council region at ratio `0.5` on the right, then form equal stacked thirds for Melchior at the top, Balthasar in the middle, and Casper at the bottom. Use the live help's no-focus option for every split and assert from JSON that focus did not move.

Record all pane sizes. Manually resize one owned role pane, run another deliberation pass, and assert that all healthy recognized agents are reused and the manual resize is preserved. Perform no resize on the next pass. Record JSON layout and identity evidence before and after the pass.

## Scenario 3: invalid or unrecognized configuration

In test-owned configuration only, provide an invalid or unrecognized command for one role. Assert that the controller asks a user question instead of guessing. Exercise the authorized answer that causes an automatic config update, then verify only that role is retried. If startup created a failed-role pane and ownership is proven, replace only that failed role pane; healthy siblings and their sizes must remain unchanged. Assert that no fallback transport or model is used.

Also exercise refusal or cancellation of the question. It must leave the invalid role unresolved without silently changing configuration, launching an alternative, or falling back.

## Scenario 4: parallel work and failures

Submit three role prompts concurrently and record three submission timestamps before waiting. Enforce the frozen absolute deadline; do not extend it per agent. Validate success only after each role has observed submission, activity, idle, done, and a valid current-turn report.

For a test-owned timeout, send `Esc` using the live supported agent input command, record timeout status, and stop waiting at the absolute deadline. Exercise a blocked UI and prove the controller reports it rather than treating idle as done. When a completed agent has a missing report, prompt the same discovered agent exactly once for the missing report. This is a single retry: preserve the frozen baseline and do not blindly resubmit the original task. A second missing or invalid report is a hard failure.

## Scenario 5: persistence, drift, firewall, and recovery

Run these cases against test-owned state in the isolated session:

- Change test configuration after agents exist. Detect config drift and exercise each offered decision: continue with the recorded agents, explicit cleanup, and denied cleanup. Continue must preserve the existing recorded identities. Cleanup may affect only proven-owned subordinates. Denied cleanup must leave panes, agents, configuration, and unrelated state untouched.
- Cause a harmless test agent to ask a question that the question firewall classifies as denied. Record the denial and prove the filesystem, commands, credentials, configuration, panes, and unrelated sessions remain untouched.
- Restore a recoverable state with `inFlight` set and sufficient recorded identity, prompt, deadline, and report-path information. Assert that recovery resumes observation of the existing turn without duplicate submission.
- Mark a recorded agent busy. Exercise busy reuse decisions to wait, send `Esc`, replace the proven-owned affected role, and select the denied action. Denial must not mutate state; replacement must not affect healthy siblings.
- Exercise missing state by removing session state while leaving deterministic agent names and reconstructable pane, workspace, source-command, creation-working-directory, and pane-ID relationships. Assert deterministic reconstruction. Then remove one ownership fact to make the case ambiguous and assert refusal without mutation.

## Scenario 6: explicit and partial cleanup

Request explicit cleanup and prove it closes only subordinate panes whose ownership by this isolated run is established. The test configuration remains. All unrelated sessions, panes, agents, and files survive.

Inject one close failure. Assert that successful owned closures are recorded, the failed owned subordinate remains listed, and the persisted state remains unresolved for later retry. Do not erase or report complete cleanup while that partial failure exists. Compare exact JSON inventories with the frozen baseline.

## Teardown

Before teardown, write exact JSON inventories and identify only the unique isolated session and test-owned subordinate resources. Validate the name as nonempty and validate its exact `open-magi-itest-` prefix before either destructive command:

```sh
test -n "${HERDR_TEST_SESSION:-}" || exit 1
case "$HERDR_TEST_SESSION" in
  open-magi-itest-*) ;;
  *) exit 1 ;;
esac
```

Re-read the JSON inventory and require one exact session-name match for `$HERDR_TEST_SESSION`. Abort teardown if the match is absent, duplicated, or associated with an unexpected socket/context. Stop and delete only that unique session:

```sh
herdr session stop "$HERDR_TEST_SESSION" --json
herdr session delete "$HERDR_TEST_SESSION" --json
```

Record both exact JSON responses. Fetch final JSON inventories and verify the isolated session is absent while every unrelated baseline entry survives. Confirm the temporary report is outside tracked paths and repository status has no scenario artifacts. Never generalize these commands to another session name.
