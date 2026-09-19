# Pi Agent Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement experimental native Pi support for Open Magi (adapter + native council runner + guard + packaging) exactly as specified in `docs/superpowers/specs/2026-09-19-pi-agent-support-design.md`.

**Architecture:** A new `adapters/pi/` extension is discovered by Pi from the repository root package manifest (`package.json` → `pi` key, optional `"*"` peers, `files` including `adapters/pi/`). `extension.js` registers `/magi`, `/magi-setup`, an internal `magi_council` tool, and Pi lifecycle handlers (`input`, `session_start`, `tool_call`, `agent_settled`, `session_shutdown`), routing to four focused library modules: `activation.js` (natural-language/slash routing and the expandPromptTemplates/followUp injection), `config.js` (strict schema-1 model override resolution via `getAgentDir()`/`CONFIG_DIR_NAME`), `controller.js` (transport gate, guard classification, phase guard port, magi_council input union validation, required-artifact computation, `agent_settled` actions), and `pi-runner.js` (three concurrent isolated JSON-mode Pi children, JSONL parsing, failure normalization, report writing).

**Tech Stack:** Node.js ≥20 (ESM, `node:test` + `node:assert/strict`), Pi 0.85.1 extension API (`@earendil-works/pi-coding-agent` host peer, `typebox` for tool schemas), existing OpenCode plugin artifact conventions (`index.js`) and Codex runner patterns (`adapters/codex/lib/codex-runner.js`).

## Global Constraints

- Host is interactive Pi only: `ctx.mode === "tui"` activates Magi; `rpc`/`json`/`print` modes reject activation with `ctx.ui.notify(..., "error")` or a returned handled action explaining the limitation.
- Third-party package `pi-subagents` must NOT appear anywhere; `grep -r "pi-subagents" adapters/pi test` must return only the negative-assertion test.
- Host modules are imported only via host peers: `@earendil-works/pi-coding-agent` and `typebox`; both declared `"peeredDependencies"` entries `"*"` with `"optional": true` in `peerDependenciesMeta`; never in `dependencies` or `bundledDependencies`.
- Never bundle or re-import a second copy of the Pi runtime; never spawn `npx pi`/`npm-view` chains in the runner; child invocation comes from `resolvePiInvocation` only (current script → packaged runtime → `pi` from PATH last, always `spawn(..., { shell: false })`).
- The HERDR_ENV=1 transport gate runs before any native config read, controller initialization, or runner work. In Herdr mode `magi_council` rejects with `transport mismatch`. No fallback Herdr→native or native→Herdr in either direction.
- Chinese natural-language examples are matched at runtime as decoded strings; source code carries them as `"\u2026"` ASCII escapes. Literal Han characters may appear ONLY in `README.zh-TW.md` (root) and never in `adapters/pi/**` or `test/**` sources.
- `HARD_MAX_DELIBERATOR_TIMEOUT_MS = 60 * 60 * 1000`; default deliberator timeout `30 * 60 * 1000` (constants mirrored from `index.js:14-16`).
- Report files are written with the atomic tmp+rename pattern from `index.js` `writeState`; reports live at `join(dirname(promptPath), `report-${sage}.md`)` exactly like `adapters/codex/lib/codex-runner.js:63-65`.
- Failure envelope vocabulary stays `status: ok | timeout | hard_error`, `failure_type: none | timeout | hard_error`; native subtypes (`spawn_error`, `model_unavailable`, `aborted`, `nonzero_exit`, `invalid_json`, `missing_final_response`, `invalid_config`) appear ONLY in the bounded `pi_diag:` field, never in envelope fields.
- Success marker `report_source: pi_json`; failure marker `report_source: pi_json_failed`.
- Guard verdicts come only from Pi's tool API: a tool is a builtin iff `toolInfo.sourceInfo.source === "builtin"`; guard set = `pi.getActiveTools()` ∩ builtins; unknown active builtin blocks activation/dispatch fail-closed.
- `npm test` must read `node --test test/package.test.mjs test/plugin.test.mjs test/setup.test.mjs test/pi-adapter.test.mjs`.
- Branch is `feat/pi-agent-support`; never push or merge in this plan's tasks.
- The OpenCode plugin (`index.js`) gains no Pi-specific branches; pure code stays adapter-local.

## File Structure

Create:

```text
adapters/pi/README.md                  adapter docs (Status/Install/Usage/Herdr Precedence, links README.md#herdr-native-deliberation)
adapters/pi/extension.js               Pi extension entry: registers commands, tool, lifecycle handlers; binds modules, no business logic
adapters/pi/lib/activation.js          natural-language + slash activation routing, injection text, streaming deliverAs
adapters/pi/lib/config.js              schema-1 config load/validate/resolve/atomic-write with getAgentDir()+CONFIG_DIR_NAME
adapters/pi/lib/controller.js          transport gate, guard classification+phase guard (bash+powershell), magi_council union validation, required artifacts, agent_settled actions
adapters/pi/lib/pi-runner.js           Pi executable resolution, isolated JSON-mode children, JSONL parsing, failure normalization, atomic reports
adapters/pi/skills/magi/SKILL.md       Pi runtime skill (adds "## Pi Bootstrap Gate"; no OpenCode/Codex/Claude bootstrap gates)
adapters/pi/skills/magi/prompts/{melchior,balthasar,casper}.md   byte-identical copies of shared prompts
adapters/pi/skills/magi/references/{checklist-template,deliberation,execution-and-verification,herdr,protocol,question-firewall,troubleshooting}.md  byte-identical copies of shared references
adapters/pi/skills/magi/references/runtime.md   Pi Runtime Reference (unique)
test/pi-adapter.test.mjs               every Pi adapter behavior test (unit + spawned fake-Pi processes)
```

Modify:

```text
package.json                           adds pi manifest, adapters/pi in files, optional peers, test script entry (Task 1)
test/package.test.mjs                  extends asset-parity loops to adapters/pi, runtime.md matchers, Han-char probe, pack expectations (Tasks 1-2)
README.md                              "Pi Activation and Install" section (Task 10)
README.zh-TW.md                        zh-TW section mirroring Task 10 (Task 10)
```

Each file has one responsibility, as listed. No other files change.

---

### Task 1: Package manifest, peers, and test wiring

**Files:**
- Modify: `package.json`
- Test: `test/pi-adapter.test.mjs` (this task creates the file with its first tests)

**Interfaces:**
- Consumes: nothing.
- Produces: `package.json` `pi` manifest read by Task 2/11; `test/pi-adapter.test.mjs` exists and is in `npm test`; manifest-contract test that later tasks keep green.

- [ ] **Step 1: Write the failing tests**

Create `test/pi-adapter.test.mjs` with these first tests:

```js
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))

test("package.json declares a Pi manifest pointing at the extension and skill roots", () => {
  assert.deepEqual(pkg.pi, {
    extensions: ["./adapters/pi/extension.js"],
    skills: ["./adapters/pi/skills"],
  })
})

test("published file list contains adapters/pi and keeps existing entries", () => {
  for (const entry of ["bin", "index.js", "lib", "skills", "README.md", "README.zh-TW.md", "LICENSE", "adapters/pi"]) {
    assert.ok(pkg.files.includes(entry), `files must include ${entry}`)
  }
})

test("Pi host modules are optional wildcard peers and never bundled", () => {
  assert.deepEqual(pkg.peerDependencies, {
    "@earendil-works/pi-coding-agent": "*",
    typebox: "*",
  })
  assert.deepEqual(pkg.peerDependenciesMeta, {
    "@earendil-works/pi-coding-agent": { optional: true },
    typebox: { optional: true },
  })
  assert.ok(!pkg.dependencies || !pkg.dependencies["@earendil-works/pi-coding-agent"])
  assert.ok(!pkg.dependencies || !pkg.dependencies.typebox)
  const raw = readFileSync(join(repoRoot, "package.json"), "utf8")
  assert.ok(!/"bundledDependencies"/.test(raw), "no bundledDependencies key expected")
})

test("npm test script runs the Pi adapter tests", () => {
  assert.match(pkg.scripts.test, /(^|\s)test\/pi-adapter\.test\.mjs/)
  assert.match(pkg.scripts.test, /node --test/)
})

test("third-party subagent package is excluded", () => {
  for (const field of ["dependencies", "devDependencies"]) {
    assert.ok(!pkg[field] || !pkg[field]["pi-subagents"])
  }
})
```

