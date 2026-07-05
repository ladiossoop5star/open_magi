# Claude Runtime Reference

Use this when launching Magi deliberator agents or handling Claude Code plugin
runtime behavior.

## Plugin Preflight

The Claude adapter is a native Claude Code plugin. It must provide:
- skill: `/open-magi:magi`
- agent: `open-magi:deliberator-melchior`
- agent: `open-magi:deliberator-balthasar`
- agent: `open-magi:deliberator-casper`
- Stop hook: `hooks/magi-stop`

If the skill is loaded but any named plugin agent is unavailable, stop before
Phase 0. Tell the user to load the plugin with `claude --plugin-dir
/path/to/open_magi/adapters/claude`, or install it through a Claude plugin
marketplace when available.

On local-LLM machines, start Claude through the local Claude wrapper so Claude
Code has the required gateway environment. If a wrapper does not forward extra
CLI arguments, use it for interactive sessions and install the plugin through
Claude's plugin system or a skills-dir plugin instead of relying on
`--plugin-dir`.

## Deliberator Launch

Claude Code supports plugin subagents, but the main agent does not reliably
emit multiple `Agent` tool calls in one turn. In Phase 3, do not use the Claude
`Agent` tool for Magi deliberation. Use the bundled headless runner instead:

Do not use the Claude `Agent` tool for Magi council launch.

```bash
open-magi-claude run-council \
  --project-root "$PWD" \
  --prompt-path ".open_magi/magi-log/round-NNN/council-PPP/prompt.md" \
  --round N \
  --pass P
```

If `open-magi-claude` is not on PATH, use the generated plugin-local CLI:

```bash
node ~/.claude/skills/open-magi/bin/open-magi-claude.js run-council \
  --project-root "$PWD" \
  --prompt-path ".open_magi/magi-log/round-NNN/council-PPP/prompt.md" \
  --round N \
  --pass P
```

The runner reads concrete model values from:

```text
~/.claude/skills/open-magi/agents/deliberator-melchior.md
~/.claude/skills/open-magi/agents/deliberator-balthasar.md
~/.claude/skills/open-magi/agents/deliberator-casper.md
```

It launches three headless Claude subprocesses concurrently:
- `open-magi:deliberator-melchior`
- `open-magi:deliberator-balthasar`
- `open-magi:deliberator-casper`

The runner prompt for each subprocess includes:
- the current `round-NNN/council-PPP/prompt.md` content;
- the expected report path;
- whether the pass is a proposal pass or review pass;
- the exact required report format from `references/deliberation.md`;
- the reminder that the agent must not edit files, run build/test/format/deploy
  commands, or ask procedural questions.

The plugin agents are configured with read-only tools (`Read`, `Grep`, `Glob`)
and `model: inherit`. Claude Code does not substitute plugin `userConfig` values
inside agent frontmatter model fields, so the marketplace adapter intentionally
uses the active Claude session model for all three plugin agents.

For separate deliberator models, the user must use the generated skills-dir
plugin from `open-magi-claude setup-claude`. That setup writes concrete `model:`
values into `~/.claude/skills/open-magi/agents/deliberator-*.md`. If an agent
resolves to a literal `user_config` placeholder, `default-model`, or another
invalid model value, treat it as a `hard_error`; do not fall back to generic
agents.

## Report Ownership

The Claude headless runner writes Magi artifacts directly. After it returns,
the main agent must verify these files exist:
- `round-NNN/council-PPP/report-melchior.md`
- `round-NNN/council-PPP/report-balthasar.md`
- `round-NNN/council-PPP/report-casper.md`

Each successful report must start with:

```text
report_source: claude_headless
status: ok
failure_type: none
agent: open-magi:deliberator-<sage>
model: <concrete model>
---
```

Then include the returned Magi report. Do not synthesize from transient chat
text unless the corresponding report file has been written.

## Failure Handling

If `run-council` returns a failed result or a report has `status` other than
`ok`, classify it:
- `timeout`: the agent exceeded the configured `deliberatorTimeoutMs` or Claude
  reported a timeout. Write a timeout report with `status: timeout` and
  `failure_type: timeout`, then continue through the normal timeout gate.
- `hard_error`: model, provider, auth, context, plugin load, missing agent, or
  runtime errors. Write a hard-error report with `status: hard_error` and
  `failure_type: hard_error`, set `currentPhase=blocked`, `active=false`, and
  `needsContinue=false`, then tell the user which plugin, model, or Claude
  runtime setting must be repaired.
- `needs_evidence`: the agent returned a valid report that asks for evidence or
  opposes the plan. Treat it as a normal deliberation result, not a runtime
  failure.

Do not treat `hard_error` as an ordinary veto. A hard error means the council
did not execute correctly. Do not fall back to generic agents, because that
would hide plugin/runtime failures and break model isolation assumptions.

## Stop Hook Backstop

The Claude adapter includes a conservative Stop hook. When a Magi loop is still
active, it returns a Stop `decision: block` continuation prompt so Claude keeps
working instead of stopping silently.

This is only a backstop. It does not replace the phase gates, artifact
integrity checks, or the main agent's responsibility to write reports and
verification evidence.
