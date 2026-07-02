# open_magi

English | [Traditional Chinese](README.zh-TW.md) | [Codex experimental notes](adapters/codex/README.md)

`open_magi` packages the Magi deliberation loop for coding agents. The stable
runtime today is the installable OpenCode plugin. Experimental Codex support is
available as a skill-first Codex plugin, without full runtime backstop parity
yet.

## Support Status

OpenCode is the only production-supported coding-agent runtime today. The
current installer, config writer, runtime hook, and strongest guardrails are
designed for OpenCode.

Codex support is experimental. It exposes the `magi` skill through Codex plugin
discovery, but timeout enforcement, auto-continue, question denial, and artifact
repair still need a Codex-native runtime adapter.

Future plan:

1. Stabilize the OpenCode plugin and Magi protocol through real project usage.
2. Validate Codex-native hooks and subagents for runtime backstop parity.
3. Add a Copilot CLI adapter if its extension points can support the required
   loop control, subagent delegation, and artifact checks.
4. Add a Claude Code adapter using Claude Code's native installation and
   workflow mechanisms.

Each future adapter should use the coding agent's own install path and runtime
model. The shared Magi protocol can be reused where practical, but OpenCode
runtime hooks are not assumed to work in other agents.
Adapter-specific config files should live under that coding agent's own config
directory, not in a shared Open Magi global directory.

## Adapter Package Layout

The repository keeps shared Magi protocol assets separate from installable
adapter packages:

```text
shared/magi/
  prompts/
  references/

skills/magi/
  OpenCode-installed magi skill

adapters/codex/
  .codex-plugin/
  bin/
  hooks/
  lib/
  skills/magi/
```

`shared/magi` is source-of-truth maintenance material only. It is not installed
into OpenCode or Codex. Tests enforce that shared prompts and common references
stay identical across adapter skills while allowing adapter-specific runtime
references.

The OpenCode npm package contains only the OpenCode runtime plugin, OpenCode
setup CLI, and OpenCode `skills/magi`. The Codex marketplace entry points at
`./adapters/codex`, so Codex installs only the Codex plugin manifest, Codex
Stop hook, Codex setup CLI, and Codex `skills/magi`.

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
  open-magi setup
```

After the npm package is published, the shorter npm install path will be:

```bash
opencode plugin open-magi-opencode -g
npx open-magi-opencode setup
```

Ask an AI agent to install it:

```text
Please install the public OpenCode plugin `open-magi-opencode` from the `open_magi` repo:
https://github.com/ladiossoop5star/open_magi. Use these exact commands:

opencode plugin git+https://github.com/ladiossoop5star/open_magi.git -g
npx --yes --package git+https://github.com/ladiossoop5star/open_magi.git open-magi setup

During setup, answer the prompts with the OpenCode model or models to use for
the three deliberators. After installation, verify that
~/.config/opencode/opencode.json contains the plugin entry and the three
read-only subagents: deliberator-melchior, deliberator-balthasar, and
deliberator-casper. Also verify that ~/.config/opencode/skills/magi/SKILL.md
exists. Setup also prints the Magi config path:
~/.config/opencode/magi.json.
```

Use models already configured for OpenCode. You can use one shared model for
all three deliberators, or give Melchior, Balthasar, and Casper different
models. The user-editable Magi settings live in `magi.json`; rerun
`open-magi setup` after editing it to regenerate `opencode.json`.

## Codex Experimental Notes

Codex support is packaged separately under `adapters/codex`. Do not use the
OpenCode npm package or OpenCode setup command for Codex. See
[Codex experimental notes](adapters/codex/README.md) for the current install,
setup, and limitation details.

## Update

If you installed directly from this GitHub repo, use the same source with
`--force` and rerun setup:

```bash
opencode plugin git+https://github.com/ladiossoop5star/open_magi.git -g -f
npx --yes --package git+https://github.com/ladiossoop5star/open_magi.git \
  open-magi setup
```

After the npm package is published, replace the installed plugin version and
refresh the local skill files with:

```bash
opencode plugin open-magi-opencode -g -f
npx open-magi-opencode setup
```

The setup step refreshes `~/.config/opencode/skills/magi` and preserves
unrelated OpenCode configuration. Re-enter the deliberator models when prompted
or use the non-interactive flags below.

## What Setup Writes

`open-magi setup` writes to the OpenCode config directory. By default this is:

```text
~/.config/opencode/
```

Generated or updated files:

```text
~/.config/opencode/magi.json
~/.config/opencode/opencode.json
~/.config/opencode/skills/magi/SKILL.md
~/.config/opencode/skills/magi/prompts/melchior.md
~/.config/opencode/skills/magi/prompts/balthasar.md
~/.config/opencode/skills/magi/prompts/casper.md
```

`magi.json` is the single user-editable Magi setup file for OpenCode. It stores
the plugin spec and the three deliberator models:

```json
{
  "schemaVersion": 1,
  "adapter": "opencode",
  "pluginSpec": "open-magi-opencode",
  "deliberators": {
    "melchior": { "model": "model-a" },
    "balthasar": { "model": "model-b" },
    "casper": { "model": "model-c" }
  }
}
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

If `magi.json` already exists, `open-magi setup` can regenerate the OpenCode
config from it without model flags. If `magi.json` is deleted, setup will ask
for the model settings again unless you provide flags or environment variables.

## Setup Options

Interactive setup:

```bash
open-magi setup
```

One model for all three deliberators:

```bash
open-magi setup \
  --model deepseek-v4-flash \
  --config-dir ~/.config/opencode \
  --plugin-spec open-magi-opencode
```

Independent deliberator models:

```bash
open-magi setup \
  --melchior-model model-a \
  --balthasar-model model-b \
  --casper-model model-c
```

Dry run:

```bash
open-magi setup --dry-run
```

Environment overrides:

```bash
OPEN_MAGI_MODEL=deepseek-v4-flash open-magi setup
OPEN_MAGI_MELCHIOR_MODEL=model-a \
OPEN_MAGI_BALTHASAR_MODEL=model-b \
OPEN_MAGI_CASPER_MODEL=model-c \
  open-magi setup
OPENCODE_CONFIG_DIR=/path/to/opencode-config open-magi setup
```

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
