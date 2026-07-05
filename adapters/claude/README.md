# Open Magi for Claude Code

This is the experimental Claude Code adapter for Open Magi. It packages:

- `/open-magi:magi` skill
- `open-magi:deliberator-melchior` plugin agent
- `open-magi:deliberator-balthasar` plugin agent
- `open-magi:deliberator-casper` plugin agent
- a conservative Stop hook that emits `<MAGI_STOP_BACKSTOP>` when a Magi loop is still active
- `open-magi-claude run-council`, a headless runner that launches all three deliberators concurrently

Unlike the OpenCode adapter, this adapter cannot rely on a runtime hook to
control child sessions. It still packages native plugin agents for Claude Code
discovery, but the Claude skill uses `open-magi-claude run-council` to run
three headless Claude subprocesses in parallel and write report artifacts.

## Status

Experimental. The plugin loads and validates on Claude Code 2.1.185. The
headless runner can launch three model-isolated deliberators concurrently. It
does not yet have OpenCode's full runtime adapter parity for artifact repair or
question denial.

## Local Development

From the repository root:

```bash
claude plugin validate adapters/claude
claude plugin validate adapters/claude --strict
claude --plugin-dir adapters/claude plugin details open-magi
```

You can also add the repository root as a local Claude plugin marketplace:

```bash
claude plugin marketplace add /path/to/open_magi
claude plugin install open-magi@open-magi
```

The marketplace adapter is useful for validation and simple use, but Claude Code
does not substitute plugin `userConfig` inside agent frontmatter `model:` fields.
That means marketplace-installed agents use `model: inherit`.

For separate Melchior, Balthasar, and Casper models, generate a local skills-dir
plugin with concrete model names:

```bash
node /path/to/open_magi/adapters/claude/bin/open-magi-claude.js setup-claude \
  --melchior-model claude-haiku-4-5-20251001 \
  --balthasar-model claude-opus-4-8 \
  --casper-model claude-sonnet-4-6
```

If this package is installed as a CLI, the same command is:

```bash
open-magi-claude setup-claude \
  --melchior-model claude-haiku-4-5-20251001 \
  --balthasar-model claude-opus-4-8 \
  --casper-model claude-sonnet-4-6
```

The generated plugin lives at:

```text
~/.claude/skills/open-magi/
```

It writes:

```text
~/.claude/skills/open-magi/.claude-plugin/plugin.json
~/.claude/skills/open-magi/agents/deliberator-melchior.md
~/.claude/skills/open-magi/agents/deliberator-balthasar.md
~/.claude/skills/open-magi/agents/deliberator-casper.md
~/.claude/skills/open-magi/bin/open-magi-claude.js
~/.claude/skills/open-magi/lib/
~/.claude/skills/open-magi/hooks/
~/.claude/skills/open-magi/skills/magi/
```

Manual deliberator model configuration is in the generated agent frontmatter.
Edit these three files and change only the `model:` value:

```text
~/.claude/skills/open-magi/agents/deliberator-melchior.md
~/.claude/skills/open-magi/agents/deliberator-balthasar.md
~/.claude/skills/open-magi/agents/deliberator-casper.md
```

Example:

```yaml
---
name: deliberator-melchior
model: claude-haiku-4-5-20251001
tools: ["Read", "Grep", "Glob"]
---
```

If the marketplace plugin is already installed, disable or uninstall it before
using the generated skills-dir plugin to avoid duplicate `open-magi` plugin
entries:

```bash
claude plugin uninstall open-magi@open-magi
```

Then restart Claude Code or run `/reload-plugins`.

Start Claude with the plugin loaded:

```bash
claude --plugin-dir /path/to/open_magi/adapters/claude
```

If your machine uses a local Claude wrapper for local LLM routing, start Claude
through that local Claude wrapper. Some wrappers may not forward extra CLI
arguments. If yours does not, install the plugin through Claude's plugin system
or use a skills-dir plugin rather than relying on `--plugin-dir`.

## Usage

In a trusted project directory, invoke:

```text
/open-magi:magi goal: fix the tests until npm test passes. Verification command: npm test.
```

The Magi skill will create runtime artifacts under:

```text
.open_magi/magi-log/
```

Important artifacts include:

```text
state.json
checklist.md
round-NNN/research-prompt.md
round-NNN/council-PPP/prompt.md
round-NNN/council-PPP/report-melchior.md
round-NNN/council-PPP/report-balthasar.md
round-NNN/council-PPP/report-casper.md
round-NNN/direction-selection.md
round-NNN/synthesis.md
round-NNN/verdict.md
round-NNN/verification.md
final-report.md
```

## Deliberator Agents

Phase 3 uses `open-magi-claude run-council` instead of asking the main Claude
agent to launch three `Agent` tool calls. This avoids the observed behavior
where Claude launches one subagent, waits for it, then launches the next.

Example:

```bash
node ~/.claude/skills/open-magi/bin/open-magi-claude.js run-council \
  --project-root "$PWD" \
  --prompt-path ".open_magi/magi-log/round-001/council-001/prompt.md" \
  --round 1 \
  --pass 1
```

If the CLI is on PATH, the equivalent command starts with
`open-magi-claude run-council`.

The runner starts three headless Claude subprocesses concurrently:

- `open-magi:deliberator-melchior`
- `open-magi:deliberator-balthasar`
- `open-magi:deliberator-casper`

Each subprocess is restricted to read-only tools:

```yaml
tools: ["Read", "Grep", "Glob"]
```

The marketplace adapter uses `model: inherit`, so its deliberators use the
active Claude session model. The generated skills-dir plugin writes concrete
`model:` values into each agent file, and `run-council` reads those files for
separate Melchior, Balthasar, and Casper models.

## Stop Hook

The adapter includes a Stop hook. If `.open_magi/magi-log/state.json` says the
Magi loop is still active and `final-report.md` is not present, the hook returns
`decision: block` with a `<MAGI_STOP_BACKSTOP>` continuation prompt.

This hook is a backstop only. The main Claude agent must still enforce the Magi
phase gates and write the required artifacts.

## Limitations

- `open-magi-claude run-council` writes `report-*.md` files directly. The main
  agent must verify they exist before synthesis.
- The Stop hook cannot abort or time-limit child agents the way the OpenCode
  runtime plugin can; the headless runner enforces per-process timeouts.
- If a deliberator subprocess fails due to model, provider, auth, plugin load, or runtime
  errors, classify it as `hard_error`, write the failure report, set
  `currentPhase=blocked`, and ask the user to repair the Claude configuration.
- Do not fall back to generic Claude agents when a runner subprocess fails.
  Generic agents hide plugin/runtime failures and do not provide the intended
  Magi adapter semantics.
