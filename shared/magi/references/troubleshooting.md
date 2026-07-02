# Troubleshooting Reference

Use this when the plugin repairs artifacts, state is corrupt, deliberators time
out, or the loop repeatedly fails.

## Plugin Repair

When the plugin reports artifact integrity repair:
- read `state.json`;
- read `.open_magi/magi-log/checklist.md`;
- recreate the missing required artifact for the current phase;
- update `state.json` with the corrected phase and `needsContinue=true` when
  more work remains;
- do not ask whether the repair should be done.

If `state.json` is corrupt, the plugin backs it up as a `.corrupt-*.bak` file
and prompts repair. Rebuild state from existing Magi artifacts and repository
state, then continue from the safest valid phase.

## Common Mistakes

| Mistake | Correction |
|---|---|
| Finishing because the solution looks plausible | Finish only after verification commands satisfy acceptance criteria |
| Letting sub-agents edit files | Sub-agents research only; main agent acts |
| Reusing different prompts for the three deliberators | Use one identical research prompt per round |
| Forgetting `needsContinue=true` after partial progress | Set it before stopping so the plugin can wake the session |
| Setting `inFlight=true` from the main agent | Do not do this; the plugin owns the continuation lock |
| Asking whether to write required reports | Do not ask procedural questions; write the required artifact |
| Asking which role each deliberator should play | Use the fixed role table in this skill |
| Asking the user which debug direction to try after Phase 1 | Pick the direction from evidence unless verification is impossible or execution is blocked |
| Running diagnostics during Phase 2 | Put fail-only data collection in `failure_diagnostic_commands`, run it after verification fails, and pass the evidence to sub-agents next round |
| Leaving uncommitted failed build changes for the next deliberation | Record the failure, then revert this round's uncommitted code changes before writing the next research prompt |
| Committing runtime logs or unrelated files | Commit only this round's code changes; never stage `.open_magi/` |
| Waiting indefinitely for a deliberator | The plugin aborts timed-out child sessions; use the timeout report and continue the council gate |

## Repeated Failure

Use `consecutiveNoProgress` only when a round fails to reduce uncertainty or
move acceptance criteria closer. The loop may continue while progress exists.
When no progress reaches the limit, set `currentPhase=blocked`, `active=false`,
and write the blocker evidence clearly.
