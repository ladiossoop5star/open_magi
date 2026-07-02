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

If the plugin says an external command runner is handling a sage, do not launch
the OpenCode subtask for that sage. Wait for the corresponding report file or
continue with any remaining OpenCode-mode deliberators named by the plugin.

## External Command Deliberators

The OpenCode plugin can run a deliberator through a user-defined command in
`~/.config/opencode/open_magi.json` instead of an OpenCode subagent. The plugin
passes the council prompt on stdin, sets `OPEN_MAGI_PROMPT_FILE`,
`OPEN_MAGI_REPORT_FILE`, `OPEN_MAGI_SAGE`, `OPEN_MAGI_ROUND`, and
`OPEN_MAGI_PASS`, then writes stdout to the correct report file. If the command
writes `OPEN_MAGI_REPORT_FILE` itself, the plugin preserves that file.

Failed or timed-out external commands still produce a report file with
`stance: needs_evidence` and `blocking_objection: yes`. Do not ask the user what
to do after an external command failure; synthesize the failure report through
the normal Council Pass Gate.

## Timeout Enforcement

OpenCode does not provide a per-subtask timeout field. The Magi plugin records
`session.created` events for child sessions whose agent is one of the three
deliberators, then calls OpenCode `session.abort` after
`deliberatorTimeoutMs`. For external command deliberators, the plugin kills the
command process after the same timeout and writes a timeout report.

Default timeout is 30 minutes per deliberator child session. Timeout handling
is per council pass. If the plugin writes a timeout report, treat it as a real
deliberator report with `stance: needs_evidence` and preserve the evidence in
`synthesis.md`.

## Runtime Backstops

The OpenCode plugin may repair missing artifacts, deny procedural questions,
resume active loops, and recover corrupt `state.json` files. If the plugin
writes a repair prompt, follow it and update the Magi artifacts before moving
to the next phase.
