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

## Reproducibility prerequisites and action manifest

Before attach or any mutation, the operator must supply and record three exact harmless test-owned recognized agent commands that require no production credentials. The operator must also supply and record the exact supported main-agent/controller launch and Magi invocation method for the installed environment. Do not invent agent commands, claim that a command is installed without evidence, or add a new runner.

The supplied evidence must show that each of the three agent commands was already validated in disposable isolated panes: it started without production credentials, became a recognized agent, accepted a harmless prompt, and exited or was cleaned up without affecting unrelated state. Record the exact command, installed agent kind, validation time, and exact JSON evidence.

Before the scenarios, record an action manifest with an exact, harmless test-owned failure-injection method and expected evidence for every case below:

- invalid command using `false` or another explicitly recorded exiting command;
- unrecognized non-agent command;
- blocked UI;
- missing-report first failure and missing-report second failure;
- timeout;
- config drift;
- busy state;
- ownership ambiguity; and
- cleanup partial failure.

Each method and its expected evidence must be recorded before any scenario starts. If any command, launch method, invocation method, failure-injection method, or expected result is missing, mark the procedure BLOCKED before mutation. Do not substitute a similar command.

Populate the test-only Magi configuration values from the three recorded commands. Launch the recorded main-agent/controller and invoke Magi through the recorded method provided by the installed Magi skill. This procedure uses the installed skill directly and creates no new runner.

## Session ownership preflight and attach

From the dedicated external terminal, export a unique isolated session name and a unique owner token, then inventory sessions before attach:

```sh
export HERDR_TEST_SESSION="open-magi-itest-$(date +%Y%m%d%H%M%S)-$$"
export HERDR_TEST_OWNER="open-magi-owner-$(date +%Y%m%d%H%M%S)-$$"
herdr session list --json
```

The `herdr session list --json` evidence taken before attach must prove that the exact `$HERDR_TEST_SESSION` name is absent. Record that preflight evidence with its timestamp and owner token in the external temporary report. On any collision, generate a new unique name and repeat the inventory, or abort. Never attach an existing session.

Only after the absence proof, attach the exact exported name. Record the exact interactive attach outcome separately; attach is interactive and is not expected to produce a JSON response:

```sh
herdr session attach "$HERDR_TEST_SESSION"
```

Because both values are exported, the attach process and its new named shell inherit them. Immediately after attach, verify their values rather than assuming a cross-shell handoff succeeded:

```sh
test "${HERDR_ENV:-}" = 1
test -n "${HERDR_TEST_SESSION:-}" || exit 1
test -n "${HERDR_TEST_OWNER:-}" || exit 1
herdr session list --json
herdr pane current --current
```

