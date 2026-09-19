# Pi Agent Support Design

## Status

Approved design for experimental native Pi support in Open Magi. This document
covers the Pi adapter, its native council transport, activation behavior,
configuration, failure handling, packaging, and verification. It does not
change the existing Herdr transport.

## Goals

- Install Open Magi as a Pi package directly from this repository.
- Run the complete Magi loop from an interactive Pi session.
- Support explicit slash-command and natural-language activation.
- Run three isolated, read-only Pi deliberators concurrently when Herdr is not
  active.
- Allow per-role model overrides at user and project scope, with inheritance
  from the main Pi session.
- Preserve the existing Magi artifact protocol, question firewall, phase guard,
  completion backstop, and Herdr transport contract.

## Product Positioning

Pi support is experimental, matching the maturity label of the Codex and
Claude adapters. OpenCode remains the only production-supported runtime until
the Pi adapter has accumulated sufficient real-world validation.

The supported host is interactive Pi. A non-interactive main Pi session must
reject Magi activation with a clear explanation. The deliberator children may
use Pi's non-interactive JSON mode internally.

## Non-Goals

- Do not add subagents to Pi generally.
- Do not depend on the third-party `pi-subagents` package.
- Do not support print, JSON, or RPC mode as the main Magi controller in the
  first release.
- Do not load arbitrary user extensions, skills, prompt templates, themes, or
  project context files inside native deliberator children.
- Do not add a Pi-specific Herdr runner or change the existing Herdr pane
  protocol.
- Do not silently fall back between Herdr and the native Pi transport.
- Do not promote Pi to production-supported status in this change.

## Selected Approach

Add a dedicated `adapters/pi/` implementation and expose it through a Pi
manifest in the repository root package. The adapter uses Pi's native extension
events for activation, tool guarding, question handling, continuation, and
completion checks. A focused runner launches three separate Pi processes for
native deliberation.

This is preferred over wrapping the OpenCode runtime because Pi and OpenCode
have different session and lifecycle APIs. It is preferred over integrating a
generic subagent package because Magi needs deterministic read-only tools,
timeouts, failure classes, prompts, and report schemas.

## Proposed File Layout

```text
package.json
adapters/pi/
  README.md
  extension.js
  lib/
    activation.js
    config.js
    controller.js
    pi-runner.js
  skills/magi/
    SKILL.md
    prompts/
    references/
shared/magi/
  prompts/
  references/
test/
  pi-adapter.test.mjs
```

Responsibilities are deliberately narrow:

- `extension.js` registers Pi commands, tools, and event handlers, then routes
  work to focused modules.
- `activation.js` recognizes explicit intent without starting loops for
  discussion or negated requests.
- `config.js` validates and merges model configuration without starting child
  processes.
- `controller.js` maps Pi lifecycle events to the existing Magi artifact and
  state contract.
- `pi-runner.js` owns child-process isolation, JSONL parsing, timeout and abort
  behavior, and report production.
- `adapters/pi/skills/magi/` is the Pi runtime variant of the portable skill.
  Common prompts and references remain synchronized with `shared/magi/` using
  the repository's existing asset-consistency pattern.

No broad refactor of the OpenCode controller is part of this work. Pure
behavior may be factored into a small shared helper only when both runtimes can
consume it without changing their public behavior and tests demonstrate parity.

## Packaging and Installation

The root `package.json` gains a Pi manifest pointing at the Pi extension and
skill directories. The published file list also includes `adapters/pi/`, so
both Git and npm package layouts contain the declared resources. The root
`npm test` script must explicitly include `test/pi-adapter.test.mjs` alongside
the existing test files, so `npm test` and CI run the Pi tests as part of the
full repository suite rather than relying on focused invocation.

The root package also declares a peer-only contract for the host modules the Pi
adapter actually imports:

- `package.json` `peerDependencies` lists only host modules the Pi adapter
  actually imports, expected to be `@earendil-works/pi-coding-agent` and
  `typebox`, each with a `"*"` range.
- Each of those entries is marked `"optional": true` in
  `peerDependenciesMeta`, so npm 7+ does not auto-install the Pi runtime
  dependencies for OpenCode-only consumers who never use the Pi adapter.
- None of them may appear in `dependencies` or `bundledDependencies`; the
  adapter must resolve them from the host Pi runtime, never a bundled copy.
- Tests must verify this exact manifest contract and that the Pi adapter
  imports only declared host peers.
- If the implementation later needs another Pi core module, it is added by the
  same rule (declared as an optional `"*"` peer and never bundled); unused
  modules must not be predeclared.

