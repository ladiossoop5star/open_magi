# OpenCode Setup Reference

Use this on every Magi invocation before reading user-provided files, workflow
files, or project context. This includes `magi setup`, `/magi setup`,
`setup magi`, `/magi goal: ...`, and `/magi <path>`.

## Setup Contract

Setup is not a deliberation loop. Do not create `.open_magi/`, do not write
Magi runtime state, do not launch deliberators, and do not ask for debug
direction.

Setup only updates the OpenCode config file:

```text
~/.config/opencode/opencode.json
```

If `OPENCODE_CONFIG_DIR` is set, use `$OPENCODE_CONFIG_DIR/opencode.json`.
If `XDG_CONFIG_HOME` is set, use `$XDG_CONFIG_HOME/opencode/opencode.json`.
Otherwise use `~/.config/opencode/opencode.json`.

## Configured Check

Read `opencode.json`. Magi is unconfigured if any of these are missing or have
`model: "default-model"`:
- `agent.deliberator-melchior`
- `agent.deliberator-balthasar`
- `agent.deliberator-casper`

If Magi is unconfigured, stop the requested work and run setup first. Do not
read workflow files or start the goal. Tell the user work can start only after
setup is complete and OpenCode has been restarted.

## Model Prompt

Ask for model settings only when setup is required. Prefer one concise question:

```text
Magi needs three OpenCode deliberator models before it can run. Provide either
one shared model, or three models as Melchior/Balthasar/Casper.
```

Accept either:
- one shared model for all three deliberators;
- three explicit models for Melchior, Balthasar, and Casper.

Do not leave any deliberator as `default-model`.

## Write Config

Preserve unrelated `provider`, `agent`, and `plugin` settings. Add
`open-magi-opencode` to `plugin[]` if no existing Open Magi plugin entry is
present.

Write or replace these three agents:

```json
{
  "agent": {
    "deliberator-melchior": {
      "mode": "subagent",
      "model": "<melchior model>",
      "prompt": "<Melchior prompt from skills/magi/prompts/melchior.md>",
      "permission": { "edit": "deny", "bash": "deny" }
    },
    "deliberator-balthasar": {
      "mode": "subagent",
      "model": "<balthasar model>",
      "prompt": "<Balthasar prompt from skills/magi/prompts/balthasar.md>",
      "permission": { "edit": "deny", "bash": "deny" }
    },
    "deliberator-casper": {
      "mode": "subagent",
      "model": "<casper model>",
      "prompt": "<Casper prompt from skills/magi/prompts/casper.md>",
      "permission": { "edit": "deny", "bash": "deny" }
    }
  }
}
```

Use complete atomic JSON writes where possible. Keep prompts exactly from the
installed skill prompt files.

## Completion Message

After writing `opencode.json`, tell the user:
- the exact path written;
- the three configured models;
- OpenCode must be restarted before Magi can use the new deliberator agents;
- after restart, they can run `/magi goal: ...` again.
