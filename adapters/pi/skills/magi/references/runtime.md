# Pi Runtime Reference

Pi-specific transport for Open Magi. Protocol, prompts, reports, phases, and
artifact contracts are unchanged from `shared/magi/references/`.

## Status

Experimental. OpenCode is the production-supported runtime.

## Activation

- `/magi <goal>`, `/skill:magi <goal>`, or an explicit use-Magi request.
- Natural-language requests are rewritten by the extension's `input` event into
  `/skill:magi <original request>`; Pi expands the skill command after the
  input event.
- `/magi` injects the same invocation with `expandPromptTemplates: true`
  (plus `deliverAs: "followUp"` while the agent is streaming).
- Questions and negations never activate. Non-interactive sessions reject
  activation with a clear message.

## Model Overrides

- User scope: `getAgentDir()/open-magi.json` (honors `PI_CODING_AGENT_DIR`).
- Project scope: `CONFIG_DIR_NAME/open-magi.json` under the project root, read
  only when the project is trusted.
- Schema version 1 is strict:

{
  "version": 1,
  "models": {
    "melchior": "provider/model:high"
  }
}

Unknown keys/roles/versions, empty selectors, or malformed JSON invalidate the
whole file. Edit with `/magi-setup`.

## Native Council

`magi_council` runs one deliberation pass: three concurrent isolated Pi
children (`--mode json --print --no-session --no-extensions --no-skills
--no-context-files --no-prompt-templates --no-themes --tools read,grep,find,ls
--no-approve`) with per-role model/thinking passed explicitly. The parent
parses JSONL, extracts the final assistant message and usage, and atomically
writes `report-<sage>.md` beside the pass prompt. Success markers are
`report_source: pi_json`; failures use `report_source: pi_json_failed` with a
normalized failure type in `pi_diag:`. Timeouts default to 30 minutes, clamped
to 60 minutes; `SIGTERM` then `SIGKILL` after five seconds.

## Herdr Precedence

Under `HERDR_ENV=1` the `.open-magi-herdr` file gate, pane ownership, and the
three-pane lifecycle stay authoritative; the native council tool rejects
invocation. See README.md#herdr-native-deliberation.