Before the feature is pushed, development installation is local:

```bash
cd /path/to/open_magi
pi install .
```

After the feature is available remotely, the documented installation is:

```bash
OPEN_MAGI_SKIP_POSTINSTALL=1 pi install git:github.com/ladiossoop5star/open_magi
```

The `OPEN_MAGI_SKIP_POSTINSTALL=1` prefix is mandatory for remote (Git) installs
because Pi runs `npm install` inside the Git checkout, which would execute the
repository root `postinstall`. That postinstall exists to configure OpenCode,
not Pi, so a remote Pi install must skip it to avoid writing OpenCode template
and skill files into the user's OpenCode configuration. Local path installs
remain as designed above; no change to the root `postinstall` is part of this
spec.

The Pi adapter uses host-provided Pi extension APIs and schema types. It must not
bundle a second copy of the Pi runtime.

## Activation

All supported entry points converge on one activation path:

- `/magi <goal>`
- `/skill:magi <goal>`
- natural language that explicitly asks to use Magi, such as `use Magi to debug
  this`, `run this with Magi`, `\u8acb\u4f7f\u7528 Magi \u8655\u7406`, or
  `\u7528 magi skill \u4f86 debug`

The Chinese request examples in this section are written in ASCII `\uXXXX`
JavaScript source notation, matching how they appear in this repository's
JavaScript sources and tests. They are not literal document text:
implementations and tests must decode them and match against the actual runtime
strings. The repository hygiene rules only permit literal Han characters in
`README.zh-TW.md`.

The `input` event runs before skill expansion. Natural-language activation is
transformed into `/skill:magi <original request>`, preserving the user's full
goal. `/magi` injects the same skill invocation rather than maintaining a
separate workflow.

Natural-language recognition requires all of the following:

1. A standalone, case-insensitive `magi` token.
2. An explicit positive use/start/run/through marker in the same request, or
   the phrase `magi skill` used as an instruction.
3. No negation that governs the Magi request.

Questions and discussion such as `What is Magi?` or
`Magi \u662f\u600e\u9ebc\u904b\u4f5c\u7684\uff1f` do not activate. Requests such
as `do not use Magi` or `\u4e0d\u8981\u4f7f\u7528 Magi` do not activate.
Extension-originated follow-ups bypass natural-language detection so activation
cannot recurse.

## Transport Gate

Transport selection occurs before native state initialization or native runner
work:

- When `HERDR_ENV=1`, the existing Herdr contract is authoritative. The exact
  `.open-magi-herdr` activation hard gate, command questions, pane ownership,
  layout, persistence, and cleanup rules remain unchanged.
- In Herdr mode, the Pi native council tool rejects invocation with a transport
  mismatch. It must not read Pi model configuration, construct a native runner,
  spawn a Pi child, or alter Herdr ownership.
- A missing, invalid, or failed Herdr configuration never falls back to the
  native Pi runner.
- Only a non-Herdr interactive Pi session may initialize or resume the native
  Pi controller.

## Pi Extension Surface

The extension registers:

- `/magi`: activates the portable Magi skill with the supplied goal.
- `/magi-setup`: interactively edits per-role Pi model overrides.
- `magi_council`: an internal tool used by the Pi Magi skill to execute a
  deliberation pass without discovering a runner through the shell.

The `magi_council` input is restricted to:

```json
{
  "projectRoot": "/absolute/project/path",
  "promptPath": ".open_magi/magi-log/round-001/council-001/prompt.md",
  "round": 1,
  "pass": 1,
  "mode": "decision"
}
```

The input is a discriminated union on `mode`, not a single object shape. The
example above is the `decision` variant. The accepted shapes are:

- `decision` requires `pass` to be a positive integer, and `promptPath` must
  resolve to `round-RRR/council-PPP/prompt.md`.
- `recon` requires `pass` to be a positive integer, and `promptPath` must
  resolve to `round-RRR/recon-PPP/prompt.md`.
- `review` must omit `pass` entirely, and `promptPath` must resolve to
  `round-RRR/review-001/prompt.md`.

`mode` uses the canonical Magi mode vocabulary: `recon`, `decision`, or
`review`. There is no `council` mode; `council-PPP` is the artifact-family
directory that `decision` mode produces. The exact path/mode invariants follow
the existing artifact contract:

- `decision` reports live at `round-RRR/council-PPP/prompt.md` and require a
  positive `pass`.
- `recon` reports live at `round-RRR/recon-PPP/prompt.md` and require a
  positive `pass`.
