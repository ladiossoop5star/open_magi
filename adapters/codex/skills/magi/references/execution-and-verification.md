# Execution and Verification Reference

Use this for Phase 5, verification failure, checkpoint commits, rollback, and
next-round evidence handoff.

## Failure Diagnostic Gate

Diagnostic commands are evidence collection for the next deliberation round, not
extra Phase 2 research.

If a sub-agent report or the main agent identifies data needed only after a
failed attempt, write it into `verdict.md` as `failure_diagnostic_commands`.
Only run these commands after verification fails. Do not run them when
verification passes.

Phase 5 executes verification and failure diagnostics. Phase 6 only judges pass/fail, updates state, and prepares the next round.

When verification fails:
- run the applicable `failure_diagnostic_commands`;
- write their command, exit code, and important output into `verification.md`;
- summarize the collected evidence in the Phase 6 history entry.

The next Phase 2 `research-prompt.md` must include a section named
`Diagnostic evidence from the previous failed round` when such evidence exists.
Pass that evidence to all three deliberators through the shared prompt.

## Phase 5: Execute and Verify

Only the main agent may act.

1. Apply the verdict.
2. Do not overwrite unrelated user changes.
3. If code changed, run build or compile verification first.
4. If code changed and build succeeds, create a local git checkpoint commit and record its hash.
5. If build fails, do not commit; record failure evidence and mark next-round rollback before Phase 2.
6. Run remaining `verificationCommand` entries.
7. If verification fails, run the applicable `failure_diagnostic_commands`.
8. Write `verification.md` with command, exit code, important output, and any
   failure diagnostic evidence.
9. Decide whether acceptance criteria are now satisfied.

## Checkpoint and Rollback Details

If Phase 5 changes code and build succeeds, create a local git checkpoint commit.
Stage only files changed by the main agent for this round. Never commit runtime
logs or unrelated user changes. Record `checkpoint_commit` in `verification.md`.

If build fails before a checkpoint commit:
- do not commit;
- record failure evidence;
- revert this round's uncommitted code changes before writing the next
  `research-prompt.md`;
- pass failure output and rollback evidence to the next council pass.

If build succeeds but later runtime verification fails:
- keep the checkpoint commit;
- pass the commit hash and failure evidence to the next round;
- the next `verdict.md` must explicitly choose either continue from the
  checkpoint or revert the checkpoint commit.
