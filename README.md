# open_magi

English | [Traditional Chinese](README.zh-TW.md)

`open_magi` packages the Magi deliberation loop as an installable OpenCode
plugin. It adds a `magi` skill, three read-only deliberator subagents, and a
runtime hook that keeps long deliberation loops moving until explicit
verification commands pass.

## Support Status

OpenCode is the only supported coding-agent runtime today. The current
installer, config writer, runtime hook, and bundled `magi` skill are designed
for OpenCode.

Future plan:

1. Stabilize the OpenCode plugin and Magi protocol through real project usage.
2. Add a Copilot CLI adapter if its extension points can support the required
   loop control, subagent delegation, and artifact checks.
3. Add a Claude Code adapter using Claude Code's native installation and
   workflow mechanisms.
4. Add a Codex CLI adapter using Codex-native skills or plugins.

Each future adapter should use the coding agent's own install path and runtime
model. The shared Magi protocol can be reused where practical, but OpenCode
runtime hooks are not assumed to work in other agents.

## Development Hygiene

Small changes, documentation edits, and routine debugging may be committed
directly on `main`. Use a feature branch for risky or large changes, then merge
back to `main` after verification.

Keep real runtime logs, local test data, and personal notes out of the
repository. `.gitignore` excludes `.open_magi/`, `docs/superpowers/`, `.env`
files, editor swap files, and `tmp/` for this purpose. Test fixtures should use
generic paths such as `/tmp/open_magi_repo` and generic users such as
`example-user`.

Before pushing public changes, run:

```bash
npm test
npm pack --dry-run
git diff --check
```

## Install

Until the npm package is published, install directly from this public GitHub
repo:

```bash
opencode plugin git+https://github.com/ladiossoop5star/open_magi.git -g
npx --yes --package git+https://github.com/ladiossoop5star/open_magi.git \
  open-magi setup --model deepseek-v4-flash
```

After the npm package is published, the shorter npm install path will be:

```bash
opencode plugin open-magi-opencode -g
npx open-magi-opencode setup --model deepseek-v4-flash
```

Ask an AI agent to install it:

```text
Please install the public OpenCode plugin `open-magi-opencode` from the `open_magi` repo:
https://github.com/ladiossoop5star/open_magi. Use these exact commands:

opencode plugin git+https://github.com/ladiossoop5star/open_magi.git -g
npx --yes --package git+https://github.com/ladiossoop5star/open_magi.git open-magi setup --model deepseek-v4-flash

After installation, verify that ~/.config/opencode/opencode.json contains the
plugin entry and the three read-only subagents: deliberator-melchior,
deliberator-balthasar, and deliberator-casper. Also verify that
~/.config/opencode/skills/magi/SKILL.md exists.
```

If your provider/model name is different, replace
`deepseek-v4-flash` with a model already configured in your
OpenCode `opencode.json`.
The setup command requires an explicit model; it will not write a placeholder
default model for you.

## Update

If you installed directly from this GitHub repo, use the same source with
`--force` and rerun setup:

```bash
opencode plugin git+https://github.com/ladiossoop5star/open_magi.git -g -f
npx --yes --package git+https://github.com/ladiossoop5star/open_magi.git \
  open-magi setup --model deepseek-v4-flash
```

After the npm package is published, replace the installed plugin version and
refresh the local skill files with:

```bash
opencode plugin open-magi-opencode -g -f
npx open-magi-opencode setup --model deepseek-v4-flash
```

The setup step refreshes `~/.config/opencode/skills/magi` and preserves
unrelated OpenCode configuration. Replace the model name if your local
OpenCode config uses a different provider/model.

## What Setup Writes

`open-magi setup` writes to the OpenCode config directory. By default this is:

```text
~/.config/opencode/
```

Generated or updated files:

```text
~/.config/opencode/opencode.json
~/.config/opencode/skills/magi/SKILL.md
~/.config/opencode/skills/magi/prompts/melchior.md
~/.config/opencode/skills/magi/prompts/balthasar.md
~/.config/opencode/skills/magi/prompts/casper.md
```

The setup command preserves unrelated `provider`, `agent`, and `plugin`
configuration. It adds or updates:

- `plugin[]`: `open-magi-opencode`, unless OpenCode already registered this
  repository package directly.
- `agent.deliberator-melchior`
- `agent.deliberator-balthasar`
- `agent.deliberator-casper`

All three deliberator agents are configured as subagents with `edit=deny` and
`bash=deny`.

## Setup Options

