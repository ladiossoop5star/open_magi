# Open Magi for Codex

Codex support is experimental and skill-first. The plugin exposes the shared
`magi` skill through Codex plugin discovery, but it does not yet include the
OpenCode runtime backstop for automatic continuation, child-session timeout
abort, question denial, or artifact repair.

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

First-use setup is interactive:

```bash
open-magi setup-codex
```

If `open-magi` is not on PATH during local plugin development, run the bundled
CLI directly:

```bash
node /path/to/open_magi/bin/open-magi.js setup-codex
```

Provider is optional. Leave it blank to inherit the normal Codex provider. Set
it only when the deliberator models require a custom provider such as LiteLLM,
a local OpenAI-compatible proxy, Azure, Bedrock, or another configured provider.
The interactive setup asks whether you need a specific provider; answer no to
leave the provider blank.

The user-editable Open Magi Codex config is one fixed file:

```text
~/.codex/open_magi/codex.json
```

After setup, rerun `open-magi setup-codex` to enter new model/provider values,
or pass `--melchior-model`, `--balthasar-model`, and `--casper-model` for
non-interactive setup.

If this config file is deleted, the next Magi first-use preflight should run
`open-magi setup-codex` again.

Generated Codex custom agent files are runtime artifacts:

```text
~/.codex/agents/deliberator-melchior.toml
~/.codex/agents/deliberator-balthasar.toml
~/.codex/agents/deliberator-casper.toml
```

Do not hand-edit the generated agent files unless you are debugging Codex
itself. Use `--agents-dir .codex/agents` for project-scoped generated agents.
Magi uses the fixed config file as the source of truth, not a
`deliberator-*.toml` lookup.

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

## Stop Hook Backstop

The plugin bundles a minimal Codex Stop hook. When Codex is about to stop, the
hook reads `.open_magi/magi-log/state.json`. If `active=true` and
`final-report.md` does not exist, it injects additional context beginning with
`Magi loop is still active` so Codex can continue the Magi loop instead of
stopping silently.

This hook is intentionally conservative. It does not abort subagents, rewrite
state, repair missing artifacts by itself, or replace Goal mode.

## Current Limitations

- This is a Codex plugin/skill package, not a full runtime adapter yet.
- The OpenCode runtime backstop remains stronger today: it can wake stalled
  loops, enforce question request handling, abort timed-out deliberators, and
  repair missing artifacts.
- Codex support depends on Codex-native subagent and hook behavior. Those
  runtime checks still need dedicated implementation and live testing.

Until the Codex runtime adapter is implemented, treat Codex usage as a protocol
compatibility test rather than production-equivalent OpenCode support.