- `review` reports live at `round-RRR/review-001/prompt.md`; `review` has no
  pass parameter and `pass` must be absent.

A request that does not match its `mode`'s shape — for example a `review`
request carrying `pass`, or a `decision`/`recon` request missing or
non-positive `pass` — is rejected as malformed before any state check.

The tool must reject any request whose `promptPath` does not resolve to the
artifact location mandated by its `mode`, `round`, and `pass`.

Before dispatch, the tool
validates the active transport, controller mode, project root, current state,
phase, round/pass, and that the prompt resolves to the expected current Magi
artifact location. It rejects traversal and stale-pass requests. The
path/mode invariant above is part of this validation.

The extension uses Pi lifecycle events as follows:

- `input`: deterministic activation routing.
- `session_start`: recover eligible native state and restore controller-local
  state without starting a loop unexpectedly.
- `tool_call`: enforce phase write guards and protect decision artifacts.
- `agent_settled`: process question requests, advance incomplete loops, and
  reject false completion.
- `session_shutdown`: abort owned native children and release session-scoped
  resources.

## Model Configuration

Configuration is optional. Absence means every role inherits the active main Pi
model and thinking level.

User configuration:

```text
~/.pi/agent/open-magi.json
```

Project configuration:

```text
.pi/open-magi.json
```

Both literal paths above are examples only. The adapter must derive the user
configuration path with Pi's exported `getAgentDir()` (which honors
`PI_CODING_AGENT_DIR` and rebranded runtime behavior, and defaults to
`~/.pi/agent/`), appending `open-magi.json` to that directory. It must not
infer the user path from a literal `~/.pi/agent` string. The project path
follows the same rule: the adapter must locate the project configuration
directory by importing Pi's exported `CONFIG_DIR_NAME` rather than hardcoding
`.pi`, so rebranded Pi distributions resolve the same file.

Schema version 1 is strict:

```json
{
  "version": 1,
  "models": {
    "melchior": "provider/model:high",
    "balthasar": "provider/model",
    "casper": "provider/model:low"
  }
}
```

Each role is optional, but a present value must be a non-empty Pi model
selector. Unknown top-level keys, unknown roles, unsupported versions, empty
values, and malformed JSON invalidate the entire file. Invalid configuration is
never partially applied.

Resolution is per role:

```text
active main Pi model and thinking
  -> user role override
  -> trusted project role override
```

Project configuration is read only when Pi reports the project as trusted.
When it is not trusted, the adapter ignores the project file without reading
its contents and uses user/main defaults. Model selectors contain identifiers,
not credentials; credentials continue to use Pi's normal authentication
mechanisms.

`/magi-setup` asks for user or project scope and lets the user set, replace, or
clear each role override. A cleared role inherits from the lower-precedence
source. Updates are atomic and preserve unmodified valid role values. User
configuration is owner-only where file modes are supported. Project
configuration is an ordinary project file and may be committed if the team
wants shared model identifiers; it must never contain tokens or secrets.

## Native Council Runner

Pi core does not include subagents. The adapter therefore supplies a focused
council runner that starts one isolated Pi process per role. It does not expose
a general-purpose subagent tool and does not use an installed `pi-subagents`
package.

The runner resolves the current Pi invocation using the same robust order as
Pi's official subagent example: reuse the current executable/script pair when
available, handle packaged runtimes, and use `pi` from `PATH` only as the final
fallback. It always uses `spawn` with `shell: false`.

Each child is launched concurrently from the captured project root with the
equivalent restrictions:

```text
--mode json
--print
--no-session
--no-extensions
--no-skills
--no-context-files
--no-prompt-templates
--no-themes
--tools read,grep,find,ls
--no-approve
```

`--no-approve` forces each child to ignore all project-local settings,
resources, and extensions for its run, regardless of any saved trust decision
or the global `defaultProjectTrust` setting, which could otherwise auto-trust
them without prompting. Non-interactive modes never show a trust prompt, so no
approval path exists; the flag closes the silently-trusted path so project-local
Pi configuration can never weaken deliberator isolation.

The selected model and inherited thinking level are passed explicitly. A role
override that includes a thinking suffix controls that role's thinking level.
Children receive the canonical role prompt plus the current council task. They
cannot write reports themselves. The parent parses JSONL events, extracts the
final assistant response and usage metadata, validates non-empty output, and
writes the standard role report atomically.

Success reports use a Pi-specific source marker such as `report_source:
pi_json`. Failure reports use `report_source: pi_json_failed` plus a normalized
failure type. Reports may include the role, selected provider/model, timing,
exit status, and bounded diagnostic text. They never include environment dumps,
credentials, API keys, or authentication material.