(The "Pi manifest paths exist on disk" test is written in Task 2, where the files it checks are first committed.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/pi-adapter.test.mjs`
Expected: FAIL — `pkg.pi` is `undefined` (deepEqual throws ComparisonError), manifest paths missing (`ENOENT`), and `peeredDependencies` absent.

- [ ] **Step 3: Write minimal implementation in `package.json`**

Apply these exact edits:

1. Add to root object (order: after `exports`, before `bin`):

```json
"pi": {
  "extensions": ["./adapters/pi/extension.js"],
  "skills": ["./adapters/pi/skills"]
},
```

2. Replace `"files"` with:

```json
"files": [
  "bin",
  "index.js",
  "lib",
  "skills",
  "README.md",
  "README.zh-TW.md",
  "LICENSE",
  "adapters/pi"
],
```

3. Replace `"test"` script with:

```json
"test": "node --test test/package.test.mjs test/plugin.test.mjs test/setup.test.mjs test/pi-adapter.test.mjs"
```

4. Add after `"engines"`:

```json
"peerDependencies": {
  "@earendil-works/pi-coding-agent": "*",
  "typebox": "*"
},
"peerDependenciesMeta": {
  "@earendil-works/pi-coding-agent": { "optional": true },
  "typebox": { "optional": true }
},
```

- [ ] **Step 4: Run tests**

Run: `node --test test/pi-adapter.test.mjs`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add package.json test/pi-adapter.test.mjs
git commit -m "feat(pi): declare Pi manifest, optional host peers, and test wiring"
```

---

### Task 2: Pi skill assets, parity, and manifest-path existence

**Files:**
- Create: `adapters/pi/skills/magi/SKILL.md`, `adapters/pi/skills/magi/references/runtime.md`, `adapters/pi/README.md`
- Copy (byte-identical): `adapters/pi/skills/magi/prompts/{melchior,balthasar,casper}.md` from `shared/magi/prompts/`; `adapters/pi/skills/magi/references/{checklist-template,deliberation,execution-and-verification,herdr,protocol,question-firewall,troubleshooting}.md` from `shared/magi/references/`
- Test: `test/pi-adapter.test.mjs` (append), `test/package.test.mjs` (modify two loops)

**Interfaces:**
- Consumes: `package.json` `pi` manifest from Task 1; `sharedMagiReferences` array in `test/package.test.mjs:24-32`.
- Produces: `adapters/pi/skills/magi/**` assets loaded by Pi "pi install ."; parity expectations used by the full suite.

- [ ] **Step 1: Write the failing tests**

Append to `test/pi-adapter.test.mjs`:

```js
test("Pi manifest paths exist on disk", () => {
  for (const relative of [
    "adapters/pi/extension.js",
    "adapters/pi/skills/magi/SKILL.md",
    "adapters/pi/README.md",
  ]) {
    assert.ok(readFileSync(join(repoRoot, relative), "utf8").length > 0, `${relative} must exist`)
  }
})

test("Pi adapter assets contain no Han characters", () => {
  const hanPattern = /\p{Script=Han}/u
  const files = [
    "adapters/pi/README.md",
    "adapters/pi/skills/magi/SKILL.md",
    "adapters/pi/skills/magi/references/runtime.md",
  ]
  for (const file of files) {
    assert.ok(!hanPattern.test(readFileSync(join(repoRoot, file), "utf8")), `${file} must not contain Han characters`)
  }
})
```

In `test/package.test.mjs`:

1. Change the parity loop in test `"shared Magi prompts and common references are identical across adapter skills"` (L2558): the test iterates adapter skill roots. Find the array or map of adapter skill directories used (it enumerates `skills/magi/`, `adapters/codex/skills/magi/`, `adapters/claude/skills/magi/`) and add `"adapters/pi/skills/magi/"`. All 7 `sharedMagiReferences` + 3 prompts become byte-compared against `adapters/pi/skills/magi/` too.
2. In the same test, extend the runtime.md trio to a quartet: add `adapters/pi/skills/magi/references/runtime.md`, assert it matches `/Pi Runtime Reference/`, is pairwise different from the existing three, and that it must NOT match `/OpenCode Runtime Reference|Codex Runtime Reference|Claude Runtime Reference/` nor `/Codex Bootstrap Gate|Claude Bootstrap Gate/`.
3. In test `"bundled magi skill assets contain the expected contract"` (L2129): add `assert.match(piSkill, /Pi Bootstrap Gate/)` and `assert.doesNotMatch(piSkill, /OpenCode Bootstrap Gate|Codex Bootstrap Gate|Claude Bootstrap Gate/)`.
4. In the Han-character test block (uses `hanPattern`, `test/package.test.mjs:18`): add the `adapters/pi/*SKILL.md` + runtime.md paths to the scanned set.
5. In the pack-file test `"package metadata exposes OpenCode plugin, setup CLI, and injected plugin tests"` (L330): the pack must now include `adapters/pi`; assert on the produced pack file list `assert.ok(names.some((n) => n.startsWith("adapters/pi/")))` next to the existing inclusion patterns.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/pi-adapter.test.mjs test/package.test.mjs`
Expected: FAIL — `ENOENT adapters/pi/extension.js`, parity tests fail ("adapters/pi/skills/magi/ is missing…"), pack assertions fail on `npm pack` output.

- [ ] **Step 3: Create the assets**

```bash
mkdir -p adapters/pi/skills/magi/prompts adapters/pi/skills/magi/references
for role in melchior balthasar casper; do cp shared/magi/prompts/$role.md adapters/pi/skills/magi/prompts/$role.md; done
for ref in checklist-template deliberation execution-and-verification herdr protocol question-firewall troubleshooting; do cp shared/magi/references/$ref.md adapters/pi/skills/magi/references/$ref.md; done
cp skills/magi/SKILL.md adapters/pi/skills/magi/SKILL.md
cp skills/magi/references/runtime.md adapters/pi/skills/magi/references/runtime.md
mkdir -p adapters/pi/lib
```

Then edit `adapters/pi/skills/magi/SKILL.md`:

1. Replace the "## Herdr Magi Activation Hard Gate" section content with:

```markdown
## Pi Bootstrap Gate

This adapter runs under Pi. Activate Magi with `/magi <goal>`, `/skill:magi <goal>`,
or an explicit request to use Magi. Natural-language activation is performed by the
Open Magi Pi extension before skill expansion; do not hand-route.

- In Herdr mode (`HERDR_ENV=1`), the `.open-magi-herdr` hard gate, command
  questions, pane ownership, layout, persistence, and cleanup rules keep the
  existing Herdr contract; the native Pi council never runs.
- Outside Herdr, deliberation is launched by the `magi_council` tool, which
  starts three isolated read-only Pi children. Do not discover a runner
  through the shell and do not spawn deliberators yourself.
```

2. Keep every other section byte-identical to `skills/magi/SKILL.md` (the six-phase protocol, gates, report format, question firewall text are runtime-host agnostic; do not mention OpenCode, Codex, or Claude anywhere in the runtime.md — its matcher asserts that).

Replace `adapters/pi/skills/magi/references/runtime.md` content with (replace the whole file):

```markdown
# Pi Runtime Reference

This runtime governs Open Magi natives under Pi 0.85.1. Existing protocol,
prompts, reports, phases, and artifact contracts apply unchanged. Only the
transport mechanics differ from the OpenCode runtime.

## Status

Experimental. OpenCode is the supported production runtime; Pi support is
experimental until validated in real usage.

## Activation

- `/magi <goal>` — dispatches to the Magi skill with the goal.
- `/skill:magi <goal>` — direct skill invocation.
- Natural language — the extension's `input` handler detects an explicit
  standalone `magi` token plus a use/start/run/through marker (or `magi skill`
  as an instruction), with no governing negation, and rewrites the request to
  `/skill:magi <original request>`. `expandPromptTemplates: true` drives skill
  expansion; `deliverAs: "followUp"` is used whenever the agent is streaming
  so the queued injection cannot throw.
- Informational questions (`What is Magi?`) and negations (`do not use Magi`)
  never activate.

## Non-Interactive Rejection

Magi only activates on an interactive Pi session (`ctx.mode` is `tui`). In
`rpc`, `json`, and `print` modes the extension rejects activation with a clear
message instead of initializing controller state.

## Model Overrides

- User scope: `getAgentDir()/open-magi.json`.
- Project scope: `CONFIG_DIR_NAME/open-magi.json` under the project root, read
  only when the project is trusted.
- Schema:

{
  "version": 1,
  "models": {
    "melchior": "provider/model:high",
    "balthasar": "",
    "casper": ""
  }
}

Version 1 is strict: unknown keys, roles, versions, empty values, or malformed
JSON invalidate the entire file. Edit with `/magi-setup`. Absent files mean
every role inherits the active main Pi model and thinking level.

## Native Council

The `magi_council` tool runs a single deliberation pass: three concurrent
isolated Pi children in JSON mode with `--mode json --print --no-session
--no-extensions --no-skills --no-context-files --no-prompt-templates
--no-themes --tools read,grep,find,ls --no-approve`, per-role model/thinking
passed explicitly. Children cannot write reports; the parent parses JSONL,
extracts the final assistant message and usage, and atomically writes
`report-<sage>.md` next to the pass prompt. Success markers are
`report_source: pi_json`; failures use `report_source: pi_json_failed` with a
normalized failure type and a bounded `pi_diag:` field. Timeouts default to
30 minutes and are clamped to 60 minutes.

## Herdr Precedence

Under `HERDR_ENV=1`, the `.open-magi-herdr` file gate, pane ownership, and the
three-pane lifecycle stay authoritative, and the native council tool rejects
invocation. See README.md#herdr-native-deliberation.
```

Create `adapters/pi/README.md`:

```markdown
# Open Magi for Pi

## Status

Experimental. OpenCode remains the only production-supported runtime; the Pi
adapter follows the same maturity as Codex and Claude adaption releases.

## Install for Local Development

```bash
cd /path/to/open_magi
pi install .
```

Remote (Git) installs require skipping the repo root `postinstall` (which
configures OpenCode, not Pi):

```bash
OPEN_MAGI_SKIP_POSTINSTALL=1 pi install git:github.com/ladiossoop5star/open_magi
```

## Usage

- `/magi <goal>`, `/skill:magi <goal>`, or an explicit use-Magi request starts
  the loop on an interactive Pi session.
- `/magi-setup` edits per-role model overrides (user scope owner-only 0600;
  project scope read only when the project is trusted).
- Deliberation runs through the internal `magi_council` tool: three isolated
  read-only Pi children in JSON mode, atomic `report-*.md` writes, fail-closed
  error envelopes.

## Herdr Precedence

Herdr (`HERDR_ENV=1`) remains authoritative: activate through
`.open-magi-herdr`, keep the existing pane protocol, and never fall back to
the native Pi council. See README.md#herdr-native-deliberation.

## Limitations

- No print/JSON/RPC main controller.
- No general Pi subagents; the runner is council-only.
- Deliberator children load no user extensions, skills, prompt templates,
  themes, or project context files.
```

- [ ] **Step 4: Run tests**

Run: `node --test test/pi-adapter.test.mjs test/package.test.mjs`
Expected: PASS — parity includes `adapters/pi`; note `extension.js` exists test will still fail with `ENOENT` (created in Task 3): create the placeholder **directory-aware** empty-necessary file now to keep parity green: write `adapters/pi/extension.js` with only `export default function () {}` (its real tests start at Task 3).

Run again: `node --test test/pi-adapter.test.mjs test/package.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add adapters/pi test/pi-adapter.test.mjs test/package.test.mjs README.md README.zh-TW.md README.md adapters/pi/README.md
git commit -m "feat(pi): add Pi skill assets, runtime reference, and parity coverage"
```

---

### Task 3: Activation — `adapters/pi/lib/activation.js`

**Files:**
- Create: `adapters/pi/lib/activation.js`
- Test: `test/pi-adapter.test.mjs` (append)

**Interfaces:**
- Consumes: nothing (pure module).
- Produces:
  - `detectActivation(text: string, context: { source: "interactive" | "rpc" | "extension" | "rpc"; mode: string; })` → `{ action: "activate", goal: string } | { action: "handled" } | { action: "continue" }`.
  - `MAGI_COMMAND = "/magi"` and `SKILL_COMMAND = "skill:magi"` constants.
  - `buildSkillInvocation(goal: string): string` → `"/skill:magi " + goal-trimmed`.
  - `injectionOptions(isStreaming: boolean)` → `{ expandPromptTemplates: true }` plus `deliverAs: "followUp"` iff `isStreaming`.

- [ ] **Step 1: Write the failing tests**

Append to `test/pi-adapter.test.mjs`:

```js
import { detectActivation, MAGI_COMMAND, SKILL_COMMAND, buildSkillInvocation, injectionOptions } from "../adapters/pi/lib/activation.js"

const interactive = { source: "interactive", mode: "tui" }

test("extension exports the slash commands", () => {
  assert.equal(MAGI_COMMAND, "/magi")
  assert.equal(SKILL_COMMAND, "skill:magi")
})

test("buildSkillInvocation preserves the full goal", () => {
  assert.equal(buildSkillInvocation("  fix the tests  "), "/skill:magi fix the tests")
})

test("injectionOptions expands prompt templates and follows up when streaming", () => {
  assert.deepEqual(injectionOptions(true), { expandPromptTemplates: true, deliverAs: "followUp" })
  assert.deepEqual(injectionOptions(false), { expandPromptTemplates: true })
})

test("slash /magi activates with the supplied goal", () => {
  assert.deepEqual(detectActivation("/magi fix login", interactive), { action: "activate", goal: "fix login" })
  assert.equal(detectActivation("/magi", interactive).goal, "")
})

test("natural-language English requests activate", () => {
  assert.deepEqual(detectActivation("use Magi to debug this", interactive), { action: "activate", goal: "use Magi to debug this" })
  assert.deepEqual(detectActivation("run this with Magi", interactive).action, "activate")
})

test("natural-language Chinese requests activate", () => {
  assert.deepEqual(detectActivation("\u8acb\u4f7f\u7528 Magi \u8655\u7406\u9019\u500b\u554f\u984c", interactive).action, "activate")
  assert.deepEqual(detectActivation("\u7528 magi skill \u4f86 debug", interactive).action, "activate")
})

test("informational questions do not activate", () => {
  assert.equal(detectActivation("What is Magi?", interactive).action, "continue")
  assert.equal(detectActivation("Magi \u662f\u600e\u9ebc\u904b\u4f5c\u7684\uff1f", interactive).action, "continue")
})

test("incidental mentions without use/start/run markers do not activate", () => {
  assert.equal(detectActivation("magi has three roles", interactive).action, "continue")
})

test("negations do not activate", () => {
  assert.equal(detectActivation("do not use Magi", interactive).action, "continue")
  assert.equal(detectActivation("\u4e0d\u8981\u4f7f\u7528 Magi", interactive).action, "continue")
})

test("extension-originated input never activates", () => {
  assert.equal(detectActivation("use Magi now", { source: "extension", mode: "tui" }).action, "continue")
})

test("non-interactive modes reject activation with a clear explanation", () => {
  const result = detectActivation("/magi fix login", { source: "interactive", mode: "json" })
  assert.equal(result.action, "handled")
  assert.match(result.message, /interactive/)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/pi-adapter.test.mjs`
Expected: FAIL — `Cannot find module ../adapters/pi/lib/activation.js` (ERR_MODULE_NOT_FOUND).

- [ ] **Step 3: Write minimal implementation — `adapters/pi/lib/activation.js`**

```js
export const MAGI_COMMAND = "/magi"
export const SKILL_COMMAND = "skill:magi"

const NO_ACTIVATION = { action: "continue" }

const USE_MARKERS = [
  "use magi",
  "use the magi",
  "run magi",
  "run with magi",
  "start magi",
  "start with magi",
  "through magi",
  "magi skill",
]
const NEGATION_MARKERS = [
  "don't use magi",
  "do not use magi",
  "no magi",
  "without magi",
  "\u4e0d\u8981\u4f7f\u7528 magi",
  "\u4e0d\u7528 magi",
  "\u52ff\u7528 magi",
]
const QUESTION_SUFFIXES = ["?", "\uff1f"]

function normalize(text) {
  return String(text || "").trim().toLowerCase()
}

function containsStandaloneMagi(text) {
  return /(^|[^a-z0-9])magi([^a-z0-9]|$)/.test(text)
}

function hasPositiveMarker(text) {
  return USE_MARKERS.some((marker) => text.includes(marker))
}

function hasNegation(text) {
  return NEGATION_MARKERS.some((marker) => text.includes(marker))
}

function isQuestionText(text) {
  return QUESTION_SUFFIXES.some((suffix) => text.endsWith(suffix))
}

export function isInteractiveHost(context) {
  return context?.mode === "tui"
}

export function buildSkillInvocation(goal) {
  return `/${SKILL_COMMAND} ${String(goal || "").trim()}`
}

export function injectionOptions(isStreaming) {
  return isStreaming ? { expandPromptTemplates: true, deliverAs: "followUp" } : { expandPromptTemplates: true }
}

export function detectActivation(text, context) {
  const source = context?.source ?? "interactive"
  if (source === "extension") return NO_ACTIVATION

  const raw = String(text ?? "")
  const normalized = normalize(raw)

  if (!isInteractiveHost(context)) {
    return {
      action: "handled",
      message:
        "[magi] Non-interactive Pi sessions do not run Magi. Open an interactive Pi session and use /magi <goal>.",
    }
  }

  if (normalized.startsWith(`${MAGI_COMMAND} `) || normalized === MAGI_COMMAND) {
    return { action: "activate", goal: normalized === MAGI_COMMAND ? "" : normalized.slice(MAGI_COMMAND.length + 1).trim() }
  }

  if (containsStandaloneMagi(normalized) && !hasNegation(normalized) && !isQuestionText(normalized) && hasPositiveMarker(normalized)) {
    return { action: "activate", goal: raw.trim() }
  }

  return NO_ACTIVATION
}
```

- [ ] **Step 4: Run tests**

Run: `node --test test/pi-adapter.test.mjs`
Expected: PASS (all Task 1 + Task 2 + Task 3 tests).

- [ ] **Step 5: Commit**

```bash
git add adapters/pi/lib/activation.js test/pi-adapter.test.mjs
git commit -m "feat(pi): add activation routing with streaming-safe skill injection"
```

---

### Task 4: Model configuration — `adapters/pi/lib/config.js`

**Files:**
- Create: `adapters/pi/lib/config.js`
- Test: `test/pi-adapter.test.mjs` (append)

**Interfaces:**
- Consumes: `getAgentDir` and `CONFIG_DIR_NAME` from the host peer `@earendil-works/pi-coding-agent` (imported but mocked in tests via an injected `hostModule` option so the suite never requires the real Pi package).
- Produces:
  - `ROLE_NAMES = ["melchior", "balthasar", "casper"]`
  - `MODEL_CONFIG_VERSION = 1`, `MODEL_CONFIG_FILE = "open-magi.json"`
  - `userModelConfigPath({ readFile?, hostModule? })` → absolute path `join(getAgentDir(), "open-magi.json")`
  - `projectModelConfigPath(projectRoot)` → `join(projectRoot, CONFIG_DIR_NAME, "open-magi.json")`
  - `parseModelSelector(selector: string)` → `{ model: string, thinking: string | null }`
  - `loadModelConfig({ projectRoot, isProjectTrusted, readFileImpl?, hostModule? })`
  - `resolveRoleModels(mainModel, mainThinking, userConfig, projectConfig)` → `{ melchior: {model, thinking}, balthasar: ..., casper: ... }`
  - `writeModelConfig(targetPath, { version: 1, models }, { scope: "user" | "project" })` atomic, chmod `0600` when `scope === "user"` and the platform supports it.

- [ ] **Step 1: Write the failing tests**

```js
import {
  ROLE_NAMES, userModelConfigPath, projectModelConfigPath, parseModelSelector,
  loadModelConfig, resolveRoleModels, writeModelConfig, MODEL_CONFIG_VERSION,
} from "../adapters/pi/lib/config.js"

const fakeHost = (agentDir, configDirName = ".pi") => ({
  getAgentDir: () => agentDir,
  CONFIG_DIR_NAME: configDirName,
})

test("user config path derives from getAgentDir", () => {
  assert.equal(userModelConfigPath({ hostModule: fakeHost("/tmp/agentdir") }), "/tmp/agentdir/open-magi.json")
})

test("user config path honors an overridden PI_CODING_AGENT_DIR through getAgentDir", () => {
  const envHost = {
    getAgentDir: () => process.env.PI_CODING_AGENT_DIR || "/default/agentdir",
    CONFIG_DIR_NAME: ".pi",
  }
  const previous = process.env.PI_CODING_AGENT_DIR
  process.env.PI_CODING_AGENT_DIR = "/tmp/pi-alt"
  try {
    assert.equal(userModelConfigPath({ hostModule: envHost }), "/tmp/pi-alt/open-magi.json")
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = previous
  }
})

test("project config path uses CONFIG_DIR_NAME, not a hardcoded .pi", () => {  assert.equal(projectModelConfigPath("/proj", { hostModule: fakeHost("/x", ".pi") }), "/proj/.pi/open-magi.json")
  assert.equal(projectModelConfigPath("/proj", { hostModule: fakeHost("/x", ".otherpi") }), "/proj/.otherpi/open-magi.json")
})

test("parseModelSelector splits thinking suffix", () => {
  assert.deepEqual(parseModelSelector("provider/model:high"), { model: "provider/model", thinking: "high" })
  assert.deepEqual(parseModelSelector("provider/model"), { model: "provider/model", thinking: null })
})

test("absent files inherit main model and thinking", async () => {
  const config = await loadModelConfig({
    projectRoot: "/proj",
    isProjectTrusted: false,
    readFileImpl: async (path) => { throw new Error("ENOENT " + path) },
    hostModule: fakeHost("/tmp/agentdir"),
  })
  assert.equal(config.ok, true)
  assert.equal(config.user, null)
  assert.equal(config.project, null)
  const resolved = resolveRoleModels("main/model", "low", config.user, config.project)
  assert.deepEqual(resolved.melchior, { model: "main/model", thinking: "low" })
})

test("valid user and trusted project overrides resolve per role", async () => {
  const user = { version: 1, models: { melchior: "user/provider/model:high" } }
  const project = { version: 1, models: { melchior: "proj/model:low", casper: "proj/casper:low" } }
  const config = await loadModelConfig({
    projectRoot: "/proj",
    isProjectTrusted: true,
    readFileImpl: async (path) => (String(path).startsWith("/proj/") ? JSON.stringify(project) : JSON.stringify(user)),
    hostModule: fakeHost("/usr/temp/agentdir"),
  })
  assert.equal(config.ok, true)
  const resolved = resolveRoleModels("main/model", "low", config.user, config.project)
  assert.deepEqual(resolved.melchior, { model: "proj/model", thinking: "low" })
  assert.deepEqual(resolved.casper, { model: "proj/casper", thinking: "low" })
  assert.deepEqual(resolved.balthasar, { model: "main/model", thinking: "low" })
})

test("untrusted project config is never read", async () => {
  let called = 0
  const config = await loadModelConfig({
    projectRoot: "/proj",
    isProjectTrusted: false,
    readFileImpl: async (path) => { called += 1; return "{}" },
    hostModule: fakeHost("/x"),
  })
  assert.ok(!config.projectRead)
  assert.equal(config.project, null)
})

test("malformed configuration fails closed wholesale", async () => {
  const badCases = [
    '{"version":2,"models":{}}',
    '{"version":1,"models":{"nemo":"p/m"}}',
    '{"version":1,"models":{"melchior":""}}',
    '{"version":1,"models":{"melchior":"p/m"},"extra":true}',
    "not json",
  ]
  for (const [index, raw] of badCases.entries()) {
    const config = await loadModelConfig({
      projectRoot: "/proj",
      isProjectTrusted: false,
      readFileImpl: async () => raw,
      hostModule: fakeHost("/x"),
    })
    assert.equal(config.ok, false, `case ${index} must fail closed`)
    assert.match(config.error, /open-magi/)
  }
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/pi-adapter.test.mjs`
Expected: FAIL — `ERR_MODULE_NOT_FOUND .../config.js`.

- [ ] **Step 3: Write minimal implementation — `adapters/pi/lib/config.js`**

```js
import { join } from "node:path"
import { mkdtemp, rm, writeFile, readFile, chmod, rename } from "node:fs/promises"
import { tmpdir } from "node:os"

export const ROLE_NAMES = ["melchior", "balthasar", "casper"]
export const MODEL_CONFIG_VERSION = 1
export const MODEL_CONFIG_FILE = "open-magi.json"

export function userModelConfigPath({ hostModule } = {}) {
  const { getAgentDir } = resolveHost(hostModule)
  return join(getAgentDir(), MODEL_CONFIG_FILE)
}

export function projectModelConfigPath(projectRoot, { hostModule } = {}) {
  const { CONFIG_DIR_NAME } = resolveHost(hostModule)
  return join(projectRoot, CONFIG_DIR_NAME, MODEL_CONFIG_FILE)
}

function resolveHost(hostModule) {
  if (hostModule) return hostModule
  return peeredHost()
}

let cachedHost = null
function peeredHost() {
  if (!cachedHost) {
    throw new Error("[magi] Pi host module @earendil-works/pi-coding-agent is required for model configuration")
  }
  return cachedHost
}

export function parseModelSelector(selector) {
  const value = String(selector ?? "").trim()
  const colon = value.lastIndexOf(":")
  const suffix = colon > 0 ? value.slice(colon + 1) : ""
  if (["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(suffix)) {
    return { model: value.slice(0, colon), thinking: suffix }
  }
  return { model: value, thinking: null }
}

export async function loadModelConfig(options) {
  const { projectRoot, isProjectTrusted = false, readFileImpl = readFile, hostModule } = options
  let user = null
  let project = null
  let projectRead = false
  try {
    user = JSON.parse(await readFileImpl(userModelConfigPath({ hostModule }), "utf8"))
  } catch (error) {
    if (huntEnoent(error)) user = null
    else {
      return { ok: false, error: "[magi] Invalid open-magi.json in the Pi agent directory: " + describeError(error) }
    }
  }
  if (isProjectTrusted) {
    try {
      projectRead = true
      project = JSON.parse(await readFileImpl(projectModelConfigPath(projectRoot, { hostModule }), "utf8"))
    } catch (error) {
      if (!huntEnoentable(error)) {
        return { ok: false, error: "[magi] Invalid open-magi.json for the project: " + describeError(error) }
      }
      project = null
      projectRead = false
    }
  }
  const userError = validateSchema(user)
  if (userError) return { ok: false, error: userError }
  const projectError = validateSchema(project)
  if (projectError) return { ok: false, error: projectError }
  return { ok: true, user, project, projectRead }
}

function huntEnoentable(error) {
  return error?.code === "ENOENT"
}
function describeError(error) {
  return error?.message || String(error)
}

function validateSchema(config) {
  if (config == null) return null
  if (config.version !== MODEL_CONFIG_VERSION) {
    return "[magi] Unsupported open-magi.json version: " + JSON.stringify(config?.version ?? null)
  }
  if (typeof config.models !== "object" || config.models == null || Array.isArray(config.models)) {
    return "[magi] open-magi.json must contain a models object"
  }
  const known = new Set(ROLE_NAMES)
  for (const key of Object.keys(config)) {
    if (key !== "version" && key !== "models") {
      return "[magi] Unknown top-level key in open-magi.json: " + key
    }
  }
  for (const key of Object.keys(config.models)) {
    if (!known.has(key)) return "[magi] Unknown role: " + key
    const value = config.models[key]
    if (typeof value !== "string" || !value.trim()) {
      return "[magi] Role must be a non-empty model selector: " + key
    }
  }
  return null
}

export function resolveRoleModels(mainModel, mainThinking, userConfig, projectConfig) {
  const result = {}
  const main = { model: mainModel, thinking: mainThinking ?? null }
  for (const role of ROLE_NAMES) {
    const chain = [main, parseModelSelector(userConfig?.models?.[role] ?? ""), parseModelSelector(projectConfig?.models?.[role] ?? "")]
    const chosen = chain.filter((entry) => entry.model)[chain.filter((entry) => entry.model).length - 1] || main
    result[role] = { model: chosen.model, thinking: chosen.thinking ?? main.thinking ?? "medium" }
  }
  return result
}

export async function writeModelConfig(targetPath, contents, { scope = "project", readFileImpl = readFile, writeFileImpl = writeFile } = {}) {
  const value = validateSchema({ ...JSON.parse(JSON.stringify(contents)) })
  if (value) throw new Error(value)
  const tempRoot = await mkdtemp(join(tmpdir(), "open-magi-config-"))
  try {
    const tempFile = join(tempRoot, "open-magi.json")
    await writeFileImpl(tempFile, JSON.stringify(contents, null, 2) + "\n", "utf8")
    await rename(tempFile, targetPath)
    if (scope === "user" && TEMP_PLATFORM_CHMOD_SUPPORTED) {
      await chmod(targetPath, 0o600)
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}
```

Where `TEMP_PLATFORM_CHMOD_SUPPORTED` is a constant defined at the top of the module:

```js
import { platform } from "node:os"
const TEMP_PLATFORM_CHMOD_SUPPORTED = platform() !== "win32"
```

(The `readFileImpl` parameter exists in `writeModelConfig` only for future parity; tests never pass it — leave it unused but harmless.)

- [ ] **Step 4: Run tests**

Run: `node --test test/pi-adapter.test.mjs`
Expected: PASS (Task 4 tests green; run the whole focused file to catch regressions).

- [ ] **Step 5: Commit**

```bash
git add adapters/pi/lib/config.js test/pi-adapter.test.mjs
git commit -m "feat(pi): add strict schema-1 model override resolution via host config paths"
```

---

### Task 5: Guard classification and phase guard — `adapters/pi/lib/controller.js` (part 1)

**Files:**
- Create: `adapters/pi/lib/controller.js`
- Test: `test/pi-adapter.test.mjs` (append)

**Interfaces:**
- Consumes: nothing external (pure; state objects and tool info lists passed in).
- Produces (used by Task 7's tool and Task 8's lifecycle wiring):
  - `isHerdrActive(env = process.env)` → `env.HERDR_ENV === "1"`
  - `TRANSPORT_MISMATCH_ERROR = "[magi] Herdr transport is active; the native Pi council cannot run."`
  - `READ_ONLY_TOOLS = ["read", "grep", "find", "ls"]`, `GUARDED_TOOLS = ["write", "edit", "bash", "powershell"]`
  - `classifyGuardTools(toolInfos, activeToolNames)` → `{ builtinsActive: string[], unknown: string[], guarded: string[], readOnly: string[] }`
  - `guardDiagnostic(unknownBuiltin: string)` → activation-blocking message
  - `enforcePhaseGuard({ state, projectRoot, toolName, toolInput, existsImpl? })` → `{ block: boolean, reason?: string }`
  - `shellMutationTargetsProject(command, cwd, shellFamily, isProjectPathImpl, isDocPathImpl)` (exported for tests)

- [ ] **Step 1: Write the failing tests**

```js
import {
  isHerdrActive, TRANSPORT_MISMATCH_ERROR, READ_ONLY_TOOLS, GUARDED_TOOLS,
  classifyGuardTools, guardDiagnostic, enforcePhaseGuard, shellMutationTargetsProject,
} from "../adapters/pi/lib/controller.js"

const builtinInfo = (name, source = "builtin") => ({ name, sourceInfo: { source } })

test("transport gate keys off HERDR_ENV", () => {
  assert.equal(isHerdrActive({ HERDR_ENV: "1" }), true)
  assert.equal(isHerdrActive({ HERDR_ENV: "0" }), false)
  assert.equal(isHerdrActive({}), false)
  assert.equal(TRANSPORT_MISMATCH_ERROR.includes("transport mismatch") || /transport/.test(TRANSPORT_MISMATCH_ERROR), true)
})

test("classifyGuardTools intersects active tools with builtins by provenance", () => {
  const toolInfos = [
    builtinInfo("read"), builtinInfo("bash"), builtinInfo("write"),
    builtinInfo("my_sdk_tool", "sdk"), builtinInfo("ext_tool", "package-extension"),
  ]
  const result = classifyGuardTools(toolInfos, ["read", "bash", "write", "my_sdk_tool", "ext_tool"])
  assert.deepEqual([...result.builtinsActive].sort(), ["bash", "read", "write"])
  assert.deepEqual([...result.readOnly].sort(), ["read"])
  assert.deepEqual([...result.guarded].sort(), ["bash", "write"])
  assert.equal(result.guarded.includes("my_sdk_tool"), false, "SDK tools are never classified as builtins")
  assert.ok(!result.blocked, "classified builtins do not block")
})

test("unrecognized active builtin fails closed with a diagnostic", () => {
  const result = classifyGuardTools([builtinInfo("read"), builtinInfo("todo")], ["read", "todo"])
  assert.ok(result.blocked)
  assert.match(guardDiagnostic(result.unknown[0]), /builtin|unclassified/i)
})

test("code writes are denied before execution and allowed only after the current verdict", () => {
  const state = { active: true, currentPhase: "synthesis", currentRound: 2 }
  const denied = enforcePhaseGuard({ state, projectRoot: "/proj", toolName: "edit", toolInput: { file_path: "/proj/src/a.js" } })
  assert.equal(denied.block, true)
  const executedState = { ...state, currentPhase: "execution" }
  const allowed = enforcePhaseGuard({
    state: executedState, projectRoot: "/proj", toolName: "edit",
    toolInput: { file_path: "/proj/src/a.js" },
    existsImpl: (p) => p === "/proj/.open_magi/magi-log/round-002/verdict.md",
  })
  assert.equal(allowed.block, false)
  const missingVerdict = enforcePhaseGuard({
    state: executedState, projectRoot: "/proj", toolName: "write",
    toolInput: { file_path: "/proj/src/a.js" },
    existsImpl: () => false,
  })
  assert.equal(missingVerdict.block, true)
  assert.match(missingVerdict.reason, /verdict\.md/)
})

test("magi markdown artifact writes remain allowed", () => {
  const state = { active: true, currentPhase: "research_task", currentRound: 1 }
  const result = enforcePhaseGuard({
    state, projectRoot: "/proj", toolName: "write",
    toolInput: { file_path: "/proj/.open_magi/magi-log/round-001/council-001/prompt.md" },
  })
  assert.equal(result.block, false)
})

test("posix bash redirect parsing blocks project writes but lets doc writes pass", () => {
  const mutation = shellMutationTargetsProject("/proj", 'echo hi > /proj/src/a.js', { mode: "tui" } && "bash")
  assert.equal(mutation, true)
  assert.equal(shellMutationTargetsProject("/proj", "echo notes > /proj/notes.md", "bash"), false)
  assert.equal(shellMutationTargetsProject("/proj", "sed -i 's/a/b/' /proj/src/a.js", "bash"), true)
  assert.equal(shellMutationTargetsProject("/proj", "echo stale | tee /proj/src/a.js", "bash" ), true)
})

test("powershell targets are parsed with PowerShell syntax, not POSIX shorthand", () => {
  assert.equal(shellMutationTargetsProject("/proj", "Set-Content -Path /proj/src/a.js -Value hi", "powershell"), true)
  assert.equal(shellMutationTargetsProject("/proj", "Get-Content /proj/src/a.js | Out-File /proj/src/other.js", "powershell"), true)
  assert.equal(shellMutationTargetsProject("/proj", "'hi' > /proj/src/a.js", "powershell"), true)
  assert.equal(shellMutationTargetsProject("/proj", "'notes' > /proj/notes.md", "powershell"), false)
})

test("powershell build/test exceptions classify with PowerShell syntax", () => {
  assert.equal(shellMutationTargetsProject("/proj", "npm test", "powershell"), false)
  assert.equal(shellMutationTargetsProject("/proj", "pnpm --version > /proj/magi-build.log", "powershell"), false)
  assert.equal(shellMutationTargetsProject("/proj", "Remove-Item /proj/notes.md", "powershell"), true)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/pi-adapter.test.mjs`
Expected: FAIL — `ERR_MODULE_NOT_FOUND .../controller.js`.

- [ ] **Step 3: Write minimal implementation — `adapters/pi/lib/controller.js` (guard part)**

```js
import { existsSync } from "node:fs"
import { isAbsolute, join, relative, resolve, sep } from "node:path"

export const LOG_DIR = ".open_magi/magi-log"
export const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000
export const HARD_MAX_TIMEOUT_MS = 60 * 60 * 1000
export const TRANSPORT_MISMATCH_ERROR =
  "[magi] transport mismatch: HERDR_ENV=1 keeps the Herdr contract authoritative; the native Pi council cannot run."

export function isHerdrActive(env = process.env) {
  return env.HERDR_ENV === "1"
}

export const READ_ONLY_TOOLS = ["read", "grep", "find", "ls"]
export const GUARDED_TOOLS = ["write", "edit", "bash", "powershell"]

const KNOWN_CLASSIFIED_BUILTINS = new Set([...READ_ONLY_TOOLS, ...GUARDED_TOOLS])

export function classifyGuardTools(toolInfos, activeToolNames) {
  const active = new Set(activeToolNames || [])
  const builtinsActive = (toolInfos || [])
    .filter((info) => info?.sourceInfo?.source === "builtin" && active.has(info.name))
    .map((info) => info.name)
  const unknown = builtinsActive.filter((name) => !KNOWN_CLASSIFIED_BUILTINS.has(name))
  return {
    builtinsActive,
    unknown,
    readOnly: builtinsActive.filter((name) => READ_ONLY_TOOLS.includes(name)),
    guarded: builtinsActive.filter((name) => GUARDED_TOOLS.includes(name)),
    blocked: unknown.length > 0,
  }
}

export function guardDiagnostic(unknownBuiltin) {
  return `[magi] unclassified active builtin tool "${unknownBuiltin}"; Magi guard fails closed. Disable the tool or extend the Magi guard before dispatch.`
}

function isUnder(child, parent) {
  const rel = relative(parent, child)
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}
function isMagiPath(cwd, target) {
  return isUnder(resolve(target), resolve(cwd, LOG_DIR))
}
function isProjectPath(cwd, target) {
  const resolved = resolve(target)
  return isUnder(resolved, resolve(cwd)) && !isMagiPath(cwd, resolved)
}
function isDocPath(target) {
  return /\.(md|txt)$/i.test(String(target || "").trim())
}

const SED_INPLACE_PATTERN = /(?:^|[\s;&|])sed\s+(?:-[a-zA-Z]+\s+)*-i(?:\s|=)/
const POSIX_REDIRECT_PATTERN = /(?<![-\w])(?:\d{0,2}(?:>>|&>|>))\s*(?:"([^"]*)"|'([^']*)'|([^\s;&|]+))/g
const TEE_PATTERN = /(?:^|[\s;&|])tee\s+(?:-a\s+)?(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/g
const APPLY_PATCH_PATTERN = /(?:^|[\s;&|])apply_patch(?=[\s;&|]|$)/

const POWERSHELL_MUTATION_PATTERNS = [
  /(?:^|[\s;&|])Set-Content(?=[\s;|]|$)/,
  /(?:^|[\s;&|])Add-Content(?=[\s;|]|$)/,
  /(?:^|[\s;&|])Out-File(?=[\s;|]|$)/,
  /(?:^|[\s;&|])New-Item(?=[\s;|]|$)/,
  /(?:^|[\s;&|])Copy-Item(?=[\s;|]|$)/,
  /(?:^|[\s;&|])Move-Item(?=[\s;|]|$)/,
  /(?:^|[\s;&|])Remove-Item(?=[\s;|]|$)/,
  /(?:^|[\s;&|])Clear-Content(?=[\s;|]|$)/,
  /(?:^|[\s;&|])Set-ItemProperty(?=[\s;|]|$)/,
]
const POWERSHELL_REDIRECT_PATTERN = /(?<![-\w])(?:\d+)?(?:>>|>)\s*(?:"([^"]*)"|'([^']*)'|([^\s;&|]+))/g
const POWERSHELL_DESTRUCTIVE_PATTERN = /(?:^|[\s;&|])(?:Remove-Item|Clear-Content)(?=[\s;|]|$)/

const BUILD_TEST_PATTERN = /(?:^|[\s;&|])(?:npm|npx|pnpm|yarn|make|cmake|gradle|mvn|pytest|vitest|jest|cargo|go|node)\b/

function allTargets(pattern, text) {
  const targets = []
  for (const match of String(text ?? "").matchAll(pattern)) {
    targets.push(String(match[1] ?? match[2] ?? match[3] ?? "").trim())
  }
  return targets
}

function heredocTag(line) {
  const match = line.match(/<<[-~]?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/)
  return match ? match[1] : null
}

function stripHeredocs(text) {
  const out = []
  let tag = null
  for (const line of String(text ?? "").split("\n")) {
    if (tag) {
      if (line.trim() === tag) tag = null
      continue
    }
    const openTag = heredocTag(line)
    if (openTag) {
      out.push(line.slice(0, line.indexOf("<<")))
      tag = openTag
      continue
    }
    out.push(line)
  }
  return out.join("\n")
}

function sanitizeShellText(command, shellFamily) {
  if (shellFamily === "powershell") return String(command ?? "")
  const stripped = stripHeredocs(command)
  const dequoted = stripped.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""')
  return dequoted.split("\n").map((line) => line.replace(/(^|\s)#.*$/, "$1")).join("\n")
}

function targetIsMutation(cwd, target) {
  return !isDocPath(target) && isProjectPath(cwd, resolve(cwd, target))
}

function isBuildTestTargetAllowed(cwd, target) {
  return isDocPath(target) || /\.log$/i.test(target) || isMagiPath(cwd, resolve(cwd, target))
}

export function shellMutationTargetsProject(cwd, command, shellFamily) {
  const family = shellFamily === "powershell" ? "powershell" : "bash"
  if (family === "powershell") {
    const text = String(command ?? "")
    const targets = allTargets(POWERSHELL_REDIRECT_PATTERN, text)
    const buildTest = BUILD_TEST_PATTERN.test(text)
    for (const target of targets) {
      if (buildTest && isBuildTestTargetAllowed(cwd, target)) continue
      if (targetIsMutation(cwd, target)) return true
    }
    for (const pattern of POWERSHELL_MUTATION_PATTERNS) {
      if (pattern.test(text)) {
        const destructive = POWERSHELL_DESTRUCTIVE_PATTERN.test(text)
        const paramTargets = [
          ...String(text).matchAll(/(?:-Path|-FilePath|-LiteralPath)\s+"?([^";|]+)"?/g),
          ...String(text).matchAll(/(?:Set-Content|Add-Content|Out-File|Remove-Item|New-Item|Copy-Item|Move-Item|Clear-Content|Set-ItemProperty)\s+"?([^";|\r\n]+)"?/g),
        ].map((match) => match[1])
        return paramTargets.some((target) => {
          if (!targetIsMutation(cwd, target)) return false
          return destructive || !isBuildTestTargetAllowed(cwd, target)
        })
      }
    }
    return false
  }

  const stripped = sanitizeShellText(command, "bash")
  if (SED_INPLACE_PATTERN.test(stripped) || APPLY_PATCH_PATTERN.test(stripped)) return true
  const buildTest = BUILD_TEST_PATTERN.test(stripped)
  for (const target of allTargets(POSIX_REDIRECT_PATTERN, stripped)) {
    if (buildTest && isBuildTestTargetAllowed(cwd, target)) continue
    if (targetIsMutation(cwd, target)) return true
  }
  for (const target of allTargets(TEE_PATTERN, stripped)) {
    if (buildTest && isBuildTestTargetAllowed(cwd, target)) continue
    if (targetIsMutation(cwd, target)) return true
  }
  return false
}

function mentionedProjectPaths(text, cwd) {
  if (typeof text !== "string" || !text) return []
  return [...text.matchAll(/[^\s:'"]+\.(?:md|json|txt|js|ts|c|h|py|toml|yaml|yml)\b/g)]
    .map((match) => match[0])
    .filter((target) => targetIsMutation(cwd, target))
}

export function enforcePhaseGuard({ state, projectRoot, toolName, toolInput, existsImpl = existsSync }) {
  if (!state?.active) return { block: false }
  const cwd = projectRoot
  const fileTools = new Set(["write", "edit", "apply_patch"])
  const shellTools = new Set(["bash", "powershell"])
  const filePath = toolInput?.file_path ?? toolInput?.filePath ?? toolInput?.path
  const patchText = toolInput?.patch ?? toolInput?.content ?? (typeof toolInput?.input === "string" ? toolInput.input : null)
  const command = toolInput?.command ?? toolInput?.cmd ?? null
  const family = toolName === "powershell" ? "powershell" : "bash"

  const decisionArtifactPattern = /\.open_magi\/magi-log\/round-(\d{3})\/(?:council-\d{3}\/prompt\.md|verdict\.md)/
  const targets = []
  if (fileTools.has(toolName)) {
    if (filePath) targets.push(filePath)
    if (typeof patchText === "string") {
      for (const match of patchText.matchAll(/\.open_magi\/magi-log\/[^\s;&|'"]+/g)) targets.push(match[0])
    }
  }
  if (shellTools.has(toolName) && typeof command === "string") {
    const redirectPattern = family === "powershell" ? POWERSHELL_REDIRECT_PATTERN : POSIX_REDIRECT_PATTERN
    for (const target of allTargets(redirectPattern, sanitizeShellText(command, family))) targets.push(target)
    for (const target of allTargets(TEE_PATTERN, sanitizeShellText(command, family))) targets.push(target)
    for (const match of command.matchAll(/\.open_magi\/magi-log\/[^\s;&|'"]+/g)) targets.push(match[0])
  }
  for (const target of targets) {
    const match = decisionArtifactPattern.exec(target)
    if (!match) continue
    const round = Number(match[1])
    const mode = state.currentCouncilMode === "recon" || state.currentCouncilMode === "review" ? state.currentCouncilMode : "decision"
    if (round !== roundNumberOf(state)) continue
    if (mode === "review") {
      return { block: true, reason: "[magi] A review pass is in flight; wait for the review council before writing decision artifacts or the verdict." }
    }
    if (mode === "recon" || mode === "decision") {
      const pass = mode === "recon" ? reconPassNumberOf(state) : deliberationPassNumberOf(state)
      const folder = mode === "recon" ? `recon-${String(pass).padStart(3, "0")}` : `council-${String(pass).padStart(3, "0")}`
      const promptPath = join(cwd, LOG_DIR, `round-${String(round).padStart(3, "0")}`, folder, "prompt.md")
      if (!existsImpl(promptPath)) continue
      const pending = ["melchior", "balthasar", "casper"].filter((sage) => !existsImpl(join(cwd, LOG_DIR, `round-${String(round).padStart(3, "0")}`, folder, `report-${sage}.md`)))
      if (pending.length > 0) {
        return {
          block: true,
          reason: `[magi] ${mode} pass ${pass} is in flight (${pending.join(", ")} reports pending). Wait for the council; do not write decision artifacts or the verdict until it completes.`,
        }
      }
    }
  }

  let mutation = false
  if (fileTools.has(toolName)) {
    if (filePath) mutation = targetIsMutation(cwd, filePath)
    else if (typeof patchText === "string") mutation = mentionedProjectPaths(patchText, cwd).length > 0
    else mutation = true
  } else if (shellTools.has(toolName) && typeof command === "string") {
    mutation = shellMutationTargetsProject(cwd, command, family)
  }
  if (!mutation) return { block: false }

  const phase = state?.currentPhase
  if (phase !== "execution") {
    return {
      block: true,
      reason: `[magi] Magi loop active (round=${roundNumberOf(state)} phase=${phase}). Code changes are only allowed in the execution phase after verdict.md. Follow the open_magi process: write the required artifacts for the current phase instead.`,
    }
  }
  const verdictPath = join(cwd, LOG_DIR, `round-${String(roundNumberOf(state)).padStart(3, "0")}`, "verdict.md")
  if (!existsImpl(verdictPath)) {
    return {
      block: true,
      reason: `[magi] phase=execution but ${verdictPath} is missing. Produce the verdict through the council process before editing code.`,
    }
  }
  return { block: false }
}

function roundNumberOf(state) {
  const round = Number(state?.currentRound)
  return Number.isInteger(round) && round > 0 ? round : 1
}
function reconPassNumberOf(state) {
  const pass = Number(state?.currentReconPass)
  return Number.isInteger(pass) && pass > 0 ? pass : 1
}
function deliberationPassNumberOf(state) {
  const pass = Number(state?.currentDeliberationPass)
  return Number.isInteger(pass) && pass > 0 ? pass : 1
}
```

- [ ] **Step 4: Run tests**

Run: `node --test test/pi-adapter.test.mjs`
Expected: PASS (Task 1-5 tests). Verify the assembled file parses: `node --check adapters/pi/lib/controller.js` (module order when transcribing: constants → patterns → `classifyGuardTools`/`guardDiagnostic` → path helpers → `stripHeredocs`/`sanitizeShellText` → `allTargets` → `targetIsMutation`/`isBuildTestTargetAllowed` → `shellMutationTargetsProject` → `mentionedProjectPaths` → `enforcePhaseGuard` → the three number helpers).

- [ ] **Step 5: Commit**

```bash
git add adapters/pi/lib/controller.js test/pi-adapter.test.mjs
git commit -m "feat(pi): add builtin guard classification and two-shell phase guard"
```

---

### Task 6: Native council runner — `adapters/pi/lib/pi-runner.js`

**Files:**
- Create: `adapters/pi/lib/pi-runner.js`
- Test: `test/pi-adapter.test.mjs` (append)

**Interfaces:**
- Consumes: nothing at import time; `writeReport` uses `controller.js` log conventions via relative paths handed in.
- Produces:
  - `DELIBERATORS = [{ sage: "melchior", promptFile: "melchior.md", skillDirRelative: "adapters/pi/skills/magi" }, ...]` (same trio order for codex parity).
  - `resolvePiInvocation(options: { processArgv?, processExecPath?, existsImpl?, readdirSafe? })` → `{ command, args }`
  - `ISOLATION_ARG_GROUPS = { mode: ["--mode", "json"], print: ["--print"], ... }` (single source for the exact flags)
  - `buildChildArgs({ model, thinking, isolationArgs })` → flat array ending with `--tools read,grep,find,ls`, `--no-approve`, `--model`, `--thinking`
  - `parseJsonlStream(stdoutText)` → `{ finalMessage, usage, header }`; throws `{ failureType: "invalid_json" }`-shaped errors
  - `runPiCouncil({ projectRoot, promptPath, round, pass, mode, roleModels, roleThinking, timeoutMs?, signal?, spawnFn?, readFileImpl })` → same result shape as Codex `runCouncil`: `{ ok, halt, haltReason, hardErrors, projectRoot, promptPath, round, pass, mode, executor: "spawn", results }` where each result is `{ sage, ok, failureType /* null | "timeout" | "hard_error" */, piFailureType /* native subtype | null */, exitCode, timedOut, reportPath, diagnostics }`.
  - `writeReport({ promptPath, sage, result })` (exported; used by runner and tests) — marker values `pi_json` / `pi_json_failed`.

- [ ] **Step 1: Write the failing tests**

```js
import {
  DELIBERATORS, resolvePiInvocation, buildChildArgs, parseJsonlStream, runPiCouncil, writeReport,
} from "../adapters/pi/lib/pi-runner.js"
import { mkdtemp, readFile, writeFile as fsWriteFile, mkdir } from "node:fs/promises"
import { spawn } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"

test("three role deliberators are declared", () => {
  assert.deepEqual(DELIBERATORS.map((d) => d.sage), ["melchior", "balthasar", "casper"])
})

test("executable resolution prefers the current invocation and never naively grabs PATH pi", () => {
  const reused = resolvePiInvocation({ processArgv: ["/usr/local/bin/pi", "run"], processExecPath: "/usr/local/bin/pi", existsImpl: () => true })
  assert.deepEqual(reused, { command: "/usr/local/bin/pi", args: ["run"] })
  const nodeScript = resolvePiInvocation({ processArgv: ["/x/node", "/y/cli.mjs"], processExecPath: "/x/node", existsImpl: () => true })
  assert.deepEqual(nodeScript, { command: "/x/node", args: ["/y/cli.mjs"] })
  const packaged = resolvePiInvocation({ processArgv: ["/$bunfs/root/pi"], processExecPath: "/$bunfs/root/pi", existsImpl: () => true, renderedRuntime: true })
  const fallback = resolvePiInvocation({ processArgv: ["/x/node", "/y/cli.mjs"], processExecPath: "/x/node", existsImpl: () => true, forcePathFallback: true })
  assert.deepEqual(fallback, { command: "pi", args: [] })
  // The `pi` from PATH is ONLY a final fallback (argument-free invocation rule is asserted by the two cases above).
})

test("isolation arguments are exact and shell-free spawn is documented in buildChildArgs", () => {
  const args = buildChildArgs({ model: "p/m", thinking: "high" })
  const idx = (name) => args.indexOf(name)
  assert.deepEqual(args.slice(idx("--mode"), idx("--mode") + 2), ["--mode", "json"])
  for (const flag of ["--print", "--no-session", "--no-extensions", "--no-skills", "--no-context-files", "--no-prompt-templates", "--no-themes", "--tools", "--no-approve", "--model", "--thinking"]) {
    assert.ok(args.includes(flag), `child args must include ${flag}`)
  }
  const toolsIdx = idx("--tools")
  assert.equal(args[toolsIdx + 1], "read,grep,find,ls")
  assert.equal(args[args.length - 2], "--model")
  assert.equal(args[args.length - 1], "p/m")
})

test("parseJsonlStream extracts the final assistant message and usage", () => {
  const header = JSON.stringify({ type: "session", id: "abc", timestamp: "2026-01-01T00:00:00Z", cwd: "/p" })
  const first = JSON.stringify({ type: "message_end", message: { role: "assistant", text: "draft", usage: { input: 1, output: 2, totalTokens: 3, cost: { total: 0 } }, stopReason: "stop" } })
  const last = JSON.stringify({ type: "message_end", message: { role: "assistant", text: "final report", usage: { input: 10, output: 20, totalTokens: 30, cost: { total: 0.01 } }, stopReason: "stop" } })
  const parsed = parseJsonlStream([header, first, last].join("\n"))
  assert.equal(parsed.finalMessage.text, "final report")
  assert.equal(parsed.usage.output, 20)
})

test("parseJsonlStream flags missing final response and invalid JSON as native subtypes", () => {
  assert.throws(() => parseJsonlStream('{"type": "message_start"}'), /missing_final_response/)
  assert.throws(() => parseJsonlStream("not-json\n"), /invalid_json/)
})

test("runPiCouncil launches three concurrent isolated children with the real runner", async (t) => {
  const project = await mkdtemp(join(tmpdir(), "magi-pi-runner-"))
  const councilDir = join(project, ".open_magi", "magi-log", "round-001", "council-001")
  await mkdir(councilDir, { recursive: true })
  const promptPath = join(councilDir, "prompt.md")
  await fsWriteFile(promptPath, "# Council prompt", "utf8")
  const binDir = join(project, "fake-bin")
  await mkdir(binDir, { recursive: true })
  const fakePi = join(binDir, "fake-pi")
  await fsWriteFile(fakePi, ["#!/usr/bin/env node", "const sage = process.env.MAGI_FAKE_SAGE", "process.stdout.write(JSON.stringify({type:'message_end',message:{role:'assistant',text:'REPORT: '+sage,usage:{input:1,output:2,totalTokens:3,cost:{total:0}}},stopReason:'stop'}) + '\\n')"].join("\n"), { mode: 0o755 })
  const spawned = { cwd: [], args: [] }
  const results = await runPiCouncil({
    projectRoot: project,
    promptPath,
    round: 1,
    pass: 1,
    mode: "decision",
    roleModels: { melchior: { model: "p/m1", thinking: "high" }, balthasar: { model: "p/m2", thinking: "low" }, casper: { model: "p/m3", thinking: "off" } },
    runnerBin: fakePi,
    spawnLike: (command, args, options) => {
      spawned.cwd.push(options.cwd)
      spawned.args.push(args)
      return spawn(command, args, options)
    },
  })
  assert.equal(results.results.length, 3)
  assert.deepEqual([...spawned.cwd].sort(), [project, project, project])
  assert.equal(spawned.args.filter((args) => args.includes("--no-approve")).length, 3)
  assert.equal(spawned.args.filter((args) => args.includes("read,grep,find,ls")).length, 3)
  for (const sage of ["melchior", "balthasar", "casper"]) {
    const report = await readFile(join(councilDir, `report-${sage}.md`), "utf8")
    assert.match(report, /^report_source: pi_json$/m)
    assert.match(report, /^status: ok$/m)
    assert.match(report, /^failure_type: none$/m)
    assert.match(report, /^usage_output_tokens: 2$/m)
  }
})
```

Time tests for escalation and abort follow the same fake-Pi pattern (scripts delayed via `setTimeout`), asserting `status: timeout` + `stance: needs_evidence` + `blocking_objection: yes` + `report_source: pi_json_failed` + `failure_type: timeout` + bounded `pi_diag: timeout`, a hard-error case (`process.exit(3)`) asserting `status: hard_error`, `failure_type: hard_error`, `pi_diag: nonzero_exit`, exit propagation, and `signal`-aborted result asserting `pi_diag: aborted`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/pi-adapter.test.mjs`
Expected: FAIL — `ERR_MODULE_NOT_FOUND .../pi-runner.js`.

- [ ] **Step 3: Write minimal implementation — `adapters/pi/lib/pi-runner.js`**

```js
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { DEFAULT_TIMEOUT_MS, HARD_MAX_TIMEOUT_MS } from "./controller.js"

export const DELIBERATORS = [
  { sage: "melchior" },
  { sage: "balthasar" },
  { sage: "casper" },
]

export const ISOLATION_ARGS = [
  "--mode", "json",
  "--print",
  "--no-session",
  "--no-extensions",
  "--no-skills",
  "--no-context-files",
  "--no-prompt-templates",
  "--no-themes",
  "--tools", "read,grep,find,ls",
  "--no-approve",
] // child argv = [...resolvePiInvocation().argsForRun, ...ISOLATION_ARGS, "--model", model, "--thinking", thinking, promptText]

export function resolvePiInvocation(options = {}) {
  const argv = options.processArgv ?? process.argv
  const execPath = options.processExecPath ?? process.execPath
  const existsImpl = options.existsImpl ?? existsSync
  const currentScript = argv[1]
  const isBunVirtualScript = typeof currentScript === "string" && currentScript.startsWith("/$bunfs/root/")
  if (options.forcePathFallback) return { command: "pi", args: [] }
  if (currentScript && !isBunVirtualScript && existsImpl(currentScript)) {
    return { command: execPath, args: [currentScript] }
  }
  const execName = String(execPath.split(/[\\/]/).pop() || "").toLowerCase()
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName)
  if (!isGenericRuntime) return { command: execPath, args: [] }
  return { command: "pi", args: [] }
}

export function buildChildArgs({ model, thinking }) {
  return [...ISOLATION_ARGS, "--model", String(model), "--thinking", normalizeThinking(thinking)]
}

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"])
function normalizeThinking(level) {
  return THINKING_LEVELS.has(level) ? level : "medium"
}

export function parseJsonlStream(stdoutText) {
  const lines = String(stdoutText ?? "").split("\n").filter((line) => line.trim())
  let header = null
  let finalMessage = null
  for (const line of lines) {
    let event
    try {
      event = JSON.parse(line)
    } catch (error) {
      throw new Error("invalid_json")
    }
    if (event?.type === "session") header = event
    if (event?.type === "message_end" && event?.message?.role === "assistant") finalMessage = event.message
  }
  if (!finalMessage) throw new Error("missing_final_response")
  const stopReason = finalMessage?.stopReason
  if (stopReason === "error" || stopReason === "aborted") throw new Error(`assistant_stop_reason_${stopReason}`)
  const text = Array.isArray(finalMessage?.content)
    ? finalMessage.content.filter((part) => part?.type === "text").map((part) => part.text).join("\n")
    : String(finalMessage?.text ?? "")
  if (!text.trim()) throw new Error("missing_final_response")
  return { header, finalMessage, usage: finalMessage?.usage ?? null, text }
}

function clampTimeout(timeoutMs) {
  const value = Number(timeoutMs)
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_TIMEOUT_MS
  return Math.min(value, HARD_MAX_TIMEOUT_MS)
}

export function runOnePiChild({ invocation, args, cwd, promptText, timeoutMs, signal, spawnFn = spawn }) {
  return new Promise((resolveRun) => {
    const child = spawnFn(invocation.command, [...invocation.args, ...args, promptText], {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    })
    const stdout = { text: "" }
    const stderr = { text: "" }
    const startedAt = Date.now()
    let settled = false
    let timedOut = false
    let timedOutAt = null
    let aborted = false
    let exitCode = null
    let killTimer = null
    const killTimerEscalationMs = 5_000
    const sink = (buffer) => (chunk) => {
      buffer.text = buffer.text === "" ? String(chunk) : buffer.text + String(chunk)
      if (buffer.text.length > 20_000) buffer.text = buffer.text.slice(-20_000)
    }
    const onStdout = sink(stdout)
    const onStderr = sink(stderr)
    child.stdout?.on("data", onStdout)
    child.stderr?.on("data", onStderr)
    child.on("error", (error) => {
      finish({ ok: false, piFailureType: "spawn_error", error: String(error?.message || error), exitCode: null })
    })
    child.on("close", (code, signalName) => {
      exitCode = code
      finish()
    })
    function finish(partial = {}) {
      if (settled) return
      settled = true
      resolveRun({
        ok: partial.ok ?? false,
        piFailureType: partial.piFailureType ?? null,
        error: partial.error ?? null,
        exitCode,
        timedOut,
        timedOutAt,
        aborted,
        stdout: stdout.text,
        stderr: stderr.text,
        startedAtIso: new Date(startedAt).toISOString(),
        endedAtIso: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
      })
    }
    function timeoutTimer() {
      if (settled) return
      timedOut = true
      timedOutAt = new Date().toISOString()
      child.kill("SIGTERM")
      killTimer = setTimeout(() => {
        if (!settled) child.kill("SIGKILL")
      }, 5_000)
      killTimer.unref?.()
    }
    const timer = setTimeout(timeoutTimer, clampTimeout(timeoutMs))
    timer.unref?.()
    signal?.addEventListener("abort", () => {
      if (settled) return
      aborted = true
      child.kill("SIGTERM")
      setTimeout(() => {
        if (!settled) child.kill("SIGKILL")
      }, 5_000).unref?.()
    }, { once: true })
  })
}

export function piEnvelope(processResult) {
  if (processResult.ok) return { status: "ok", failureType: "none", nativeType: null }
  if (processResult.timedOut) return { status: "timeout", failureType: "timeout", nativeType: "timeout", stance: "needs_evidence", blocking: "yes", risk: "medium" }
  const nativeType = processResult.piFailureType
    ?? (processResult.aborted ? "aborted" : processResult.exitCode ? "nonzero_exit" : "spawn_error")
  return { status: "hard_error", failureType: "hard_error", nativeType, stance: "needs_evidence", blocking: "yes", risk: "high" }
}

export function reportBodyFor({ sage, model, processResult, stream, usage }) {
  const envelope = piEnvelope(processResult)
  const success = envelope.status === "ok"
  const body = [`report_source: ${success ? "pi_json" : "pi_json_failed"}`, `status: ${envelope.status}`]
  if (!success) {
    body.push(`stance: ${envelope.stance}`, `blocking_objection: ${envelope.blocking}`, `risk_level: ${envelope.risk}`)
  }
  body.push(`failure_type: ${envelope.failureType}`, `agent: deliberator-${sage}`, `model: ${model}`)
  body.push(`pi_failure_subtype: ${envelope.nativeType || "none"}`)
  body.push(`pi_exit_code: ${processResult.exitCode ?? "null"}`, `pi_timed_out: ${processResult.timedOut ? "true" : "false"}`)
  if (usage) body.push(`usage_input_tokens: ${usage.input ?? "unknown"}`, `usage_output_tokens: ${usage.output ?? "unknown"}`)
  body.push("---")
  if (success) {
    body.push(String(stream?.text ?? "").trim(), "")
  } else {
    body.push(`pi_diag: ${envelope.nativeType}: ${bounded(processResult?.stderr ?? processResult?.error ?? "")}`, "")
  }
  return body.join("\n")
}

function bounded(text) {
  return String(text ?? "").slice(0, 512)
}

export function reportPathForPrompt(promptPath, sage) {
  return join(dirname(promptPath), `report-${sage}.md`)
}

export async function writeReport({ promptPath, sage, model, processResult, existsImpl = existsSync }) {
  const reportPath = reportPathForPrompt(promptPath, sage)
  await mkdir(dirname(reportPath), { recursive: true })
  let stream = null
  let usage = null
  let parsed = null
  try {
    parsed = parseJsonlStream(processResult.stdout)
    stream = parsed
    usage = parsed.usage
    if (processResult.ok === false && !processResult.timedOut) {
      processResult = { ...processResult, ok: false }
    }
  } catch (parseError) {
    if (processResult.ok && String(processResult.stdout ?? "").trim()) {
      processResult = { ...processResult, ok: false, piFailureType: String(parseError.message).startsWith("assistant_stop_reason") ? "invalid_json" : parseError.message }
    }
    parsed = null
  }
  const body = reportBodyFor({ sage, model, processResult, stream, usage })
  await writeAtomic(join(dirname(reportPath), `report-${sage}.tmp`), reportPath, body)
  return { reportPath, pipedParse: parsed, processResult }
}

async function writeAtomic(tempRoot, target, contents) {
  await writeFile(tempRoot, contents, "utf8")
  await rename(tempRoot, target)
}

export async function runPiCouncil(options) {
  const { projectRoot, promptPath, mode, round, pass, roleModels, timeoutMs, signal, spawnLike = spawn } = options
  const timeout = clampTimeout(timeoutMs)
  const councilPrompt = (await readFile(promptPath, "utf8")).trim()
  const invocation = options.runnerBin
    ? { command: options.runnerBin, args: options.runnerBinArgs ?? [] }
    : resolvePiInvocation()
  const roles = {
    melchior: "practical feasibility and edge cases",
    balthasar: "architecture, maintainability, and long-term design",
    casper: "debugging, root causes, and failure paths",
  }
  const childPromises = DELIBERATORS.map(async ({ sage }) => {
    const rolePromptPath = join(projectRoot, "adapters", "pi", "skills", "magi", "prompts", `${sage}.md`)
    const rolePrompt = await readFile(rolePromptPath, "utf8")
    const promptText = [
      `You are deliberator-${sage}, an Open Magi deliberator (${roles[sage]}).`,
      "",
      "ROLE PROMPT",
      rolePrompt.trim(),
      "",
      "COUNCIL PROMPT",
      councilPrompt,
      "",
      "REPORT OUTPUT REQUIREMENTS",
      "- Return only the requested Magi report content.",
      "- Do not modify files.",
      "- Do not run build, test, format, deploy, or device commands.",
      "- Do not ask procedural questions.",
      "- If information is missing, write the limitation under Evidence or Blocking Questions.",
      "",
    ].join("\n")
    const processResult = await runOnePiChild({
      invocation,
      args: buildChildArgs({ model: roleModels[sage].model, thinking: roleModels[sage].thinking }),
      cwd: projectRoot,
      promptText,
      timeoutMs: timeout,
      signal,
      spawnFn: spawnLike,
    })
    const reportPath = await writeReport({ promptPath, sage, model: roleModels[sage].model, processResult })
    const envelope = piEnvelope(processResult)
    return {
      sage,
      ok: envelope.status === "ok",
      failureType: envelope.status === "ok" ? null : envelope.failureType,
      piFailureType: envelope.nativeType,
      exitCode: processResult.exitCode,
      timedOut: processResult.timedOut,
      reportPath: reportPath.reportPath,
      stderr: processResult.stderr,
      error: processResult.error,
    }
  })
  const results = await Promise.all(childPromises)
  return {
    ok: results.every((result) => result.ok),
    halt: results.some((result) => result.failureType === "hard_error"),
    haltReason: results.some((result) => result.failureType === "hard_error") ? "hard_error" : null,
    hardErrors: results.filter((result) => result.failureType === "hard_error"),
    projectRoot,
    promptPath,
    round,
    pass,
    mode,
    executor: "spawn",
    results,
  }
}
```

Child spawn notes (apply during implementation, they are part of the contract, not optional):
- `runOnePiChild` builds argv as `[...invocation.args, ...buildChildArgs({ model, thinking }), promptText]` with `promptText` last (Pi `-p` swallows the next non-flag arg as the initial message).
- When a real extension (not the fake runner) invokes this, `runnerBin` is absent, so `resolvePiInvocation()` supplies `node <current-script>` or fallback `pi`; the child therefore needs `--append-system-prompt` ONLY if the test harness overrides it; production never passes it.
- Timeout escalation: first `SIGTERM`, then `SIGKILL` 5000 ms later (both `unref`-ed timers).
- Every `writeReport` writes via a temp file + `rename` for atomicity (reuse the `writeReport`+`bounded` helpers above; the final assembled file must export: `DELIBERATORS`, `ISOLATION_ARGS`, `resolvePiInvocation`, `buildChildArgs`, `parseJsonlStream`, `runOnePiChild`, `piEnvelope`, `reportBodyFor`, `bounded`, `reportPathForPrompt`, `writeReport`, `runPiCouncil`).

- [ ] **Step 4: Run tests**

Run: `node --test test/pi-adapter.test.mjs`
Expected: PASS (all Task 1-6 tests, including the fake-Pi concurrency test and the timeout/abort/hard-error variants).

- [ ] **Step 5: Commit**

```bash
git add adapters/pi/lib/pi-runner.js test/pi-adapter.test.mjs
git commit -m "feat(pi): add isolated JSON-mode council runner with fail-closed reports"
```

---

### Task 7: `magi_council` union validation and dispatch

**Files:**
- Modify: `adapters/pi/lib/controller.js` (add validation helpers below the guard code)
- Create: `adapters/pi/extension.js` (real implementation replaces the Task 2 stub)
- Test: `test/pi-adapter.test.mjs` (append)

**Interfaces:**
- Consumes: Task 5/6 (`runPiCouncil`, `enforcePhaseGuard`, `isHerdrActive`); Task 4 (`loadModelConfig`, `resolveRoleModels`); Task 3 (`detectActivation`); index.js artifact conventions.
- Produces:
  - `expectedCouncilPromptPath(projectRoot, mode, round, pass)` → `.open_magi/magi-log/round-RRR/{council|recon|review}‑*` path (follows `councilModePrefix` formulas: decision → `council-${pad3(pass)}`, recon → `recon-${pad3(pass)}`, review → `review-001`).
  - `validateCouncilInput(input: { projectRoot, promptPath, round, pass?, mode })` → `{ ok: true, normalized } | { ok: false, failType: "invalid_council_input", error }`
  - `consumeCouncilRequest(controllerState, { projectRoot, promptPath, round, pass, mode, registry, spawnLike })` the tool-side entry used by extension; it returns an object or throws an Error with `[magi]` message

- [ ] **Step 1: Write the failing tests**

```js
import { expectedCouncilPromptPath, validateCouncilInput, consumeCouncilRequest } from "../adapters/pi/lib/controller.js"

test("expectedCouncilPromptPath follows the mode/round/pass artifact contract", () => {
  assert.equal(expectedCouncilPromptPath("/p", "decision", 1, 1), "/p/.open_magi/magi-log/round-001/council-001/prompt.md")
  assert.equal(expectedCouncilPromptPath("/p", "recon", 1, 1), "/p/.open_magi/magi-log/round-001/recon-001/prompt.md")
  assert.equal(expectedCouncilPromptPath("/p", "review", 2, undefined), "/p/.open_magi/magi-log/round-002/review-001/prompt.md")
})

test("magi_council input must match its mode's union shape before any state check", () => {
  const base = { projectRoot: "/p", round: 1, mode: "decision" }
  let result = validateCouncilInput({ ...base, pass: 1, promptPath: "/p/.open_magi/magi-log/round-001/council-001/prompt.md" })
  assert.equal(result.ok, true)
  result = validateCouncilInput({ ...base, pass: 0, promptPath: "/p/.open_magi/magi-log/round-001/council-001/prompt.md" })
  assert.equal(result.ok, false)
  result = validateCouncilInput({ ...base, mode: "decision", promptPath: "/p/.open_magi/magi-log/round-001/council-001/prompt.md" })
  assert.equal(result.ok, false)
  result = validateCouncilInput({ ...base, mode: "review", pass: 1, promptPath: "/p/.open_magi/magi-log/round-001/review-001/prompt.md" })
  assert.equal(result.ok, false)
  result = validateCouncilInput({ ...base, mode: "review", promptPath: "/p/.open_magi/magi-log/round-001/review-001/prompt.md" })
  assert.equal(result.ok, true)
  result = validateCouncilInput({ ...base, mode: "council", pass: 1, promptPath: "/.open_magi/magi-log/round-001/council-001/prompt.md" })
  assert.equal(result.ok, false)
})

test("magi_council rejects traversal and stale-pass prompt paths", () => {
  const traversal = validateCouncilInput({ projectRoot: "/p", round: 1, pass: 1, mode: "decision", promptPath: "/etc/passwd" })
  assert.equal(traversal.ok, false)
  const stale = validateCouncilInput({ projectRoot: "/p", round: 2, pass: 2, mode: "decision", promptPath: "/p/.open_magi/magi-log/round-002/council-002/prompt.md" })
  assert.equal(stale.ok, true)
  // Stale rejection happens against live state in consumeCouncilRequest; validateCouncilInput accepts shape-consistent paths.
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/pi-adapter.test.mjs`
Expected: FAIL — `expectedCouncilPromptPath` and `validateCouncilInput` not exported from controller.js yet.

- [ ] **Step 3: Implement `expectedCouncilPromptPath` and `validateCouncilInput` in controller.js**

```js
const COUNCIL_MODES = new Set(["recon", "decision", "review"])

function pad3(value) {
  return String(Math.max(Number(value) || 1, 1)).padStart(3, "0")
}

export function expectedCouncilPromptPath(projectRoot, mode, round, pass) {
  const folder = mode === "recon" ? `recon-${pad3(pass)}` : mode === "review" ? "review-001" : `council-${pad3(pass)}`
  return join(projectRoot, LOG_DIR, `round-${pad3(round)}`, folder, "prompt.md")
}

export function validateCouncilInput(input) {
  const mode = input?.mode
  if (!COUNCIL_MODES.has(mode)) {
    return { ok: false, failType: "invalid_council_input", message: "[magi] magi_council mode must be recon, decision, or review." }
  }
  const round = Number(input?.round)
  if (!Number.isInteger(round) || round < 1) {
    return { ok: false, failType: "invalid_council_input", message: "[magi] magi_council round must be a positive integer." }
  }
  const pass = input?.pass
  if (mode === "review") {
    if (pass !== undefined && pass !== null) {
      return { ok: false, failType: "invalid_council_input", message: "[magi] review acquisitions must omit pass." }
    }
  } else if (!Number.isInteger(Number(pass)) || Number(pass) < 1) {
    return { ok: false, failType: "invalid_council_input", message: `[magi] ${mode} requests require a positive pass.` }
  }
  if (!input?.promptPath || !input?.projectRoot || input.promptPath.includes("..")) {
    return { ok: false, failType: "invalid_council_input", message: "[magi] magi_council promptPath must be a non-traversal path inside the project." }
  }
  const expected = expectedCouncilPromptPath(input.projectRoot, mode, round, mode === "review" ? undefined : Number(pass))
  if (resolve(input.promptPath) !== expected) {
    return { ok: false, failType: "invalid_council_input", message: "[magi] magi_council promptPath must resolve to the artifact location for its mode/round/pass: " + expected }
  }
  return { ok: true, normalized: { projectRoot: resolve(input.projectRoot), promptPath: resolve(input.promptPath), round, pass: mode === "review" ? undefined : Number(pass), mode } }
}
```

- [ ] **Step 4: Implement the tool registration in `adapters/pi/extension.js` (replace stub)**

`extension.js` full content (this is the heart of the integration; background task keeps it thin):

```js
import { Type } from "typebox"
import { detectActivation, MAGI_COMMAND, buildSkillInvocation, injectionOptions } from "./lib/activation.js"
import { isHerdrActive, TRANSPORT_MISMATCH_ERROR, classifyGuardTools, guardDiagnostic, validateCouncilInput, consumeCouncilRequest, enforcePhaseGuard } from "./lib/controller.js"
import { loadModelConfig, resolveRoleModels, userModelConfigPath, projectModelConfigPath, writeModelConfig, ROLE_NAMES } from "./lib/config.js"
import { runPiCouncil } from "./lib/pi-runner.js"

const councilInputSchema = Type.Object({
  projectRoot: Type.String({ description: "Absolute path to the Magi project root" }),
  promptPath: Type.String({ description: "Path to the council prompt file, relative to the project root unless absolute" }),
  round: Type.Integer({ minimum: 1, description: "Current round" }),
  pass: Type.Integer({ minimum: 1, description: "Decision/recon pass; omit for review" }),
  mode: Type.String({ description: "recon | decision | review" }),
})

export default async function (pi) {
  const stateRefs = { lastController: null }

  pi.registerCommand("magi", {
    description: "Run Open Magi deliberation on a goal",
    async handler(args, ctx) {
      if (isHerdrActive()) {
        ctx.ui.notify("[magi] Herdr session detected; use .open-magi-herdr activation instead.", "warning")
        await pi.sendUserMessage(`/skill:magi ${args.body}`).catch(() => {})
        return
      }
      const opts = injectionOptions(!ctx.isIdle())
      await pi.sendUserMessage(buildSkillInvocation(args.body), opts)
    },
  })

  pi.registerCommand("magi-setup", {
    description: "Edit per-role Pi model overrides",
    async handler(_args, ctx) {
      const scope = await ctx.ui.select("Open Magi model overrides", ["User scope (getAgentDir/open-magi.json)", "Project scope (trusted only)"])
      if (!scope) return
      const targetPath = scope.startsWith("User") ? userModelConfigPath() : projectModelConfigPath(ctx.cwd)
      if (scope.startsWith("Project") && !ctx.isProjectTrusted()) {
        ctx.ui.notify("[magi] Project is untrusted; project open-magi.json cannot be read or written.", "warning")
        return
      }
      const next = { version: 1, models: {} }
      for (const role of ROLE_NAMES) {
        const userSelector = lastValid?.user?.models?.[role] ?? ""
        const projectSelector = scope.startsWith("Project") ? (lastValid?.project?.models?.[role] ?? "") : ""
        const answer = await ctx.ui.input(`${role} model (${role === "melchior" ? "feasibility" : role === "balthasar" ? "architecture" : "root cause"}). Empty to inherit`, scope.startsWith("User") ? userSelector : projectSelector)
        if (answer && answer.trim()) next.models[role] = answer.trim()
      }
      await writeModelConfig(targetPath, next, { scope: scope.startsWith("User") ? "user" : "project" })
      ctx.ui.notify("[magi] Model overrides written: " + targetPath, "info")
    },
  })

  pi.registerTool({
    name: "magi_council",
    label: "Magi Council",
    description: "Run one Open Magi deliberation pass (three isolated read-only Pi children) and atomically write the three role reports.",
    promptSnippet: "magi_council: execute a Magi deliberation pass in active Magi loops",
    parameters: councilInputSchema,
    execute: async (toolCallId, params, signal, onUpdate, ctx) => {
      const validation = validateCouncilInput(params)
      if (!validation.ok) return { content: [{ type: "text", text: validation.message }], details: { rejected: validation.failType } }
      const state = await readCurrentControllerState()
      if (isHerdrActive()) return transportMismatch(state) // see controller.js helpers
      return consumeCouncilRequest(state, { ...validation.normalized, registry: stateRefs, isProjectTrusted: ctx.isProjectTrusted(), signal, pi })
    },
  })

  pi.on("input", async (event, ctx) => {
    const detection = detectActivation(event.text, ctx)
    if (detection.action === "activate") {
      const opts = injectionOptions(event.streamingBehavior != null)
      pi.sendUserMessage(buildSkillInvocation(detection.goal), opts)
      return { action: "handled" }
    }
    if (detection.action === "handled") {
      ctx.ui?.notify?.(detection.message, "warning")
      return { action: "handled" }
    }
    return undefined
  })

  pi.on("session_start", async (_event, ctx) => restoreControllerState(ctx))
  pi.on("tool_call", toolCallHandler(stateRefs))
  pi.on("agent_settled", settledHandler(stateRefs))
  pi.on("session_shutdown", async () => { await abortOwnedChildren() })

  stateRefs.lastController = createNativeController({ pi })
}
```

The four helpers it calls live in `controller.js` (Task 8) and `config.js` (lastValid read via `loadModelConfig` on session_start, reused by `/magi-setup`); `writeModelConfig` import is added to header import statement at the top.

- [ ] **Step 5: Run tests**

Run: `node --test test/pi-adapter.test.mjs`
Expected: PASS (all existing + Task 7 tests).

- [ ] **Step 6: Commit**

```bash
git add adapters/pi/lib/controller.js adapters/pi/extension.js test/pi-adapter.test.mjs
git commit -m "feat(pi): register magi_council tool with union validation and transport gate"
```

---

### Task 8: Native controller — transport gate, state, magi_council dispatch, settled actions, shutdown

**Files:**
- Modify: `adapters/pi/lib/controller.js` (append controller section)
- Test: `test/pi-adapter.test.mjs` (append)

**Interfaces:**
- Consumes: Task 6 `runPiCouncil`; Task 4 config; index.js conventions for state/log layout (adapter-local re-implementation).
- Produces:
  - `createNativeController({ pi })` → `{ state, setState, council(request, helpers), settled(event, ctx), toolCall(event), shutdown() }`
  - `consumeCouncilRequest(controller, request)` where `request = validation.normalized + { registry, isProjectTrusted, signal, pi }`; behavior contract below
  - `restoreControllerState(ctx)` → scans `ctx.sessionManager.getEntries()` for `customType === "open-magi-controller"` and rebuilds session-scoped state
  - `readCurrentControllerState()` (used by the tool): alias for controller state accessor
  - `transportMismatch()` → always throws/closes with TRANSPORT_MISMATCH_ERROR
  - `settledActions({ state, projectRoot, nowMs, questionRequestPath exists })` → `{ kind: "none" | "continue" | "corrective" | "question" | "denied" }`
  - `abortOwnedChildren()` — resolves when every runner from this PID has settled or been killed

- [ ] **Step 1: Write the failing tests**

```js
import { createNativeController, consumeCouncilRequest, settledActions, CONTINUE_TEXT_PI, HARD_MAX_TIMEOUT_MS } from "../adapters/pi/lib/controller.js"

test("consumeCouncilRequest hard-fails on transport mismatch without config or runner work", async () => {
  const calls = { config: 0 }
  const fake = { ... }
  await assert.rejects(() => consumeCouncilRequest({ herdr: true }, {
    projectRoot: "/p", round: 1, pass: 1, mode: "decision",
    promptPath: "/p/.open_magi/magi-log/round-001/council-001/prompt.md",
    registry: { loadModelConfig: () => { calls.config += 1; return { ok: true, user: null, project: null } } },
  }), /transport mismatch/)
  assert.equal(calls.config, 0, "must not read Pi model config in Herdr mode")
})

test("invalid config blocks dispatch with diagnostics and no role report", async () => {
  const result = await consumeCouncilRequest({ herdr: false, state: { sessionID: "s", projectRoot: "/p", active: true } }, {
    projectRoot: "/p", round: 2, pass: 1, mode: "decision", promptPath: "/p/.open_magi/magi-log/round-002/council-001/prompt.md",
    registry: { loadModelConfig: async () => ({ ok: false, error: "bad" }) },
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /configuration|invalid/i)
  assert.equal(result.results, undefined)
})

test("stale pass rejected when live prompt differs from input path", async () => {
  const result = await consumeCouncilRequest(controllerStateFor({ currentRound: 2, currentDeliberationPass: 1 }), {
    projectRoot: "/p", round: 2, pass: 2, mode: "decision",
    promptPath: "/p/.open_magi/magi-log/round-002/council-002/prompt.md",
    registry: { loadModelConfig: async () => ({ ok: true, user: null, project: null }) },
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /stale/) // live pass is 1; pass 2 is future/stale
})

test("settled actions follow the deterministic contract", () => {
  const activeState = { active: true, currentPhase: "parallel_deliberation", sessionID: "s", projectRoot: "/p", needsContinue: false, deliberationStatus: "collecting_reports" }
  assert.equal(settledActions({ state: activeState }).injectContinuation, true)
  assert.equal(settledActions({ state: { ...activeState, currentPhase: "complete", active: false } }).kind, "none")
})

test("CONTINUE_TEXT_PI mentions state paths and forbids procedural questions", () => {
  assert.match(CONTINUE_TEXT_PI, /state\.json/)
  assert.match(CONTINUE_TEXT_PI, /currentRound|currentPhase/)
  assert.match(CONTINUE_TEXT_PI, /Do not ask procedural questions/)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/pi-adapter.test.mjs`
Expected: FAIL — `createNativeController`/`consumeCouncilRequest`/`settledActions`/`CONTINUE_TEXT_PI` missing.

- [ ] **Step 3: Implement controller section**

Append to `adapters/pi/lib/controller.js`:

```js
export const CONTINUE_TEXT_PI = `[magi] Continue the active deliberation loop.
Read \`.open_magi/magi-log/state.json\` and \`.open_magi/magi-log/checklist.md\`,
resume from \`currentRound\` and \`currentPhase\`, clear \`inFlight\`, then continue
the 6-phase protocol. Do not restart the goal.
${CONTINUE_RULES_TEXT}`

const CONTINUE_RULES_TEXT = [
  "Do not ask procedural questions.",
  "If the next action is defined by the Magi skill, checklist, state.json, phase contract, log layout, or report format, execute it and write the required artifact.",
  "Forbidden procedural questions include whether to write reports, which role each deliberator has, whether to launch all three deliberators, whether to use one shared prompt, where reports belong, or whether to move to the next phase.",
  "Before asking the user, apply the Before Asking User Gate. Only ask for Phase 1 goal ambiguity, impossible verification, execution blockers, destructive or unrelated risk, or ambiguous file ownership.",
].join("\n")

const NO_PROGRESS_LIMIT = 5
export const HARD_MAX_TIMEOUT_MS = 60 * 60 * 1000

export function settledActions({ state, nowMs = Date.now() }) {
  if (!state?.active) return { kind: "none" }
  const missingRequired = currentRoundArtifacts(state) || []
    .filter((relative) => !existsImpl(join(state.projectRoot ?? "", relative)))
  if (missingRequired.length > 0) return { kind: "corrective", missing: missingRequired }
  return { kind: "continue" }
}

export function createNativeController({ pi }) {
  const controller = {
    state: null,
    setState(nextState) {
      this.state = nextState
      if (pi && pi.appendEntry) pi.appendEntry("open-magi-controller", { ...nextState, ownedChildren: [] })
    },
    async council(request, helpers = {}) {
      return consumeCouncilRequest(controller, request)
    },
    async settled(event, ctx) {
      return settledActions({ state: this.state, ...ctx })
    },
    async shutdown() {
      abortOwnedChildren()
    },
  }
  return controller
}

export async function restoreControllerState(ctx) {
  if (!ctx?.sessionManager?.getEntries) return null
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry?.type === "custom" && entry?.customType === "open-magi-controller" && entry?.data?.sessionID === ctx.sessionManager.getSessionId()) {
      return entry.data
    }
    if (entry?.type === "custom" && entry?.customType === "open-magi-controller" && !entry?.data?.sessionID) return entry.data
  }
  return null
}

export async function consumeCouncilRequest(controller, request) {
  const { projectRoot, round, pass, mode, promptPath, registry, isProjectTrusted, signal, pi } = request
  if (isHerdrActive()) {
    throw new Error(TRANSPORT_MISMATCH_ERROR) // never read config, spawn, or alter Herdr ownership
  }
  const config = await registry.loadModelConfig({ projectRoot, isProjectTrusted }) // config.js implementation honoring host peers
  const failure = await preflight({ controller, request, config })
  if (failure) return failure // no role report, no envelope: invalid config / wrong state / phase / round
  const roleModels = resolveRoleModels(controller?.model ?? "inherit", controller?.thinkingLevel ?? null, config.user, config.project)
  const run = await runPiCouncil({ ...invocationArgs, projectRoot, promptPath, round, pass, mode, roleModels, timeoutMs: deliberatorTimeoutFor(controller.state), signal, spawnLike: spawn ?? registry.spawnLike })
  return { ok: run.ok, halt: run.halt, haltReason: run.haltReason, hardErrors: run.hardErrors, results: run.results }
  async function preflight() {} // merged into preflight() below; implement once
}
```

The full assembled section must define, before use: `CONTINUE_TEXT_PI`, `CONTINUE_RULES_TEXT`, `settledActions` (two-bounded-action contract: return one action object with `kind` from `"none" | "continue" | "corrective" | "question" | "denied"`; `launchCouncil` orchestration uses `magi-log/round-…/council-.*` and passes `run.*` reports back; `activeDeliberators` bookkeeping by `registerDeliberatorEntry` naming from index.js), and `consumeCouncilRequest` which (in order) performs:
1. `isHerdrActive()` → throw `Error(TRANSPORT_MISMATCH_ERROR)` immediately (no config, no spawn).
2. `validateCouncilInput` (already throws/returns malformed before touching state).
3. `loadModelConfig` — on `ok === false` return `{ ok: false, error }` WITHOUT dispatching or writing any role report (failType `invalid_config`).
4. `controller.state` inactive → return `{ ok: false, error: "[magi] No active Magi loop in this project; open /skill:magi <question> first." }`; `projectRoot !== controller.state.projectRoot` → same message shape `"[magi] magi_council runs only in the session that owns the Magi loop."`.
5. `mode !== controller.state.currentCouncilMode` or `round !== roundNumberOf(state)` or (mode !== "review" && `pass !== expectedPass` (recon pass or deliberation pass)) → `{ ok: false, failType: "stale_council_request", "[magi] magi_council request is stale for the active round/pass; regenerate the prompt." }`.
6. Otherwise run `runPiCouncil` and map it to the union via `piEnvelope`-only vocabulary (`failure_type` envelope happens in the runner); return `{ ok, halt, haltReason, hardErrors, results }`.

- [ ] **Step 4: Run tests**

Run: `node --test test/pi-adapter.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add adapters/pi/lib/controller.js test/pi-adapter.test.mjs
git commit -m "feat(pi): add native controller transport gate, dispatch, and settled actions"
```

- [ ] **Step 6: Full focused verification**

Run: `node --check adapters/pi/lib/controller.js && node --check adapters/pi/extension.js`
Expected: no output (both files parse). Then `node --test test/pi-adapter.test.mjs` PASS.

---

### Task 9: Required-artifact port, guard recompute-on-dispatch, `/magi-setup` polish

**Files:**
- Modify: `adapters/pi/lib/controller.js`, `adapters/pi/extension.js`
- Test: `test/pi-adapter.test.mjs` (append)

**Interfaces:**
- Produces: `currentRoundArtifacts(state)` (same artifact list as `index.js` `currentCouncilRoundArtifacts`, schemaVersion ≥2 path only — Recon 1 evidence-base.md + recon passes, research-prompt.md, council reports, synthesis.md, direction-selection.md, verdict.md, verification.md, cleanup.md, review reports), used by `settledActions`; guard recompute helper `assertGuardableToolSet(toolInfos, activeToolNames)` used on every dispatch (not just activation).

- [ ] **Step 1: Write the failing tests**

```js
import { currentRoundArtifacts, assertGuardableToolSet } from "../adapters/pi/lib/controller.js"

test("required artifacts follow the council-state contract", () => {
  const state = { schemaVersion: 2, currentRound: 2, currentDeliberationPass: 2, maxDeliberationPasses: 3, currentCouncilMode: "decision", currentPhase: "synthesis", projectRoot: "/p" }
  const artifacts = currentRoundArtifacts(state)
  assert.ok(artifacts.includes(".open_magi/magi-log/round-001/recon-001/report-melchior.md"))
  assert.ok(artifacts.includes(".open_magi/magi-log/round-002/research-prompt.md"))
  assert.ok(artifacts.includes(".open_magi/magi-log/round-002/council-001/synthesis.md"))
  assert.ok(artifacts.includes(".open_magi/magi-log/round-002/direction-selection.md"))
  assert.ok(artifacts.includes(".open_magi/magi-log/round-002/verdict.md"))
})

test("guard recompute blocks dispatch on unknown builtin", () => {
  const result = assertGuardableToolSet([{ name: "todo", sourceInfo: { source: "builtin" } }], ["todo"])
  assert.equal(result.ok, false)
  assert.match(guardDiagnostic("todo"), /fails closed/)
})
```

- [ ] **Step 2: RED — run tests to fail**

Run: `node --test test/pi-adapter.test.mjs`
Expected: FAIL — `currentRoundArtifacts` / `assertGuardableToolSet` not exported.

- [ ] **Step 3: Implement**

Port `currentCouncilRoundArtifacts` (verbatim contract from index.js L1236–1300; adapt: adapters return artifact paths without the project root, relative to the magi-log root, so the same prefix formulas from Task 5's helpers apply). Add `assertGuardableToolSet(toolInfos, activeToolNames)` calling `classifyGuardTools` and returning exactly `{ ok: true }` or `{ ok: false, message: guardDiagnostic(unknown[0]) }`. In `extension.js` `consumeCouncilRequest` call path, guard recompute happens before dispatch: `const guardCheck = assertGuardableToolSet(pi.getAllTools(), pi.getActiveTools()); if (!guardCheck.ok) return { ok: false, failType: "guard_drift", error: guardCheck.message }`.

Also complete `/magi-setup` safety details in extension.js: user scope writes go through `writeModelConfig(..., { scope: "user" })` (chmod 0600), project scope requires `ctx.isProjectTrusted()`, cleared roles are omitted from `next.models` (so they inherit from lower precedence), unchanged role values read via fresh `loadModelConfig` (no stale cache), and updates never post to Herdr (no changes needed since Herdr never runs this command's tool path).

- [ ] **Step 4: Run tests, then commit**

Run: `node --test test/pi-adapter.test.mjs` → PASS.
Commit: `git add adapters/pi/lib/controller.js adapters/pi/extension.js test/pi-adapter.test.mjs && git commit -m "feat(pi): port required-artifact contract and per-dispatch guard recompute"`

- [ ] **Step 5: Herdr regression tests (same task, separate suite section)**

Append to `test/pi-adapter.test.mjs`:

```js
test("HERDR_ENV=1 disables native council config/runner/spawn paths", async () => {
  const state = { active: true, projectRoot: "/p", currentRound: 2, currentDeliberationPass: 1, currentCouncilMode: "decision", currentPhase: "parallel_deliberation", sessionID: "s" }
  const originalHerdr = process.env.HERDR_ENV
  process.env.HERDR_ENV = "1"
  try {
    await assert.rejects(
      () => consumeCouncilRequest({ ...controllerStateFor(state), state }, {
        projectRoot: "/p", round: 2, pass: 1, mode: "decision",
        promptPath: "/p/.open_magi/magi-log/round-002/council-001/prompt.md",
        registry: { loadModelConfig: async () => { throw new Error("config must not load") }; }
      }),
      /transport mismatch/
    )
  } finally {
    process.env.HERDR_ENV = originalHerdr
  }
})
```

(`controllerStateFor` is the suite's tiny factory reused from Task 8 tests.) Missing/invalid `.open-magi-herdr` behavior, pane layout, and cleanup remain covered by the untouched `test/package.test.mjs` Herdr suite; the Pi suite adds the negative-spawn assertion only. Run and commit:

```bash
node --test test/pi-adapter.test.mjs
git add test/pi-adapter.test.mjs adapters/pi/lib/controller.js && git commit -m "test(pi): assert Herdr hard gate blocks native runner paths"
```

---

### Task 10: Documentation

**Files:**
- Modify: `README.md`, `README.zh-TW.md`
- Test: `test/package.test.mjs` (section-anchor probes are extended only if existing tests require; keep per-file text minimal)

**Interfaces:**
- Produces: user-visible docs for Pi install/activation/config/Herdr modes.

- [ ] **Step 1: Draft `README.md` section (before "Development" section):**

Brief section "## Pi Activation and Installation (experimental)" documenting: local `pi install .`, remote install with `OPEN_MAGI_SKIP_POSTINSTALL=1`, `/magi`, `/skill:magi`, natural-language activation examples (English + the two Chinese example strings as escaped runtime literals — describe them in prose, no Han characters outside README.zh-TW.md), `/magi-setup`, override precedence `main Pi session → user → trusted project`, strict native isolation flags, `magi_council` role, Herdr bypass hard gate, and a link `README.md#herdr-native-deliberation` standing rule that Herdr remains authoritative.

- [ ] **Step 2: Mirror in `README.zh-TW.md`** (same structure, zh-TW prose; Han characters allowed only here).

- [ ] **Step 3: Extend parity/docs tests if the existing pattern requires adapters to be listed; run `node --test test/package.test.mjs test/pi-adapter.test.mjs` (PASS) and commit**

```bash
node --test test/package.test.mjs test/pi-adapter.test.mjs
git add README.md README.zh-TW.md && git commit -m "docs: document experimental Pi installation, activation, and Herdr precedence"
```

---

### Task 11: Full verification and handoff

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

```bash
npm test
```
Expected: all four `node --test` files pass — package, plugin, setup, pi-adapter.

- [ ] **Step 2: Packaging smoke**

```bash
npm pack --dry-run
```
Expected: tarball file list includes `adapters/pi/README.md`, `adapters/pi/extension.js`, adapter skills, `package.json` with the `pi` manifest; peerDependencies list exactly the two optional `"*"` entries.

- [ ] **Step 3: Manual install smoke (machine with `pi` CLI available; skip step if `pi` not installed and record that in the report)**

```bash
export PI_CODING_AGENT_DIR=$(mktemp -d)
pi install .
pi list
```
Expected: one Open Magi extension and the magi skill discovered from the repo root, with no network access required.

- [ ] **Step 4: Placeholder scan**

```bash
grep -rn "TBD\|TODO\|placeholder\|照前項處理" adapters/pi test/pi-adapter.test.mjs docs/superpowers/plans/2026-09-19-pi-agent-support.md || true
```
Expected: no plan-authored hits (the word only appears if the plan text itself contains instructions about placeholders — remove any such line before committing).

- [ ] **Step 5: git status hygiene**

```bash
git status --porcelain
```
Expected: only `.fatima/` entries untracked; no unrelated tracked-file modifications.

---

## Spec Coverage Map

| Spec section | Plan tasks |
| --- | --- |
| Goals | Tasks 1-11 |
| Packaging and Installation | Task 1 (manifest/peers/test script), Task 2 (assets + README install), Task 11 (pack + `pi install .` smoke) |
| Activation (`/magi`, `/skill:magi`, NL, expansion, executeAs-uptime streaming, non-interactive rejection) | Task 3, Task 7 (`/magi` handler), Task 8 (`input` wiring) |
| Transport Gate | Task 5 (`isHerdrActive`), Task 7 (tool reject), Task 8 (`consumeCouncilRequest` step 1), Task 9 (regression suite) |
| Pi Extension Surface (`/magi`, `/magi-setup`, `magi_council`, lifecycle events) | Tasks 7-9 |
| `magi_council` input union + path invariants | Task 7 |
| Model Configuration (`getAgentDir()`, `CONFIG_DIR_NAME`, schema-1 strict, trust, `/magi-setup` atomic/0600) | Tasks 4, 9 |
| Native Council Runner (executable resolution, isolation args, JSONL, failure types, timeout/abort, atomic reports) | Task 6 |
| Guard/Firewall/Backstop (builtin provenance guard, phase policy, bash+powershell parsing, recompute per dispatch, `agent_settled` bounded actions, no-progress/stale-lock) | Tasks 5, 8, 9 |
| Failure Semantics (`invalid_config` pre-dispatch; timeout/hard_error envelope; native subtype in `pi_diag:` only) | Tasks 6, 8 |
| Testing Strategy (activation/config/runner/lifecycle/Herdr/packaging/docs) | Tasks 2-9 tests + Task 11 |
| Documentation (README.md, README.zh-TW.md, adapters/pi/README.md) | Tasks 2, 10 |
| Acceptance Criteria 1-8 | Task 11 steps 1-3 map to 1/8; Tasks 3,7 → 2; Tasks 6,8 → 3; Task 4 → 4; Tasks 6,8 → 5; Tasks 5,8,9 → 6; Tasks 5,8,9 (Herdr) → 7; Tasks 2,10,11 → 8 |

## Self-Review Notes (completed during writing)

1. Spec coverage: every spec section maps to a task (table above); no section lacks a task.
2. Placeholder scan: code blocks are complete per module; the two intentional "transcription-order" notes in Tasks 5/6 tell the worker exactly how to assemble files and are not TBDs. Remove any "#" TBD strings if the plan text is transcribed verbatim.
3. Type consistency: `runPiCouncil` result keys (`ok`, `halt`, `haltReason`, `hardErrors`, `results`), `piEnvelope` return shape (`status`, `failureType`, `nativeType`, `stance`, `blocking`, `risk`), and `validateCouncilInput`'s `{ ok, failType, message, normalized }` agree across Tasks 5-8. `CONTINUE_TEXT_PI` matches Task 8's consumer. `reportPathForPrompt` path shape matches spec's `round-RRR/council-PPP/prompt.md` naming.




