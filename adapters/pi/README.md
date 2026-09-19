# Open Magi for Pi

## Status

Experimental. OpenCode remains the only production-supported runtime; the Pi
adapter matches the current maturity of the Codex and Claude adapters.

## Version expectation

Pi + extension API pinned to @earendil-works/pi-coding-agent 0.85.1
(`pi.getThinkingLevel()`, `ExtensionContext.model`, `tool_call` mutability, and
`input` transform semantics come from this release). Other 0.x releases are
unverified.

## Install for Local Development

    cd /path/to/open_magi
    pi install .

Remote (Git) installs must skip the repo root `postinstall` (it configures
OpenCode, not Pi, and touches the user's OpenCode configuration):

    OPEN_MAGI_SKIP_POSTINSTALL=1 pi install git:github.com/ladiossoop5star/open_magi

Verify the discovery with `pi list`: one Open Magi extension and the `magi`
skill must appear. Uninstall with `pi remove <source-or-path>`.

## Activation

Interactive Pi sessions only (`ctx.mode === "tui"`). In `rpc`, `json`, and
`print` modes Magi rejects activation with a clear message instead of starting
a loop.

- `/magi <goal>` - dispatches to the Magi skill with the goal.
- `/skill:magi <goal>` - direct skill invocation.
- Natural language - an explicit standalone `magi` token plus a use/run/start/
  through marker (or `magi skill` as a direct instruction), with no governing
  negation and no trailing `?`. English examples: `use magi`, `run this with
  magi`, `run magi now`, `start magi`, `debug this through magi`.
  Mandarin examples: `\u8acb\u4f7f\u7528 magi`, `\u7528 magi skill`,
  `\u4f7f\u7528 magi` (see the escaped code points in
  `adapters/pi/lib/activation.js`).
- Informational questions (`What is Magi?`) and negations (`do not use Magi`,
  Mandarin `\u4e0d\u8981\u4f7f\u7528 magi`) never activate.
- Extension-originated input (the extension's own injected text) never
  re-activates, so the loop cannot recurse.

## Model Overrides and `/magi-setup`

- User scope: `getAgentDir()/open-magi.json` (honors `PI_CODING_AGENT_DIR`),
  written with mode 0600.
- Project scope: `CONFIG_DIR_NAME/open-magi.json` under the project root (the
  Pi default is `.pi/`), read and written ONLY when the project is trusted.
- Precedence: main session model -> user -> trusted project; an empty answer
  clears an override so a lower-precedence source inherits.
- Per-role selector format: `provider/model:thinking` where the optional
  thinking level is one of `off|minimal|low|medium|high|xhigh|max`.
- Schema version 1 is strict: unknown top-level keys, unknown roles, wrong
  versions, empty selectors, or malformed JSON invalidate the whole file
  (everything fails closed until fixed).
- `/magi-setup` walks all three roles (melchior / balthasar / casper),
  pre-fills current values, distinguishes cancel (dialog dropped, nothing
  written) from empty string (clear that role), and never merges back
  previously loaded values.

## Native Council

`magi_council` runs one deliberation pass: three concurrent isolated read-only
Pi children in JSON mode:

    --mode json --print --no-session --no-extensions --no-skills
    --no-context-files --no-prompt-templates --no-themes
    --tools read,grep,find,ls --no-approve

Per-role model/thinking flags are passed explicitly - no fallback between
models, no `pi-subagents`. Each child prompt is the role prompt plus the
council prompt plus report output requirements. The parent parses JSONL,
extracts the final assistant message and usage, and atomically writes
`report-<sage>.md` beside the pass prompt.

Timeouts default to 30 minutes and are clamped to 60 minutes; escalation is
SIGTERM then SIGKILL after five seconds; shutdown reaps children ONLY by
their real `close` event (never by a grace timer) and a controller never
shares child ownership with another controller.

## Failure Semantics (no fallback)

- Success reports carry `report_source: pi_json`.
- Failures carry `report_source: pi_json_failed` plus `status: timeout` or
  `status: hard_error` and a bounded `pi_diag:` field with the native subtype
  (`invalid_json`, `missing_final_response`, `spawn_error`, `nonzero_exit`,
  `model_unavailable`, `aborted`, `timeout`).
- Model/auth/provider failures classify as `model_unavailable`; no model
  switch, no `pi-subagents`, no cross-runtime fallback ever happens.
- Post-dispatch failures (timeout / hard_error) are RETURNED to the gates with
  their standard role reports; only pre-dispatch failures (config / state /
  path / transport / guard) throw.

## Herdr Precedence

Under `HERDR_ENV=1` the `.open-magi-herdr` activation gate, pane ownership,
question handling, cleanup rules, and the three-pane lifecycle stay
authoritative; the native Pi council rejects invocation with
`transport mismatch` BEFORE any config read or spawn. There is no Herdr-to-
native or native-to-Herdr fallback in either direction.
See README.md#herdr-native-deliberation.

## Uninstall and Troubleshooting

- Uninstall: `pi remove git:github.com/ladiossoop5star/open_magi` (or
  `pi remove .` for a local checkout); `pi list` should no longer show the
  Open Magi extension or skill.
- `pi install .` but `/magi` says non-interactive: check that the session was
  started in TUI mode, not `--mode json`/`print`/`rpc`.
- `/magi-setup` reports a dialog or 0600 mismatch: verify
  `PI_CODING_AGENT_DIR` and `ls -l $(pi config agent-dir)`
  (see `getAgentDir()`).
- magi_council rejects with `transport mismatch` - you are in a Herdr session;
  use the `.open-magi-herdr` activation flow instead.
- magi_council reports `invalid open-magi.json` - fix the JSON or remove the
  offending file (strict schema version 1). `/magi-setup` rewrites it once the
  file is readable, so fix external edits manually first.
- Deliberator children never load extensions/skills/context files, so if they
  cannot find a project file, pass the absolute path through the council
  prompt.

## Limitations

- No print/JSON/RPC main controller in the first release.
- No general Pi subagents; the runner is council-only.
- Deliberator children load no user extensions, skills, prompt templates,
  themes, or project context files.
- Extension docs are Chinese-free by repository policy (only README.zh-TW.md
  carries Han text).