The default per-role timeout remains consistent with the other native runners:
30 minutes. A valid positive `state.json.deliberatorTimeoutMs` overrides it,
clamped to the existing `HARD_MAX_DELIBERATOR_TIMEOUT_MS` of 60 minutes, so an
override can only shorten the timeout or extend it up to the same hard maximum
the other runners enforce.
Timeout or caller abort sends `SIGTERM`, waits five seconds, then sends
`SIGKILL` if the process remains alive. All owned children are reaped before the
tool settles.

## Guard, Question Firewall, and Completion Backstop

The Pi `tool_call` guard maps every mutation- or execution-capable built-in
active in the host session to the existing Magi phase policy: `write`, `edit`,
and both shell-family tools, `bash` and Pi's built-in `powershell`:

- Project code mutation is denied before the execution phase.
- Execution-phase mutation requires the current verdict artifact.
- Magi Markdown/text artifact writes remain allowed.
- Build and test commands remain allowed under the existing policy; safe
  build/test classification is explicit per shell family, so a `powershell`
  command is judged by PowerShell syntax rules rather than inheriting the Bash
  classifier by accident.
- Decision artifacts are protected while a deliberation pass is in flight.
- Mutation-target and redirect parsing retain the current guard fixes and
  negative controls, and apply to both shell-family tools with
  syntax-appropriate parsing: POSIX redirect grammar covers `bash`, while
  `powershell` targets are parsed with PowerShell redirect and assignment
  syntax rather than being squeezed through the POSIX parser.
- The guard fails closed for the unknown: if Pi reports an active built-in
  that is mutation- or execution-capable but the adapter has no explicit
  classification for it, the guard denies the call with a clear diagnostic
  instead of allowing it to bypass the phase policy, so a future Pi built-in
  can never silently escape the guard.

At `agent_settled`, the controller reads current state and required artifacts.
It performs one bounded action:

- Present a firewall-approved question through Pi's interactive UI.
- Record a denied question using the existing redaction contract.
- Inject one required continuation when the loop is incomplete.
- Inject a corrective continuation when completion artifacts or verdict
  adherence are invalid.
- Remain idle when the loop is genuinely complete or intentionally blocked.

Extension-originated continuation messages are marked so they do not reactivate
or recursively duplicate the loop. Existing no-progress limits and stale-lock
rules remain authoritative.

## Failure Semantics

Configuration and child-process failures fail closed. Normalized native runner
failure types are:

```text
invalid_config
spawn_error
model_unavailable
timeout
aborted
nonzero_exit
invalid_json
missing_final_response
```

If the child model depends on an extension provider disabled by strict
isolation, the role fails as `model_unavailable`. The adapter tells the user to
select a Pi built-in provider/model with `/magi-setup`; it never substitutes a
different model.

Every dispatched role receives either a success report or a normalized failure
report. Failure classification distinguishes pre-dispatch validation from
post-dispatch role failures, aligning with the existing deliberator failure
contract in `shared/magi/references/deliberation.md`:

- `invalid_config` is a pre-dispatch controller/tool hard error. Configuration
  validation happens before any role is dispatched, so `invalid_config` blocks
  the state and returns a clear diagnostic. It creates no role report and no
  standard envelope — never a fabricated success report, empty report, or
  placeholder artifact. Its details are conveyed only in the returned
  diagnostic.
- Only failures after a role was dispatched map to that role's standard report
  envelope. `timeout` maps to the standard report envelope with
  `status: timeout` and `failure_type: timeout`. It never halts the loop: the
  timeout report stance is `needs_evidence` with `blocking_objection: yes`, and
  the pass continues through the existing Deliberator Timeout Gate and Council
  Pass Gate (first-pass timeouts record a missing direction proposal in
  synthesis; a second-pass timeout records a veto; two or more timeouts trigger
  another pass).
- Every other post-dispatch native runner failure type (`spawn_error`,
  `model_unavailable`, `aborted`, `nonzero_exit`, `invalid_json`,
  `missing_final_response`) maps to `status: hard_error` and
  `failure_type: hard_error` in that role's standard envelope, and blocks
  according to the existing hard-error contract. The detailed native subtype is
  preserved, for observability only, in a separate bounded Pi-specific
  diagnostic field and never changes the envelope vocabulary.
- Partial output may be retained as bounded diagnostics but never promoted to a
  successful report.

## Testing Strategy

### Activation

- Verify `/magi`, `/skill:magi`, and explicit English and Chinese requests route
  to the same activation path.