JSON ownership evidence comes solely from the pre-attach session list and the post-attach session list, supplemented by the post-attach current pane and context JSON or output supported by live help. Perform every remaining scenario action only inside that exact named shell. Before any scenario mutation, match `$HERDR_TEST_SESSION` and `$HERDR_TEST_OWNER` against the preflight record and post-attach ownership evidence, prove the active socket or exact session context belongs to the newly created named session, and record the ownership evidence. Also prove no discovered target belongs to the current/default/developer session. If `HERDR_ENV=1`, either exported value, the expected named session context, or the ownership evidence does not match, abort without mutation. Never redirect the test to an existing session.

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
5. Submit a harmless prompt to that discovered agent. After submission, require observed activity such as working or blocked as appropriate, followed by a later settled state of idle or done. This is an OR condition: either later settled state is sufficient, and the procedure must never require idle followed by done. A settled pane without submission-following observed activity is not completion.
6. Validate a report that begins directly with this exact canonical envelope in this exact key order, substituting recorded values only. The existing required Magi report body follows the separator immediately:

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
<existing required Magi report body>
```

Require `completed_at >= submitted_at`, the expected identity fields, the current turn, and the exact predeclared report path. Record the complete report and its validation result. Repeat only with the other available harmless test-owned recognized agent commands if they are required by later scenarios.

## Scenario 2: layout and reuse

Create the controller/worker layout in the isolated session only, using live-help-supported no-focus splits and IDs returned by JSON. Execute this exact geometric sequence: split at ratio `0.5` to create the council region on the right; split that region down at ratio `0.6666667` to separate the lower third; then split the upper two-thirds down at ratio `0.5`. Verify the split tree and resulting order from JSON: the controller stays left, the right council region is at most half of the available width, and the roles are Melchior top, Balthasar middle, and Casper bottom. Record each pane's rect JSON. Permit unavoidable one-cell rounding in the three role heights, requiring `max(height) - min(height) <= 1 cell`; do not require pixel or integer identity. Assert that focus did not move.

Record all pane sizes. Manually resize one owned role pane, run another deliberation pass, and assert that all healthy recognized agents are reused and the manual resize is preserved. Perform no resize on the next pass. Record JSON layout and identity evidence before and after the pass.

## Scenario 3: invalid or unrecognized configuration

In test-owned configuration only, provide an invalid or unrecognized command for one role. Assert that the controller asks a user question instead of guessing. Exercise the authorized answer that causes an automatic config update, then verify only that role is retried. If startup created a failed-role pane and ownership is proven, replace only that failed role pane; healthy siblings and their sizes must remain unchanged. Assert that no fallback transport or model is used.

Also exercise refusal or cancellation of the question. It must leave the invalid role unresolved. On this branch, the test-owned configuration, panes, and agents remain unchanged; perform no retry and use no native fallback.

## Scenario 4: parallel work and failures

Submit three role prompts concurrently and record three submission timestamps before waiting. Enforce the frozen absolute deadline; do not extend it per agent. Validate success only after each role has submission-following observed activity, such as working or blocked as appropriate, followed later by a settled state of idle or done and a valid current-turn report. Idle or done is an OR condition, not a sequence.

For a test-owned timeout, send `Esc` using the live supported agent input command, record timeout status, and stop waiting at the absolute deadline. Exercise a blocked UI and prove the controller reports it rather than treating idle as done. When a completed agent has a missing or invalid report for the same turn, prompt the same discovered agent exactly once for that report. This is a single retry: preserve the frozen baseline and do not blindly resubmit the original task. A second missing or invalid report becomes `status: "hard_error"`; halt the scenario and perform no synthesis.

## Scenario 5: persistence, drift, firewall, and recovery

Run these cases against test-owned state in the isolated session:

- Change test configuration after agents exist. Detect config drift and exercise each offered decision: continue with the recorded agents, explicit cleanup, and denied cleanup. Continue must preserve the existing recorded identities. Cleanup may affect only proven-owned subordinates. Denied cleanup must leave panes, agents, configuration, and unrelated state untouched.
- Cause a harmless test agent to ask a question that the question firewall classifies as denied. Record the denial and prove the filesystem, commands, credentials, configuration, panes, agents, and unrelated sessions remain untouched. This is zero pane or agent mutation and no synthesis.
- Restore a recoverable state with `inFlight` set and sufficient recorded identity, prompt, deadline, and report-path information. Assert that recovery resumes the original turn with the original absolute deadline. It must not duplicate or resubmit the prompt.
- Mark a recorded agent busy. Exercise busy reuse decisions to wait, send `Esc`, replace the proven-owned affected role, and select the denied action. Denial must not mutate state; replacement must not affect healthy siblings.
- Exercise missing state by removing session state while leaving deterministic agent names and reconstructable pane, workspace, source-command, creation-working-directory, and pane-ID relationships. Assert deterministic reconstruction. Then remove one ownership fact to make the case ambiguous and assert refusal without mutation.

## Scenario 6: explicit and partial cleanup

Request explicit cleanup and prove it closes only subordinate panes whose ownership by this isolated run is established. The test configuration remains. All unrelated sessions, panes, agents, and files survive.

Inject one close failure. Assert that successful owned closures are recorded, the failed owned subordinate remains listed, and the persisted state remains unresolved for later retry. Do not erase or report complete cleanup while that partial failure exists. Compare exact JSON inventories with the frozen baseline.

## Teardown

Before teardown, write exact JSON inventories and identify only the unique isolated session and test-owned subordinate resources. Re-match the owner token, exact session name, and active socket or session context against the external preflight record and post-attach ownership evidence. Require evidence that the session was created by this run. If any ownership field is absent, ambiguous, or mismatched, refuse teardown without issuing stop or delete.

Validate the name and owner token as nonempty, validate both exact prefixes, and do this before either destructive command:

```sh
test -n "${HERDR_TEST_SESSION:-}" || exit 1
case "$HERDR_TEST_SESSION" in
  open-magi-itest-*) ;;
  *) exit 1 ;;
esac
test -n "${HERDR_TEST_OWNER:-}" || exit 1
case "$HERDR_TEST_OWNER" in
  open-magi-owner-*) ;;
  *) exit 1 ;;
esac
```

Re-read the JSON inventory and require one exact session-name match for `$HERDR_TEST_SESSION`, the same owner evidence, and the expected context. Abort teardown if the match is absent, duplicated, or associated with an unexpected socket/context. Stop and delete only that unique session:

```sh
herdr session stop "$HERDR_TEST_SESSION" --json
herdr session delete "$HERDR_TEST_SESSION" --json
```

Record both exact JSON responses. Fetch final JSON inventories and verify the isolated session is absent while every unrelated baseline entry survives. Confirm the temporary report is outside tracked paths and repository status has no scenario artifacts. Never generalize these commands to another session name.
