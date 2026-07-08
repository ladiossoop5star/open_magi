# Codex Runtime Reference

Use this when launching deliberator subagents, running the Codex setup CLI, or
handling Codex-specific Magi limitations.

## Setup Preflight

Before Phase 0, check the Codex custom agent files:
- `~/.codex/agents/deliberator-melchior.toml`
- `~/.codex/agents/deliberator-balthasar.toml`
- `~/.codex/agents/deliberator-casper.toml`

These TOML files are the user-editable source of truth. If any file is missing,
run `setup-codex` through the adapter CLI to recreate templates. If any file
contains `model = "default-model"`, stop before project work and tell the user
to edit the exact file path.

Do not silently use the main agent model as all three deliberators. If setup
cannot be completed, report the blocker instead of starting a same-model
fallback.

## Deliberator Launch

Codex does not expose a stable `spawn_agent` CLI flag. Do not search `codex
--help` during Phase 3 and do not improvise shell-written success reports.

After writing `round-NNN/council-PPP/prompt.md`, run the bundled plugin-cache
CLI. Do not spend time searching for an MCP tool; on Codex CLI 0.142.5 plugin
MCP resources are visible, but custom MCP tools are not exposed to the model.

```bash
PLUGIN_CLI="$(find "$HOME/.codex/plugins/cache" -path "*/open-magi/*/bin/open-magi.js" | sort | tail -n 1)"
node "$PLUGIN_CLI" run-council --project-root "$PWD" --prompt-path ".open_magi/magi-log/round-NNN/council-PPP/prompt.md" --round N --pass P
```

Use PATH only as a last fallback, and only after confirming the command belongs
to the Codex adapter:

```bash
open-magi --help | grep -q run-council &&
open-magi run-council --project-root "$PWD" --prompt-path ".open_magi/magi-log/round-NNN/council-PPP/prompt.md" --round N --pass P
```

Call it with:
- `projectRoot`: the project root;
- `promptPath`: the absolute or project-relative path to the council prompt;
- `round`: the current `state.json.currentRound`;
- `pass`: the current `state.json.currentDeliberationPass`;
- `timeoutMs`: `state.json.deliberatorTimeoutMs` when present.

The tool reads these Codex custom agent templates:
- `deliberator-melchior`
- `deliberator-balthasar`
- `deliberator-casper`

It launches three independent `codex exec` subprocesses with each TOML file's
`model`, optional `model_provider`, optional `model_reasoning_effort`, and
read-only sandbox. The runner disables the Magi Stop hook inside those
subprocesses so deliberators can stop after returning their report. It writes:
- `round-NNN/council-PPP/report-melchior.md`
- `round-NNN/council-PPP/report-balthasar.md`
- `round-NNN/council-PPP/report-casper.md`

Each report starts with `report_source: codex_exec` on success or
`report_source: codex_exec_failed` on failure. Reports also include
`codex_failure_type: none | timeout | hard_error`. Treat missing provenance or
missing `codex_failure_type` as an invalid report.

The main agent must not write successful `report-*.md` files itself. If the CLI
runner is unavailable or fails, record the blocker and stop before synthesis.
Do not claim that the deliberators reported.

## Failure Handling

`run-council` separates failure classes:
- `codex_failure_type: timeout`: the subprocess exceeded `timeoutMs`. Treat the
  report as `status: timeout`, `failure_type: timeout`, and continue through the
  Magi timeout gate.
- `codex_failure_type: hard_error`: the subprocess failed for a non-timeout
  reason, such as model, provider, auth, sandbox, or runner failure. The CLI
  response sets `halt: true`, `haltReason: hard_error`, and includes
  `hardErrors`.

If `halt: true`, do not continue to synthesis. Set or preserve
`currentPhase=blocked`, `active=false`, and `needsContinue=false`; tell the
user to repair the exact `~/.codex/agents/deliberator-*.toml`, provider, or
Codex runtime setting shown in the report before resuming.

## Stop Hook Backstop

The Codex adapter includes a conservative Stop hook. When a Magi loop is still
active, it returns a Stop `decision: block` continuation prompt so Codex can
keep working instead of stopping silently.

If a loop was marked complete but `final-report.md` is missing, the hook also
blocks. If the goal is already complete, write `final-report.md` before
stopping. If the goal is not complete, restore `active=true`, set
`needsContinue=true`, and continue the appropriate next phase or round without
asking for direction.

This is not equivalent to the full runtime backstop. It does not abort
subagents, rewrite state, repair missing artifacts by itself, or replace Goal
mode. The main agent must still enforce the Magi protocol and artifact gates.