- Verify informational questions, incidental mentions, and English/Chinese
  negation do not activate.
- Verify extension-originated messages cannot recursively activate Magi.
- Verify non-interactive controller modes reject activation clearly.

### Configuration

- Verify absent files inherit the main model/thinking level.
- Verify user overrides, trusted project overrides, and per-role merging.
- Verify an untrusted project file is not read.
- Verify malformed JSON, unknown fields/roles, unsupported versions, empty
  selectors, and invalid selector shapes fail closed.
- Verify invalid configuration blocks dispatch up front and no role report or
  envelope is written.
- Verify the user path is derived with `getAgentDir()` and the project path
  with `CONFIG_DIR_NAME`, including under an overridden `PI_CODING_AGENT_DIR`.
- Verify `/magi-setup` creates and atomically updates each scope, preserves
  unchanged roles, clears overrides, and applies owner-only user-file modes.

### Runner

- Use a fake Pi executable to verify three children start concurrently and use
  the exact isolation arguments, cwd, role prompt, model, and thinking level.
- Verify executable resolution does not accidentally select an unrelated Pi
  from `PATH` when the current invocation is reusable.
- Verify JSONL parsing, successful report content, usage capture, invalid JSON,
  missing final output, non-zero exit, unavailable model, spawn failure,
  timeout escalation, abort propagation, and child reaping.
- Verify no model fallback and no secret/environment logging.

### Lifecycle and Guard

- Verify code writes are denied before execution and allowed only after the
  current verdict in execution.
- Verify Magi artifact writes, build/test exceptions, redirect parsing, and
  protected decision artifacts.
- Verify `powershell` mutation is denied before execution and allowed only
  after the current verdict in execution, that its build/test exceptions are
  classified with PowerShell syntax rules rather than inherited from the Bash
  classifier, and that an unknown active mutation- or execution-capable
  built-in fails closed.
- Verify `agent_settled` continuation, approved and denied questions,
  false-completion repair, completion silence, stale locks, and no-progress
  limits.
- Verify `magi_council` rejects union-shape mismatches — a `review` request
  carrying `pass`, or a `decision`/`recon` request missing or non-positive
  `pass` — before any state check.

### Herdr Regression

- Under `HERDR_ENV=1`, assert that Pi configuration loading, native runner
  construction, and child spawning never occur.
- Verify missing or invalid `.open-magi-herdr` behavior continues to ask first
  and never falls back.
- Verify the existing three-pane lifecycle, persistence, ownership, and cleanup
  contract remains unchanged.

### Packaging and Documentation

- Install the local root package into an isolated `PI_CODING_AGENT_DIR` and
  verify Pi discovers the extension and Magi skill without network access.
- Verify every Pi manifest path exists and `npm pack` contains the Pi adapter.
- Verify the root manifest declares only the imported host modules as optional
  `"*"` peers (`@earendil-works/pi-coding-agent`, `typebox`), marks them
  `"optional": true` in `peerDependenciesMeta`, excludes them from
  `dependencies` and `bundledDependencies`, and that the adapter imports only
  declared host peers.
- Keep shared Magi asset parity checks green.
- Document experimental status, local and Git installation, activation,
  `/magi-setup`, configuration precedence, strict native isolation, supported
  modes, and Herdr bypass in `README.md`, `README.zh-TW.md`, and
  `adapters/pi/README.md`.
- The `package.json` test script must explicitly list
  `test/pi-adapter.test.mjs`; verify `npm test` executes the Pi tests.
- Run focused Pi tests and the complete existing `npm test` suite.

## Acceptance Criteria

1. `pi install .` discovers one Open Magi extension and the Magi skill from the
   repository root package.
2. An interactive Pi user can activate Magi with `/magi`, `/skill:magi`, or an
   explicit supported natural-language request.
3. In non-Herdr mode, a council pass launches exactly three concurrent,
   isolated, read-only Pi children and writes three valid standard reports.
4. Per-role user/project model overrides resolve correctly, with absent roles
   inheriting from the active main Pi session.
5. Invalid configuration blocks dispatch before any role report is written;
   unavailable extension-provider models, aborts, malformed output, and
   process errors fail closed without fallback; timeouts follow the existing
   Deliberator Timeout Gate and continue through the Council Pass Gate.
6. Pi lifecycle hooks enforce phase mutation rules, question firewall behavior,
   bounded continuation, and completion verification.
7. In Herdr mode, no native Pi config or runner path executes and all existing
   Herdr behavior remains unchanged.
8. Pi support is documented as experimental, all focused tests pass, and the
   full repository suite remains green.