```bash
open-magi setup \
  --model deepseek-v4-flash \
  --config-dir ~/.config/opencode \
  --plugin-spec open-magi-opencode
```

Dry run:

```bash
open-magi setup --dry-run
```

Environment overrides:

```bash
OPEN_MAGI_MODEL=deepseek-v4-flash open-magi setup
OPENCODE_CONFIG_DIR=/path/to/opencode-config open-magi setup
```

`--model` or `OPEN_MAGI_MODEL` is required.

## Usage

Start OpenCode in a project after installation:

```bash
opencode .
```

Then ask for Magi:

```text
magi, goal: fix the tests until npm test passes.
```

Equivalent trigger examples:

```text
magi, goal: complete this refactor and run verification.
three-sages loop, goal: diagnose this bug and fix it.
deliberation loop until done.
```

## External Headless Deliberators

By default, all three sages use OpenCode subagents configured under
`agent.deliberator-*`. You can also route any sage to an external headless agent
by editing the template installed at `~/.config/opencode/open_magi.json`:

```json
{
  "deliberators": {
    "melchior": { "runner": "opencode" },
    "balthasar": {
      "runner": "command",
      "command": "codex exec --sandbox read-only -"
    },
    "casper": {
      "runner": "command",
      "command": "claude -p"
    }
  }
}
```

Rules:

- Do not put this custom block in `opencode.json`; OpenCode rejects unknown
  top-level config keys.
- Plugin install creates this template if it does not already exist.
- Missing config, `runner: "opencode"`, or `type: "opencode"` uses the normal
  OpenCode subagent and reads its model from `opencode.json`.
- `runner: "command"` or `type: "command"` runs the command from the project
  root.
- The council prompt is sent to the command on stdin.
- The command also receives `OPEN_MAGI_PROMPT_FILE`, `OPEN_MAGI_REPORT_FILE`,
  `OPEN_MAGI_SAGE`, `OPEN_MAGI_ROUND`, and `OPEN_MAGI_PASS`.
- If stdout contains Magi report metadata such as `stance:` and
  `blocking_objection:`, stdout is written as the report.
- If the command writes `OPEN_MAGI_REPORT_FILE` itself, Open Magi preserves that
  file.
- Failed or timed-out commands generate a `needs_evidence` report so the loop can
  continue without asking what to do.

For CLIs that do not read stdin directly, wrap the command yourself. Example:

```json
{
  "deliberators": {
    "melchior": {
      "runner": "command",
      "command": "sh -lc 'codex exec --sandbox read-only < \"$OPEN_MAGI_PROMPT_FILE\"'"
    }
  }
}
```

## Runtime Files

For each project where Magi runs, runtime logs are written under:

```text
.open_magi/magi-log/
```

Expected layout:

```text
.open_magi/magi-log/
├── state.json
├── checklist.md
├── round-001/
│   ├── research-prompt.md
│   ├── council-001/
│   │   ├── prompt.md
│   │   ├── report-melchior.md
│   │   ├── report-balthasar.md
│   │   ├── report-casper.md
│   │   └── synthesis.md
│   ├── verdict.md
│   └── verification.md
└── final-report.md
```

`checklist.md` is a required phase-transition gate. Magi reads it before
moving phases, and the plugin can reopen a loop if required artifacts such as
`council-001/report-melchior.md`, `council-001/report-balthasar.md`, or
`council-001/report-casper.md` are missing.

Before code changes, Magi can run multiple bounded council passes in one round:
the default maximum is 3, the hard maximum is 5, and early passes use veto
rules to avoid premature implementation. If the council still cannot fully
converge at the limit, Magi must choose the smallest reversible verifiable next
action instead of asking the user for debug direction.

Deliberator timeout is enforced by the plugin, not just by prompt text. The
default timeout is 30 minutes per deliberator child session. When a deliberator
times out, the plugin calls OpenCode `session.abort` for that child session and
writes the corresponding timeout report under the active council directory,
for example:

```text
.open_magi/magi-log/round-001/council-001/report-melchior.md
```

Timeout reports use `status: timeout`, `stance: needs_evidence`, and
`blocking_objection: yes`, so the council gate can continue deterministically
without asking the user what to do.

## Test

```bash
npm test
npm pack --dry-run
```

Live E2E tests require a working OpenCode provider. In this environment, use:

```bash
opencode run --agent build --model deepseek-v4-flash \
  "Use the magi skill. Goal: create result.txt with PASS. Verification command: grep -qx PASS result.txt"
```
