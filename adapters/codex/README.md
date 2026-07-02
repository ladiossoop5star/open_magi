# Open Magi for Codex

Codex support is experimental and skill-first. The plugin exposes the
Codex-specific `magi` skill and a bundled CLI runner that launches the three
configured deliberators through separate `codex exec` subprocesses. It does not
yet include the OpenCode runtime
backstop for automatic continuation, child-session timeout abort, question
denial, or artifact repair.

## Install for Local Development

From a checkout of this repository:

```bash
codex plugin marketplace add /path/to/open_magi
codex plugin add open-magi@open-magi-dev
```

For a GitHub install after Codex support is merged:

```bash
codex plugin marketplace add ladiossoop5star/open_magi --ref main
codex plugin add open-magi@open-magi-dev
```

Use `codex plugin list --available` to confirm that `open-magi` is visible.

## Deliberator Models

Codex supports custom agents under `~/.codex/agents/` or a project
`.codex/agents/` directory. Open Magi uses this for the three deliberators so
they do not have to be simulated by the main agent model.

First-use setup writes editable templates:

```bash
open-magi setup-codex
```

If `open-magi` is not on PATH during local plugin development, run the bundled
CLI directly:

```bash
node /path/to/open_magi/adapters/codex/bin/open-magi.js setup-codex
```

The setup command creates three Codex custom agent files:

```text
~/.codex/agents/deliberator-melchior.toml
~/.codex/agents/deliberator-balthasar.toml
~/.codex/agents/deliberator-casper.toml
```

Each template starts with:

```toml
model = "default-model"
```

Edit those three `model` values before using Magi. Leave provider unset unless
the model requires a specific Codex `model_provider`. Add `model_provider` only
for custom providers such as LiteLLM, a local OpenAI-compatible proxy, Azure,
Bedrock, or another configured provider.

`open-magi setup-codex` does not overwrite existing agent files. If you already
edited a template, rerunning setup only creates missing files. For automation,
pass `--melchior-model`, `--balthasar-model`, and `--casper-model`; use
`--agents-dir .codex/agents` for project-scoped templates.

## Usage

Start Codex in a project and prefer Goal mode:

```text
/goal Use the magi skill. Goal: fix the tests until npm test passes. Verification command: npm test. Continue until .open_magi/magi-log/final-report.md is written.
```

If a goal tool is available, the `magi` skill also tells Codex to create a
matching goal before Phase 0. If Goal mode is unavailable, invoke the skill
directly:

```text
magi, goal: fix the tests until npm test passes.
```

Runtime artifacts are written under:

```text
.open_magi/magi-log/
```

Codex should follow the same Magi artifact contract as OpenCode: `state.json`,
`checklist.md`, `round-NNN/research-prompt.md`, council reports,
`direction-selection.md`, `synthesis.md`, `verdict.md`, `verification.md`, and
`final-report.md`.

During Phase 3, Codex uses the bundled CLI runner:

```bash
PLUGIN_CLI="$(find "$HOME/.codex/plugins/cache" -path "*/open-magi/*/bin/open-magi.js" | sort | tail -n 1)"
node "$PLUGIN_CLI" run-council --project-root "$PWD" --prompt-path ".open_magi/magi-log/round-NNN/council-PPP/prompt.md" --round N --pass P
```

The runner reads the three `~/.codex/agents/deliberator-*.toml` files, starts
three independent `codex exec` subprocesses with the configured model/provider
settings, and writes `report-melchior.md`, `report-balthasar.md`, and
`report-casper.md`. Successful reports start with `report_source: codex_exec`;
failed launches are recorded as `report_source: codex_exec_failed`.
The runner disables the Magi Stop hook inside deliberator subprocesses so they
can exit after returning a report instead of being continued by the parent
loop's active `state.json`.

The plugin also bundles an MCP server for resources and future compatibility.
On Codex CLI 0.142.5, plugin MCP resources are visible but custom MCP tools are
not exposed to the model, so the CLI runner is the supported execution path.

## Stop Hook Backstop

The plugin bundles a minimal Codex Stop hook. When Codex is about to stop, the
hook reads `.open_magi/magi-log/state.json`. If `active=true` and
`final-report.md` does not exist, it returns a Codex Stop decision of
`decision: block` with a `<MAGI_STOP_BACKSTOP>` continuation block. The next
line is `Magi loop is still active`. Codex treats that as an automatic
continuation, so the Magi loop can resume instead of stopping silently.

This hook is intentionally conservative. It does not abort subagents, rewrite
state, repair missing artifacts by itself, or replace Goal mode.
If `state.json` is corrupt, the hook blocks as a fail-safe and asks Codex to
repair state from `.open_magi/magi-log` history. Repeated corruption can keep
continuation active until the state file is repaired.

## Current Limitations

- This is a Codex plugin/skill package with a CLI deliberator runner, not a
  full runtime adapter yet.
- The OpenCode runtime backstop remains stronger today: it can wake stalled
  loops, enforce question request handling, abort timed-out deliberators, and
  repair missing artifacts.
- Codex support depends on the bundled `run-council` CLI for true deliberator
  separation. If the CLI runner is unavailable, Magi must stop instead of
  faking report files.

Until the Codex runtime adapter is fully implemented, treat Codex usage as a
protocol compatibility path with real external deliberator processes, but not
yet production-equivalent OpenCode support.
