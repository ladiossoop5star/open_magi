# OpenCode Runtime Reference

Use this when launching deliberator subagents, interpreting OpenCode runtime
events, or handling Magi plugin backstops.

## Deliberator Launch

Use the configured OpenCode subagents:
- `deliberator-melchior`
- `deliberator-balthasar`
- `deliberator-casper`

Launch all three with the same council prompt. Do not replace them with the
main agent unless the runtime cannot launch subagents; if fallback is required,
write the reason in `synthesis.md` and keep the required report file names.

## Timeout Enforcement

OpenCode does not provide a per-subtask timeout field. The Magi plugin records
`session.created` events for child sessions whose agent is one of the three
deliberators, then calls OpenCode `session.abort` after
`deliberatorTimeoutMs`.

Default timeout is 30 minutes per deliberator child session. Timeout handling
is per council pass. If the plugin writes a timeout report, treat it as a real
deliberator report with `stance: needs_evidence` and preserve the evidence in
`synthesis.md`.

## Hard Error Enforcement

OpenCode emits `session.error` for provider, auth, model, context, and other
child-session failures. If that event belongs to a running deliberator child
session, the Magi plugin writes a `status: hard_error` report with
`failure_type: hard_error`, sets the loop to `currentPhase=blocked`,
`active=false`, and tells the main agent to report the exact repair target to
the user.

Do not continue synthesis after a `hard_error`. Fix the deliberator runtime
configuration first, usually `~/.config/opencode/opencode.json` or the
configured provider/model credentials.

## Runtime Backstops

The OpenCode plugin may repair missing artifacts, deny procedural questions,
resume active loops, and recover corrupt `state.json` files. If the plugin
writes a repair prompt, follow it and update the Magi artifacts before moving
to the next phase. If corrupt state repair repeats, the plugin writes
`state-repair-blocked.md` and stops repeated repair prompts until `state.json`
is manually repaired.
