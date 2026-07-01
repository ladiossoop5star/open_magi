# open_magi

English | [Traditional Chinese](README.zh-TW.md) | [Codex experimental notes](docs/README.codex.md)

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

## Codex Experimental Setup

Codex support is separate from the OpenCode setup. Install the Codex plugin,
then create three Codex custom agents so each deliberator can use its own
model:

```bash
codex plugin marketplace add ladiossoop5star/open_magi --ref main
codex plugin add open-magi@open-magi-dev
npx --yes --package git+https://github.com/ladiossoop5star/open_magi.git \
  open-magi setup-codex --interactive
```

Provider is optional; leave it blank unless the models require a custom Codex
provider such as LiteLLM or a local OpenAI-compatible proxy. Setup prints the
single fixed user-editable config file path, normally
`~/.codex/open_magi/codex.json`. If you need to change models later, edit only
that config file and rerun `open-magi setup-codex` to regenerate Codex agent
files. If the config file is deleted, the next first-use setup runs interactive
setup again. See [Codex experimental notes](docs/README.codex.md) for
project-scoped agent setup and current limitations.

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
