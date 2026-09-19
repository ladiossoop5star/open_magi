# Pi Agent Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement experimental native Pi support for Open Magi (adapter + native council runner + guard + packaging) exactly as specified in `docs/superpowers/specs/2026-09-19-pi-agent-support-design.md`.

**Architecture:** A new `adapters/pi/` extension is discovered by Pi from the repository root package manifest (`package.json` → `pi` key). `extension.js` registers `/magi`, `/magi-setup`, the internal `magi_council` tool, and Pi lifecycle handlers (`input`, `session_start`, `tool_call`, `agent_settled`, `session_shutdown`), routing to four focused library modules: `activation.js` (natural-language → `input`-event `transform` into `/skill:magi <original>`; command handling uses `pi.sendUserMessage(..., { expandPromptTemplates: true, deliverAs: "followUp" iff streaming })`), `config.js` (strict schema-1 model overrides via a factory bound to the host's `getAgentDir()`/`CONFIG_DIR_NAME`), `controller.js` (transport gate, guard classification + bash/powershell phase guard, `magi_council` discriminated-union validation, required-artifact contract, question firewall, `agent_settled` bounded actions, no-progress/stale-lock, child-process classification), and `pi-runner.js` (three concurrent isolated JSON-mode Pi children, JSONL parsing, failure normalization, atomic reports). Host modules are resolved through declared optional `"*"` peers and injected into testable factories.

**Tech Stack:** Node.js ≥20 (ESM, `node:test` + `node:assert/strict`), Pi 0.85.1 extension API (`@earendil-works/pi-coding-agent` host peer, `typebox` for tool schemas), existing OpenCode artifact conventions (`index.js`) and Codex runner patterns (`adapters/codex/lib/codex-runner.js`).

Verified Pi 0.85.1 facts this plan relies on (from the installed package's `dist/core/extensions/types.d.ts` and `docs/extensions.md`):

- `RegisteredCommand.handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>` — command `args` is a plain string (text after the command name).
- `InputEventResult = { action: "continue" } | { action: "transform", text } | { action: "handled" }`; the `input` event sees raw text before `/skill:` expansion, and `transform` rewrites text then continues to expansion — so natural-language activation uses `transform` into `/skill:magi <original>`. `event.streamingBehavior` exists but is only informational for input handlers; it is NOT used to queue injections.
- `pi.sendUserMessage(content, options)` returns void; it throws synchronously when the agent is streaming without `deliverAs`, so the `/magi` command handler passes `deliverAs: "followUp"` exactly when `!ctx.isIdle()` (idle calls may omit `deliverAs`).
- `getAgentDir()` (honors `PI_CODING_AGENT_DIR`) and `CONFIG_DIR_NAME` are exported from `@earendil-works/pi-coding-agent`.
- Tool `execute` marks failure by throwing (sets `isError: true`); returning a value never sets the error flag — invalid `magi_council` input fails closed by throwing.
- Non-interactive modes: `ctx.mode` is `"tui" | "rpc" | "json" | "print"`; only `"tui"` is the interactive host.

## Global Constraints

- Host is interactive Pi only: Magi activation intent is honored when `ctx.mode === "tui"`; in `rpc`/`json`/`print` modes a Magi activation intent is rejected with a clear `[magi]` message, while ordinary non-Magi input passes through unchanged.
- Third-party package `pi-subagents` must NOT appear anywhere; the only permitted occurrence is the negative-assertion test.
- Host modules are imported only via host peers: `@earendil-works/pi-coding-agent` and `typebox`; both are declared in `peerDependencies` with `"*"` ranges and `"optional": true` in `peerDependenciesMeta`; neither may appear in `dependencies` or `bundledDependencies`.
- Never bundle a second copy of the Pi runtime; child invocation comes only from `resolvePiInvocation` (current script → packaged runtime → `pi` from PATH as final fallback), always `spawn(..., { shell: false })`.
- The `HERDR_ENV=1` transport gate runs before any native config read, controller initialization, or runner work. In Herdr mode the `/magi` command still injects `/skill:magi <goal>` (the portable skill's Herdr hard gate handles `.open-magi-herdr`), never reports an alternative activation path, never starts native config/runner, and never swallows send errors. `magi_council` rejects with the `TRANSPORT_MISMATCH_ERROR` by throwing. No fallback Herdr→native or native→Herdr in either direction.
- Chinese natural-language examples are matched at runtime as decoded strings; sources carry them as `"\u2026"` ASCII escapes. Literal Han characters may appear ONLY in `README.zh-TW.md` and never in `adapters/pi/**`, `test/**`, or `README.md`.
- `HARD_MAX_DELIBERATOR_TIMEOUT_MS = 60 * 60 * 1000`; default deliberator timeout `30 * 60 * 1000`.
- Report files are written atomically via a sibling temp file + `rename` (same directory as the target, so rename never crosses filesystems); reports live at `join(dirname(promptPath), `report-${sage}.md`)`.
- Failure envelope vocabulary stays `status: ok | timeout | hard_error`, `failure_type: none | timeout | hard_error`; native subtypes (`spawn_error`, `model_unavailable`, `aborted`, `nonzero_exit`, `invalid_json`, `missing_final_response`, and pre-dispatch `invalid_config`) appear ONLY in the bounded `pi_diag:` field, never in envelope fields.
- Success marker `report_source: pi_json`; failure marker `report_source: pi_json_failed`.
- Guard verdicts come only from Pi's tool API: a tool is a builtin iff `toolInfo.sourceInfo.source === "builtin"`; guard set = `pi.getActiveTools()` ∩ builtins; an unrecognized active builtin blocks activation/dispatch fail-closed.
- `npm test` must read `node --test test/package.test.mjs test/plugin.test.mjs test/setup.test.mjs test/pi-adapter.test.mjs`.
- Branch is `feat/pi-agent-support`; never push or merge in this plan's tasks.
- The OpenCode plugin (`index.js`) gains no Pi-specific branches; pure code stays adapter-local.

## File Structure

Create:

```text
adapters/pi/README.md                  adapter docs (Status/Install/Usage/Herdr Precedence)
adapters/pi/extension.js               Pi extension entry (commands, tool, lifecycle wiring only)
adapters/pi/lib/activation.js          activation intent detection + skill-invocation building
adapters/pi/lib/config.js              config factory: paths, strict schema load/validate, resolution, atomic writes
adapters/pi/lib/controller.js          transport gate, guard, magi_council validation/dispatch, artifacts, question firewall, settled actions, no-progress/stale-lock
adapters/pi/lib/pi-runner.js           Pi executable resolution, isolated JSON-mode children, JSONL parsing, report envelope
adapters/pi/skills/magi/SKILL.md       Pi runtime skill (adds "## Pi Bootstrap Gate")
adapters/pi/skills/magi/prompts/{melchior,balthasar,casper}.md
adapters/pi/skills/magi/references/{checklist-template,deliberation,execution-and-verification,herdr,protocol,question-firewall,troubleshooting}.md
adapters/pi/skills/magi/references/runtime.md
test/pi-adapter.test.mjs               every Pi adapter behavior test
```

Modify:

```text
package.json                           pi manifest, files, optional peers, test script (Task 1)
test/package.test.mjs                  parity loops + runtime.md matchers + Han probe + pack expectations (Tasks 1-2)
README.md                              "Pi Activation and Installation" section (Task 11)
README.zh-TW.md                        zh-TW section (Task 11)
```

Task dependency rule: every task's GREEN checkpoint compiles and passes all tests added up to that task, using only symbols that already exist. Tasks touch files in this order and never import from a future task.

---

### Task 1: Package manifest, peers, and test wiring

**Files:**
- Modify: `package.json`
- Test: `test/pi-adapter.test.mjs` (created by this task)

**Interfaces:**
- Produces: `package.json` `pi` manifest; `peerDependencies`/`peerDependenciesMeta` contract; `npm test` runs `test/pi-adapter.test.mjs`.

- [ ] **Step 1: Write the failing tests**

Create `test/pi-adapter.test.mjs`:

```js
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
export const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))

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
  const raw = readFileSync(join(repoRoot, "package.json"), "utf8")
  assert.ok(!raw.includes("bundledDependencies"), "no bundledDependencies key expected")
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

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/pi-adapter.test.mjs`
Expected: FAIL — `pkg.pi` is `undefined` (deepEqual throws), `peerDependencies` absent.

- [ ] **Step 3: Apply edits to `package.json`**

1. Add after `exports`, before `bin`:

```json
"pi": {
  "extensions": ["./adapters/pi/extension.js"],
  "skills": ["./adapters/pi/skills"]
},
```

2. Replace `files` with:

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

3. Replace the `test` script with:

```json
"test": "node --test test/package.test.mjs test/plugin.test.mjs test/setup.test.mjs test/pi-adapter.test.mjs"
```

4. Add after `engines`:

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
- Create: `adapters/pi/extension.js` (minimal stub, replaced by Task 8's full implementation), `adapters/pi/README.md`, `adapters/pi/skills/magi/SKILL.md`, `adapters/pi/skills/magi/references/runtime.md`
- Copy byte-identical: `adapters/pi/skills/magi/prompts/{melchior,balthasar,casper}.md` from `shared/magi/prompts/`; `adapters/pi/skills/magi/references/{checklist-template,deliberation,execution-and-verification,herdr,protocol,question-firewall,troubleshooting}.md` from `shared/magi/references/`
- Modify: `test/package.test.mjs` (parity loops + pack test)
- Test: `test/pi-adapter.test.mjs` (append)

**Interfaces:**
- Produces: `adapters/pi/skills/magi/**` assets; pack-file coverage for `adapters/pi`.

- [ ] **Step 1: Write the failing tests**

Append to `test/pi-adapter.test.mjs`:

```js
test("Pi manifest paths exist on disk", () => {
  for (const relative of ["adapters/pi/extension.js", "adapters/pi/skills/magi/SKILL.md", "adapters/pi/README.md"]) {
    assert.ok(readFileSync(join(repoRoot, relative), "utf8").length > 0, `${relative} must exist`)
  }
})

test("Pi adapter docs contain no Han characters", () => {
  const hanPattern = /\p{Script=Han}/u
  for (const file of ["adapters/pi/README.md", "adapters/pi/skills/magi/SKILL.md", "adapters/pi/skills/magi/references/runtime.md"]) {
    assert.ok(!hanPattern.test(readFileSync(join(repoRoot, file), "utf8")), `${file} must not contain Han characters`)
  }
})
```

In `test/package.test.mjs`:

1. In test `"shared Magi prompts and common references are identical across adapter skills"` (L2558), add `adapters/pi/skills/magi/` to the adapter skill list being byte-compared, and extend the `runtime.md` trio to a quartet: `adapters/pi/skills/magi/references/runtime.md` must match `/Pi Runtime Reference/`, differ from the other three, and must not match `/OpenCode Runtime Reference|Codex Runtime Reference|Claude Runtime Reference/`.
2. In test `"bundled magi skill assets contain the expected contract"` (L2129), add:

```js
assert.match(readFileSync(join(root, "adapters/pi/skills/magi/SKILL.md"), "utf8"), /Pi Bootstrap Gate/)
assert.doesNotMatch(readFileSync(join(root, "adapters/pi/skills/magi/SKILL.md"), "utf8"), /OpenCode Bootstrap Gate|Codex Bootstrap Gate|Claude Bootstrap Gate/)
```

3. In the Han-character probe block (`hanPattern` at L18), add `adapters/pi/README.md`, `adapters/pi/skills/magi/SKILL.md`, and `adapters/pi/skills/magi/references/runtime.md` to the scanned set.
4. In the pack test `"package metadata exposes OpenCode plugin, setup CLI, and injected plugin tests"` (L330), add `assert.ok(packNames.some((n) => n.startsWith("adapters/pi/")), "pack must include adapters/pi")` and remove nothing from existing exclusions (`adapters/codex` and `adapters/claude` stay excluded from `files`; only `adapters/pi` is added).

- [ ] **Step 2: RED**

Run: `node --test test/pi-adapter.test.mjs test/package.test.mjs`
Expected: FAIL — `ENOENT adapters/pi/...`, parity mismatch, pack assertion failure.

- [ ] **Step 3: Create the assets**

```bash
mkdir -p adapters/pi/skills/magi/prompts adapters/pi/skills/magi/references
for role in melchior balthasar casper; do cp shared/magi/prompts/$role.md adapters/pi/skills/magi/prompts/$role.md; done
for ref in checklist-template deliberation execution-and-verification herdr protocol question-firewall troubleshooting; do cp shared/magi/references/$ref.md adapters/pi/skills/magi/references/$ref.md; done
cp skills/magi/SKILL.md adapters/pi/skills/magi/SKILL.md
cp skills/magi/references/runtime.md adapters/pi/skills/magi/references/runtime.md
printf 'export default function () {}\n' > adapters/pi/extension.js
```

Edit `adapters/pi/skills/magi/SKILL.md`: replace the entire `## Herdr Magi Activation Hard Gate` section with the `## Pi Bootstrap Gate` section below; keep every other section byte-identical to `skills/magi/SKILL.md`; the adapter skill must not mention OpenCode, Codex, or Claude:

```markdown
## Pi Bootstrap Gate

- In Herdr mode (`HERDR_ENV=1`): perform exactly one lstat of `<cwd>/.open-magi-herdr`
  before any other Magi work. If it is missing, ask for the exact melchior,
  balthasar, and casper commands, then atomically write the file with mode 0600,
  add it to `.git/info/exclude`, and revalidate. Then load `references/herdr.md`,
  bind the Herdr pane, and run the loop through Herdr panes. The native Pi
  council never runs in Herdr mode.
- Outside Herdr: deliberation is launched only through the `magi_council` tool.
  Never spawn deliberators yourself and never discover a runner through the shell.
```

Replace `adapters/pi/skills/magi/references/runtime.md` with:

```markdown
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
```

Create `adapters/pi/README.md`:

```markdown
# Open Magi for Pi

## Status

Experimental. OpenCode remains the only production-supported runtime; the Pi
adapter matches the current maturity of the Codex and Claude adapters.

## Install for Local Development

```bash
cd /path/to/open_magi
pi install .
```

Remote (Git) installs must skip the repo root `postinstall` (it configures
OpenCode, not Pi):

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

Under `HERDR_ENV=1` the `.open-magi-herdr` activation gate, pane ownership, and
the three-pane lifecycle are authoritative; the native Pi council rejects
invocation. See README.md#herdr-native-deliberation.

## Limitations

- No print/JSON/RPC main controller in the first release.
- No general Pi subagents; the runner is council-only.
- Deliberator children load no user extensions, skills, prompt templates,
  themes, or project context files.
```

- [ ] **Step 4: GREEN**

Run: `node --test test/pi-adapter.test.mjs test/package.test.mjs`
Expected: PASS (existing suite stays green: root SKILL.md untouched; parity quartet consistent).

- [ ] **Step 5: Commit**

```bash
git add adapters/pi test/pi-adapter.test.mjs test/package.test.mjs
git commit -m "feat(pi): add Pi skill assets, runtime reference, and parity coverage"
```

---

### Task 3: Activation — `adapters/pi/lib/activation.js`

**Files:**
- Create: `adapters/pi/lib/activation.js`
- Test: `test/pi-adapter.test.mjs` (append)

**Interfaces:**
- Produces (pure module, no imports beyond nothing):
  - `MAGI_COMMAND = "/magi"`, `SKILL_COMMAND = "skill:magi"`
  - `buildSkillInvocation(goal: string): string` — `/skill:magi ` + trimmed goal (original case/content preserved)
  - `injectionOptions(isStreaming: boolean)` — `{ expandPromptTemplates: true }` plus `deliverAs: "followUp"` iff `isStreaming`
  - `isInteractiveHost(context)` — `context?.mode === "tui"`
  - `detectActivation(rawText: string, context: { source: string, mode: string })` → `{ action: "transform", text: string } | { action: "handled", message: string } | { action: "continue" }`
    - `/magi <rest>` → transform into `/skill:magi <rest>` where `<rest>` is sliced from the RAW text (original case/content).
    - natural language (standalone `magi` + positive marker, no governing negation, not a question) → transform into `/skill:magi <raw trimmed>` (full original preserved).
    - non-interactive mode: only when a Magi activation intent was detected → `{ action: "handled", message: "[magi] Non-interactive Pi sessions do not run Magi. Open an interactive Pi session and use /magi <goal>." }`; ordinary text in non-tui modes → `{ action: "continue" }`.
    - `source === "extension"` → always `{ action: "continue" }` (no recursion).

- [ ] **Step 1: Write the failing tests**

Append to `test/pi-adapter.test.mjs`:

```js
import {
  detectActivation, MAGI_COMMAND, SKILL_COMMAND, buildSkillInvocation, injectionOptions, isInteractiveHost,
} from "../adapters/pi/lib/activation.js"

const interactive = { source: "interactive", mode: "tui" }

test("extension exports the slash commands", () => {
  assert.equal(MAGI_COMMAND, "/magi")
  assert.equal(SKILL_COMMAND, "skill:magi")
})

test("isInteractiveHost keys off mode tui", () => {
  assert.equal(isInteractiveHost({ mode: "tui" }), true)
  assert.equal(isInteractiveHost({ mode: "rpc" }), false)
  assert.equal(isInteractiveHost({ mode: "json" }), false)
  assert.equal(isInteractiveHost({ mode: "print" }), false)
})

test("buildSkillInvocation preserves the full goal including case", () => {
  assert.equal(buildSkillInvocation("  Fix The Tests  "), "/skill:magi Fix The Tests")
})

test("injectionOptions expands templates and follows up only while streaming", () => {
  assert.deepEqual(injectionOptions(true), { expandPromptTemplates: true, deliverAs: "followUp" })
  assert.deepEqual(injectionOptions(false), { expandPromptTemplates: true })
})

test("/magi transforms into the skill command preserving the original goal verbatim", () => {
  const result = detectActivation("/magi Fix The Login Bug", interactive)
  assert.deepEqual(result, { action: "transform", text: "/skill:magi Fix The Login Bug" })
  const empty = detectActivation("/magi", interactive)
  assert.deepEqual(empty, { action: "transform", text: "/skill:magi" })
})

test("natural-language English requests transform preserving the original request", () => {
  assert.deepEqual(detectActivation("Use Magi to debug this", interactive), {
    action: "transform",
    text: "/skill:magi Use Magi to debug this",
  })
  assert.deepEqual(detectActivation("run this with Magi", interactive), {
    action: "transform",
    text: "/skill:magi run this with Magi",
  })
  assert.deepEqual(detectActivation("start Magi on this failure", interactive).action, "transform")
  assert.deepEqual(detectActivation("debug this through Magi", interactive).action, "transform")
})

test("natural-language Chinese requests transform preserving the original", () => {
  const first = detectActivation("請使用 Magi 處理這個問題", interactive)
  assert.deepEqual(first, { action: "transform", text: "/skill:magi 請使用 Magi 處理這個問題" })
  assert.deepEqual(detectActivation("用 magi skill 來 debug", interactive).action, "transform")
})

test("informational questions do not activate", () => {
  assert.deepEqual(detectActivation("What is Magi?", interactive), { action: "continue" })
  assert.deepEqual(detectActivation("Magi 是怎麼運作的？", interactive), { action: "continue" })
})

test("incidental mentions without use/start/run markers do not activate", () => {
  assert.deepEqual(detectActivation("magi has three roles", interactive), { action: "continue" })
  assert.deepEqual(detectActivation("the magi log is at .open_magi/magi-log", interactive), { action: "continue" })
})

test("negations do not activate regardless of markers", () => {
  assert.deepEqual(detectActivation("do not use Magi", interactive), { action: "continue" })
  assert.deepEqual(detectActivation("Don't run this with Magi", interactive), { action: "continue" })
  assert.deepEqual(detectActivation("Please don't use Magi", interactive), { action: "continue" })
  assert.deepEqual(detectActivation("不要使用 Magi", interactive), { action: "continue" })
  assert.deepEqual(detectActivation("不要使用 Magi，請僅自行分析", interactive), { action: "continue" })
})

test("extension-originated input never activates", () => {
  assert.deepEqual(detectActivation("Use Magi to debug this", { source: "extension", mode: "tui" }), { action: "continue" })
})

test("non-interactive mode rejects only Magi intent, ordinary input passes", () => {
  const denied = detectActivation("/magi fix login", { source: "interactive", mode: "json" })
  assert.deepEqual(denied, {
    action: "handled",
    message: "[magi] Non-interactive Pi sessions do not run Magi. Open an interactive Pi session and use /magi <goal>.",
  })
  assert.deepEqual(detectActivation("/magi fix login", { source: "interactive", mode: "print" }).action, "handled")
  assert.deepEqual(detectActivation("plain experimental question", { source: "interactive", mode: "json" }), { action: "continue" })
  assert.deepEqual(detectActivation("fix the tests", { source: "interactive", mode: "rpc" }), { action: "continue" })
})
```

- [ ] **Step 2: RED**

Run: `node --test test/pi-adapter.test.mjs`
Expected: FAIL — `ERR_MODULE_NOT_FOUND .../activation.js`.

- [ ] **Step 3: Implement `adapters/pi/lib/activation.js` (complete file)**

```js
export const MAGI_COMMAND = "/magi"
export const SKILL_COMMAND = "skill:magi"

const USE_MARKERS = [
  "use magi",
  "use the magi",
  "run with magi",
  "run this with magi",
  "start magi",
  "start with magi",
  "through magi",
  "magi skill",
  "\u8acb\u4f7f\u7528 magi",
  "\u8acb\u4f7f\u7528\uff0cmagi",
  "\u7528 magi skill",
  "\u4f7f\u7528 magi",
]

const NEGATION_MARKERS = [
  "do not use magi",
  "don't use magi",
  "do not run",
  "don't run",
  "no magi",
  "without magi",
  "\u4e0d\u8981\u4f7f\u7528 magi",
  "\u4e0d\u7528 magi",
  "\u52ff\u7528 magi",
  "\u4e0d\u8981\u57f7\u884c magi",
]

const QUESTION_SUFFIXES = ["?", "\uff1f"]

export function isInteractiveHost(context) {
  return context?.mode === "tui"
}

function normalize(text) {
  return String(text ?? "").trim().toLowerCase()
}

function containsStandaloneMagi(text) {
  return /(^|[^a-z0-9])magi([^a-z0-9]|$)/.test(text)
}

function hasPositiveMarker(text) {
  return USE_MARKERS.some((marker) => text.includes(marker))
}

function hasGoverningNegation(text) {
  return NEGATION_MARKERS.some((marker) => text.includes(marker))
}

function isQuestionText(text) {
  return QUESTION_SUFFIXES.some((suffix) => text.endsWith(suffix))
}

const NON_INTERACTIVE_MESSAGE =
  "[magi] Non-interactive Pi sessions do not run Magi. Open an interactive Pi session and use /magi <goal>."

function magiIntent(rawText, source) {
  if (source === "extension") return null
  const normalized = normalize(rawText)
  if (normalized === MAGI_COMMAND || normalized.startsWith(`${MAGI_COMMAND} `)) {
    return { kind: "slash" }
  }
  if (!containsStandaloneMagi(normalized)) return null
  if (hasGoverningNegation(normalized)) return null
  if (isQuestionText(normalized)) return null
  if (!hasPositiveMarker(normalized)) return null
  return { kind: "natural" }
}

export function detectActivation(rawText, context) {
  const source = context?.source ?? "interactive"
  const intent = magiIntent(rawText, source)
  if (!intent) return { action: "continue" }
  if (!isInteractiveHost(context)) {
    return { action: "handled", message: NON_INTERACTIVE_MESSAGE }
  }
  if (intent.kind === "slash") {
    const raw = String(rawText ?? "").trimStart()
    const rest = raw === MAGI_COMMAND ? "" : raw.slice(MAGI_COMMAND.length + 1)
    return { action: "transform", text: buildSkillInvocation(rest) }
  }
  return { action: "transform", text: buildSkillInvocation(String(rawText ?? "").trim()) }
}

export function buildSkillInvocation(goal) {
  const trimmed = String(goal ?? "").trim()
  return trimmed ? `/${SKILL_COMMAND} ${trimmed}` : `/${SKILL_COMMAND}`
}

export function injectionOptions(isStreaming) {
  return isStreaming ? { expandPromptTemplates: true, deliverAs: "followUp" } : { expandPromptTemplates: true }
}
```

- [ ] **Step 4: GREEN**

Run: `node --test test/pi-adapter.test.mjs`
Expected: PASS (all tasks so far).

- [ ] **Step 5: Commit**

```bash
git add adapters/pi/lib/activation.js test/pi-adapter.test.mjs
git commit -m "feat(pi): add activation routing with transform-based skill invocation"
```

---

### Task 4: Model configuration — `adapters/pi/lib/config.js`

**Files:**
- Create: `adapters/pi/lib/config.js`
- Test: `test/pi-adapter.test.mjs` (append)

**Interfaces:**
- Consumes: nothing from Pi directly; the extension injects the host's `getAgentDir`/`CONFIG_DIR_NAME` via `createModelConfigApi`.
- Produces:
  - `createModelConfigApi({ getAgentDir, CONFIG_DIR_NAME, fsImpl? })` → bound API object:
    - `userModelConfigPath(): string`
    - `projectModelConfigPath(projectRoot: string): string`
    - `loadModelConfig({ projectRoot, isProjectTrusted })` → `{ ok: true, user, project, projectRead } | { ok: false, error }`
    - `resolveRoleModels(mainModel, mainThinking, userConfig, projectConfig)` → `{ melchior, balthasar, casper }` entries `{ model, thinking: Level }`
    - `writeModelConfig(targetPath, next, { scope })` — atomic sibling-temp + rename, parent mkdir, `0600` for user scope
    - `parseModelSelector(selector)` → `{ model, thinking: Level | null }`
  - Standalone: `validateModelConfig(config)` → `null | string` (error message); `ROLE_NAMES`, `MODEL_CONFIG_VERSION = 1`, `MODEL_CONFIG_FILE = "open-magi.json"`.
- Semantics (spec): absent files → all roles inherit main model+thinking; user override before trusted project override; untrusted project file is not read (no filesystem read call); any invalid entry invalidates the whole file (`loadModelConfig` returns `ok: false`).

- [ ] **Step 1: Write the failing tests**

Append to `test/pi-adapter.test.mjs`:

```js
import {
  createModelConfigApi, validateModelConfig, ROLE_NAMES, MODEL_CONFIG_FILE,
} from "../adapters/pi/lib/config.js"
import { mkdtemp, readFile, writeFile, mkdir, chmod, stat } from "node:fs/promises"
import { tmpdir } from "node:os"

const realFs = {
  readFileImpl: async (path) => readFile(path, "utf8"),
}

function agentApiFor(agentDir, configDir = ".pi") {
  return createModelConfigApi({ getAgentDir: () => agentDir, CONFIG_DIR_NAME: configDir })
}

test("user config path derives from getAgentDir including PI_CODING_AGENT_DIR-style overrides", () => {
  const api = agentApiFor("/tmp/agentdir")
  assert.equal(api.userModelConfigPath(), "/tmp/agentdir/open-magi.json")
  const envApi = createModelConfigApi({ getAgentDir: () => process.env.PI_CODING_AGENT_DIR || "/default/agentdir", CONFIG_DIR_NAME: ".pi" })
  const previous = process.env.PI_CODING_AGENT_DIR
  process.env.PI_CODING_AGENT_DIR = "/tmp/pi-alt"
  try {
    assert.equal(envApi.userModelConfigPath(), "/tmp/pi-alt/open-magi.json")
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = previous
  }
})

test("project config path uses CONFIG_DIR_NAME, not a hardcoded .pi", () => {
  assert.equal(agentApiFor("/x", ".pi").projectModelConfigPath("/proj"), "/proj/.pi/open-magi.json")
  assert.equal(agentApiFor("/x", ".otherpi").projectModelConfigPath("/proj"), "/proj/.otherpi/open-magi.json")
})

test("parseModelSelector splits thinking suffix", () => {
  assert.deepEqual(createModelConfigApi({}).parseModelSelector("provider/model:high"), { model: "provider/model", thinking: "high" })
  assert.deepEqual(createModelConfigApi({}).parseModelSelector("provider/model"), { model: "provider/model", thinking: null })
})

test("absent files inherit the main model and thinking", async () => {
  const api = agentApiFor("/tmp/nonexistent-agentdir")
  const config = await api.loadModelConfig({ projectRoot: "/proj", isProjectTrusted: true })
  assert.equal(config.ok, true)
  assert.equal(config.user, null)
  assert.equal(config.project, null)
  assert.equal(config.projectRead, false)
  const resolved = api.resolveRoleModels("main/model", "low", config.user, config.project)
  assert.deepEqual(resolved.melchior, { model: "main/model", thinking: "low" })
  assert.deepEqual(resolved.balthasar, { model: "main/model", thinking: "low" })
})

test("user and trusted-project overrides resolve per role; untrusted project is never read", async () => {
  const tmpUser = await mkdtemp(join(tmpdir(), "magi-cfg-user-"))
  const tmpProject = await mkdtemp(join(tmpdir(), "magi-cfg-proj-"))
  const userFile = join(tmpUser, MODEL_CONFIG_FILE)
  const projectFile = join(tmpProject, ".pi", MODEL_CONFIG_FILE)
  await mkdir(join(tmpProject, ".pi"), { recursive: true })
  await writeFile(userFile, JSON.stringify({ version: 1, models: { melchior: "user/provider/model:high" } }), "utf8")
  await writeFile(projectFile, JSON.stringify({ version: 1, models: { melchior: "proj/model:low", casper: "proj/casper:low" } }), "utf8")

  let projectReadCount = 0
  const api = createModelConfigApi({
    getAgentDir: () => tmpUser,
    CONFIG_DIR_NAME: ".pi",
    readFileImpl: async (path) => {
      if (String(path).startsWith(tmpProject)) {
        projectReadCount += 1
      }
      return readFile(path, "utf8")
    },
  })
  const root = tmpProject
  // Root override: point the project path at tmpProject via projectRoot.
  const config = await api.loadModelConfig({ projectRoot: tmpProject, isProjectTrusted: true })
  assert.equal(config.ok, true)
  assert.equal(config.projectRead, true)
  const resolved = api.resolveRoleModels("main/model", "low", config.user, config.project)
  assert.deepEqual(resolved.melchior, { model: "proj/model", thinking: "low" })
  assert.deepEqual(resolved.casper, { model: "proj/casper", thinking: "low" })
  assert.deepEqual(resolved.balthasar, { model: "main/model", thinking: "low" })
  assert.ok(projectReadCount >= 1)

  // Untrusted: project file is not read.
  let untrustedReads = 0
  const untrustedApi = createModelConfigApi({
    getAgentDir: () => tmpUser,
    CONFIG_DIR_NAME: ".pi",
    readFileImpl: async (path) => {
      if (String(path).startsWith(tmpProject)) untrustedReads += 1
      return readFile(path, "utf8")
    },
  })
  const untrusted = await untrustedApi.loadModelConfig({ projectRoot: tmpProject, isProjectTrusted: false })
  assert.equal(untrusted.ok, true)
  assert.equal(untrusted.project, null)
  assert.equal(untrusted.projectRead, false)
  assert.equal(untrustedReads, 0)

  // Trusted user file alone still resolves melchior from the user scope.
  const userOnly = await api.loadModelConfig({ projectRoot: join(tmpProject, "missing"), isProjectTrusted: true })
  assert.equal(userOnly.ok, true)
  const userResolved = api.resolveRoleModels("main/model", "low", userOnly.user, userOnly.project)
  assert.deepEqual(userResolved.melchior, { model: "user/provider/model", thinking: "high" })
})

test("malformed configuration fails closed wholesale", async () => {
  const tmpUser = await mkdtemp(join(tmpdir(), "magi-cfg-bad-"))
  const badCases = [
    '{"version":2,"models":{}}',
    '{"version":1,"models":{"nemo":"p/m"}}',
    '{"version":1,"models":{"melchior":""}}',
    '{"version":1,"models":{"melchior":"p/m"},"extra":true}',
    "not json",
    '{"version":1}',
  ]
  for (const [index, raw] of badCases.entries()) {
    const userFile = join(tmpUser, MODEL_CONFIG_FILE)
    await writeFile(userFile, raw, "utf8")
    const api = agentApiFor(tmpUser)
    const config = await api.loadModelConfig({ projectRoot: "/proj", isProjectTrusted: false })
    assert.equal(config.ok, false, `case ${index} must fail closed`)
    assert.ok(config.error.startsWith("[magi]"))
  }
})

test("validateModelConfig rejects unknown roles, unknown keys, wrong versions and empty values", () => {
  assert.equal(validateModelConfig({ version: 1, models: {} }), null)
  assert.equal(validateModelConfig(null), null)
  assert.match(validateModelConfig({ version: 2, models: {} }), /version/)
  assert.match(validateModelConfig({ version: 1, models: { nemo: "p/m" } }), /Unknown role/)
  assert.match(validateModelConfig({ version: 1, models: { melchior: "p/m" }, extra: 1 }), /Unknown top-level/)
  assert.match(validateModelConfig({ version: 1, models: { melchior: "" } }), /non-empty/)
  assert.match(validateModelConfig({ version: 1, models: { melchior: 42 } }), /non-empty/)
})

test("writeModelConfig uses a sibling temp, creates the parent, atomic renames, and applies 0600 for user scope", async () => {
  const tmpUser = await mkdtemp(join(tmpdir(), "magi-cfg-w-"))
  const api = agentApiFor(tmpUser)
  const target = join(tmpUser, MODEL_CONFIG_FILE)
  await api.writeModelConfig(target, { version: 1, models: { melchior: "a/b:low" } }, { scope: "user" })
  const onDisk = JSON.parse(await readFile(target, "utf8"))
  assert.deepEqual(onDisk, { version: 1, models: { melchior: "a/b:low" } })
  if (process.platform !== "win32") {
    const info = await stat(target)
    assert.equal(String(info.mode & 0o777), "600")
  }
  assert.ok(!readFile(join(dirname(target), ".tmp"), "utf8").catch(() => false))

  // Project scope keeps ordinary modes and preserves unmodified roles; clears removed roles.
  const target2 = join(tmpUser, "nested", MODEL_CONFIG_FILE)
  await mkdir(dirname(target2), { recursive: true })
  await writeFile(target2, JSON.stringify({ version: 1, models: { melchior: "x/y", balthasar: "p/q", casper: "r/s" } }), "utf8")
  await api.writeModelConfig(target2, { version: 1, models: { melchior: "x/z" } }, { scope: "project" })
  const merged = JSON.parse(await readFile(target2, "utf8"))
  assert.deepEqual(merged, { version: 1, models: { melchior: "x/z" } })
})
```

(One-shot note for the worker: the last test needs `dirname` imported from `node:path` — add it to the test file's import list when concatenating.)

- [ ] **Step 2: RED**

Run: `node --test test/pi-adapter.test.mjs`
Expected: FAIL — `ERR_MODULE_NOT_FOUND .../config.js`.

- [ ] **Step 3: Implement `adapters/pi/lib/config.js` (complete file)**

```js
import { join, dirname } from "node:path"
import { readFile, writeFile, rename, chmod } from "node:fs/promises"

export const ROLE_NAMES = ["melchior", "balthasar", "casper"]
export const MODEL_CONFIG_VERSION = 1
export const MODEL_CONFIG_FILE = "open-magi.json"

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"])

export function validateModelConfig(config) {
  if (config == null) return null
  if (typeof config !== "object" || Array.isArray(config)) {
    return "[magi] open-magi.json must be an object"
  }
  if (config.version !== MODEL_CONFIG_VERSION) {
    return `[magi] Unsupported open-magi.json version: ${JSON.stringify(config.version ?? null)}`
  }
  if (config.models == null || typeof config.models !== "object" || Array.isArray(config.models)) {
    return "[magi] open-magi.json must contain a models object"
  }
  for (const key of Object.keys(config)) {
    if (key !== "version" && key !== "models") return `[magi] Unknown top-level key in open-magi.json: ${key}`
  }
  const known = new Set(ROLE_NAMES)
  for (const key of Object.keys(config.models)) {
    if (!known.has(key)) return `[magi] Unknown role: ${key}`
    const value = config.models[key]
    if (typeof value !== "string" || !value.trim()) {
      return `[magi] Role must be a non-empty model selector: ${key}`
    }
  }
  return null
}

export function parseModelSelectorWithOptions(selector) {
  return parseModelSelector(selector)
}

export function parseModelSelector(selector) {
  const value = String(selector ?? "").trim()
  const colon = value.lastIndexOf(":")
  if (colon > 0) {
    const maybe = value.slice(colon + 1)
    if (THINKING_LEVELS.has(maybe)) return { model: value.slice(0, colon), thinking: maybe }
  }
  return { model: value, thinking: null }
}

export function resolveRoleModels(mainModel, mainThinking, userConfig, projectConfig) {
  const result = {}
  const main = { model: mainModel, thinking: mainThinking ?? "medium" }
  for (const role of ROLE_NAMES) {
    let chosen = main
    const userSelector = parseModelSelector(userConfig?.models?.[role] ?? "")
    if (userSelector.model) chosen = userSelector
    const projectSelector = parseModelSelector(projectConfig?.models?.[role] ?? "")
    if (projectSelector.model) chosen = projectSelector
    result[role] = { model: chosen.model, thinking: chosen.thinking ?? main.thinking }
  }
  return result
}

export function createModelConfigApi({ getAgentDir, CONFIG_DIR_NAME, readFileImpl = readFile, writeFileImpl = writeFile, chmodImpl = chmod, renameImpl = rename } = {}) {
  const userModelConfigPath = () => join(getAgentDir(), MODEL_CONFIG_FILE)
  const projectModelConfigPath = (projectRoot) => join(projectRoot, CONFIG_DIR_NAME, MODEL_CONFIG_FILE)

  async function loadFile(path) {
    let text
    try {
      text = await readFileImpl(path, "utf8")
    } catch (error) {
      if (error?.code === "ENOENT") return null
      throw Object.assign(new Error(`[magi] Failed to read open-magi.json at ${path}: ${error?.message || error}`), { code: error?.code || "EACCES" })
    }
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      throw new Error(`[magi] Malformed JSON in open-magi.json at ${path}`)
    }
    const invalid = validateModelConfig(parsed)
    if (invalid) throw new Error(invalid)
    return parsed
  }

  async function loadModelConfig({ projectRoot, isProjectTrusted }) {
    let user
    try {
      user = await loadFile(userModelConfigPath())
    } catch (error) {
      return { ok: false, error: error.message }
    }
    if (!isProjectTrusted) {
      return { ok: true, user, project: null, projectRead: false }
    }
    let project
    try {
      project = await loadFile(projectModelConfigPath(projectRoot))
    } catch (error) {
      if (error.code === "ENOENT") {
        return { ok: true, user, project: null, projectRead: false }
      }
      return { ok: false, error: `${error.message} at ${projectModelConfigPath(projectRoot)}` }
    }
    return { ok: true, user, project, projectRead: true }
  }

  async function writeModelConfig(targetPath, next, { scope = "project" } = {}) {
    const invalid = validateModelConfig(next)
    if (invalid) throw new Error(invalid)
    const parent = dirname(targetPath)
    const tempFile = join(parent, `${MODEL_CONFIG_FILE}.tmp`)
    try {
      await import("node:fs/promises").then((mod) => mod.mkdir(parent, { recursive: true }))
      await writeFileImpl(tempFile, `${JSON.stringify(next, null, 2)}\n`, "utf8")
      await renameImpl(tempFile, targetPath)
      if (scope === "user") await chmodImpl(targetPath, 0o600)
    } catch (error) {
      try { await import("node:fs/promises").then((mod) => mod.rm(tempFile, { force: true })) } catch { /* already gone */ }
      throw new Error(`[magi] Failed to write ${scope} configuration at ${targetPath}: ${error?.message || error}`)
    }
  }

  return { userModelConfigPath, projectModelConfigPath, loadModelConfig, resolveRoleModels, writeModelConfig, parseModelSelector }
}
```

- [ ] **Step 4: GREEN**

Run: `node --test test/pi-adapter.test.mjs`
Expected: PASS (all tasks so far).

- [ ] **Step 5: Commit**

```bash
git add adapters/pi/lib/config.js test/pi-adapter.test.mjs
git commit -m "feat(pi): add strict schema-1 model override resolution with injected host paths"
```

---

### Task 5: Guard classification and phase guard — `adapters/pi/lib/controller.js` (part 1)

**Files:**
- Create: `adapters/pi/lib/controller.js`
- Test: `test/pi-adapter.test.mjs` (append)

**Interfaces:**
- Consumes: nothing (pure module; state objects and Pi tool-info lists passed in).
- Produces (used by Task 7 tool, Task 8 lifecycle, Task 9):
  - `LOG_DIR = ".open_magi/magi-log"`
  - `isHerdrActive(env = process.env)` → `env.HERDR_ENV === "1"`
  - `TRANSPORT_MISMATCH_ERROR = "[magi] transport mismatch: HERDR_ENV=1 keeps the Herdr contract authoritative; the native Pi council cannot run."`
  - `READ_ONLY_TOOLS = ["read", "grep", "find", "ls"]`, `GUARDED_TOOLS = ["write", "edit", "bash", "powershell"]`
  - `classifyGuardTools(toolInfos, activeToolNames)` → `{ builtinsActive, unknown, readOnly, guarded, blocked }` (builtin iff `sourceInfo.source === "builtin"`; set = `getActiveTools()` ∩ builtins)
  - `guardDiagnostic(unknownBuiltin)` → fail-closed activation/dispatch message
  - `enforcePhaseGuard({ state, projectRoot, toolName, toolInput, existsImpl? })` → `{ block: boolean, reason?: string }`
  - `shellMutationTargetsProject(cwd, command, shellFamily)` (exported for tests)
- Shared constants also defined here (Tasks 8/9 consume): `PHASE_RANK`, `phaseAtLeast(phase, target)`, `positiveInteger(value, fallback)`, `pad3(value)`, `isTerminalPhase(phase)`, `roundNumberOf/reconPassNumberOf/deliberationPassNumberOf/maxDeliberationPassesOf(state)`, `DEFAULT_DELIBERATOR_TIMEOUT_MS = 30*60*1000`, `HARD_MAX_DELIBERATOR_TIMEOUT_MS = 60*60*1000`, `deliberatorTimeoutMsOf(state)`.

- [ ] **Step 1: Write the failing tests**

```js
import {
  isHerdrActive, TRANSPORT_MISMATCH_ERROR, READ_ONLY_TOOLS, GUARDED_TOOLS,
  classifyGuardTools, guardDiagnostic, enforcePhaseGuard, shellMutationTargetsProject,
  positiveInteger, deliberatorTimeoutMsOf,
} from "../adapters/pi/lib/controller.js"

const builtinInfo = (name, source = "builtin") => ({ name, sourceInfo: { source } })

test("transport gate keys off HERDR_ENV exactly", () => {
  assert.equal(isHerdrActive({ HERDR_ENV: "1" }), true)
  assert.equal(isHerdrActive({ HERDR_ENV: "0" }), false)
  assert.equal(isHerdrActive({}), false)
  assert.match(TRANSPORT_MISMATCH_ERROR, /transport mismatch/)
})

test("guard set is getActiveTools intersect builtins by provenance; SDK/extension tools are never builtins", () => {
  const toolInfos = [
    builtinInfo("read"), builtinInfo("bash"), builtinInfo("write"),
    builtinInfo("my_sdk_tool", "sdk"), builtinInfo("ext_tool", "package"),
  ]
  const result = classifyGuardTools(toolInfos, ["read", "bash", "write", "my_sdk_tool", "ext_tool"])
  assert.deepEqual([...result.builtinsActive].sort(), ["bash", "read", "write"])
  assert.deepEqual([...result.readOnly].sort(), ["read"])
  assert.deepEqual([...result.guarded].sort(), ["bash", "write"])
  assert.equal(result.guarded.includes("my_sdk_tool"), false)
  assert.equal(result.blocked, false)
})

test("unclassified active builtin fails closed with a diagnostic", () => {
  const result = classifyGuardTools([builtinInfo("read"), builtinInfo("todo")], ["read", "todo"])
  assert.equal(result.blocked, true)
  assert.match(guardDiagnostic(result.unknown[0]), /fails closed/)
})

test("read-only builtins classify as read-only; mutation builtins classify as guarded", () => {
  assert.deepEqual([...READ_ONLY_TOOLS].sort(), ["find", "grep", "ls", "read"])
  assert.deepEqual([...GUARDED_TOOLS].sort(), ["bash", "edit", "powershell", "write"])
})

test("code writes denied before execution; execution requires the current verdict", () => {
  const base = { active: true, currentRound: 2, currentPhase: "synthesis" }
  denied = enforcePhaseGuard({ state: base, projectRoot: "/proj", toolName: "edit", toolInput: { file_path: "/proj/src/a.js" } })
  assert.equal(denied.block, true)
  const executed = { ...base, currentPhase: "execution" }
  const allowed = enforcePhaseGuard({
    state: executed, projectRoot: "/proj", toolName: "edit", toolInput: { file_path: "/proj/src/a.js" },
    existsImpl: (p) => p === "/proj/.open_magi/magi-log/round-002/verdict.md",
  })
  assert.equal(allowed.block, false)
  const missingVerdict = enforcePhaseGuard({
    state: executed, projectRoot: "/proj", toolName: "write", toolInput: { file_path: "/proj/src/a.js" },
    existsImpl: () => false,
  })
  assert.equal(missingVerdict.block, true)
  assert.match(missingVerdict.reason, /verdict\.md/)
})

test("magi artifact writes remain allowed", () => {
  const result = enforcePhaseGuard({
    state: { active: true, currentRound: 1, currentPhase: "research_task" },
    projectRoot: "/proj", toolName: "write",
    toolInput: { file_path: "/proj/.open_magi/magi-log/round-001/council-001/prompt.md" },
  })
  assert.equal(result.block, false)
})

test("posix redirect grammar judges bash commands", () => {
  assert.equal(shellMutationTargetsProject("/proj", "echo hi > /proj/src/a.js", "bash"), true)
  assert.equal(shellMutationTargetsProject("/proj", "echo notes > /proj/notes.md", "bash"), false)
  assert.equal(shellMutationTargetsProject("/proj", "sed -i 's/a/b/' /proj/src/a.js", "bash"), true)
  assert.equal(shellMutationTargetsProject("/proj", "echo stale | tee /proj/src/a.js", "bash"), true)
  assert.equal(shellMutationTargetsProject("/proj", "npm test", "bash"), false)
  assert.equal(shellMutationTargetsProject("/proj", "pnpm --version > /proj/magi-build.log", "bash"), false)
})

test("powershell targets obey PowerShell syntax, never the POSIX parser by accident", () => {
  assert.equal(shellMutationTargetsProject("/proj", "Set-Content -Path /proj/src/a.js -Value hi", "powershell"), true)
  assert.equal(shellMutationTargetsProject("/proj", "Get-Content /proj/src/a.js | Out-File /proj/src/other.js", "powershell"), true)
  assert.equal(shellMutationTargetsProject("/proj", "'hi' > /proj/src/a.js", "powershell"), true)
  assert.equal(shellMutationTargetsProject("/proj", "'notes' > /proj/notes.md", "powershell"), false)
  assert.equal(shellMutationTargetsProject("/proj", "Remove-Item /proj/notes.md", "powershell"), true)
  assert.equal(shellMutationTargetsProject("/proj", "npm test", "powershell"), false)
})

test("deliberator timeout clamps to the shared hard maximum", () => {
  assert.equal(deliberatorTimeoutMsOf({}), 30 * 60 * 1000)
  assert.equal(deliberatorTimeoutMsOf({ deliberatorTimeoutMs: 10 }), 30 * 60 * 1000)
  assert.equal(deliberatorTimeoutMsOf({ deliberatorTimeoutMs: 10 * 60 * 1000 }), 10 * 60 * 1000)
  assert.equal(deliberatorTimeoutMsOf({ deliberatorTimeoutMs: 90 * 60 * 1000 }), 60 * 60 * 1000)
})

test("positiveInteger falls back cleanly", () => {
  assert.equal(positiveInteger("7", 3), 7)
  assert.equal(positiveInteger(0, 3), 3)
  assert.equal(positiveInteger(undefined, 3), 3)
})
```

- [ ] **Step 2: RED**

Run: `node --test test/pi-adapter.test.mjs`
Expected: FAIL — `ERR_MODULE_NOT_FOUND .../controller.js`.

- [ ] **Step 3: Write minimal implementation — `adapters/pi/lib/controller.js` (module top; Tasks 7-9 append below)**

```js
import { existsSync } from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"

export const LOG_DIR = ".open_magi/magi-log"
export const DEFAULT_DELIBERATOR_TIMEOUT_MS = 30 * 60 * 1000
export const HARD_MAX_DELIBERATOR_TIMEOUT_MS = 60 * 60 * 1000
export const DEFAULT_STALE_LOCK_MS = 30 * 60 * 1000
export const DEFAULT_MAX_DELIBERATION_PASSES = 3
export const NO_PROGRESS_LIMIT = 5

export const PHASE_RANK = {
  goal_definition: 0, status_assessment: 1, research_task: 2, parallel_deliberation: 3,
  synthesis: 4, execution: 5, goal_check: 6, cleanup: 7, completion_review: 8, complete: 9,
}

export function phaseAtLeast(phase, target) {
  return (PHASE_RANK[phase] ?? -1) >= PHASE_RANK[target]
}

export function isTerminalPhase(phase) {
  return phase === "complete" || phase === "blocked"
}

export function positiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function pad3(value) {
  return String(Math.max(positiveInteger(value, 1), 1)).padStart(3, "0")
}

export function roundPrefix(round) {
  return `${LOG_DIR}/round-${pad3(round)}`
}

export function isHerdrActive(env = process.env) {
  return env.HERDR_ENV === "1"
}

export const TRANSPORT_MISMATCH_ERROR =
  "[magi] transport mismatch: HERDR_ENV=1 keeps the Herdr contract authoritative; the native Pi council cannot run."

export const READ_ONLY_TOOLS = ["read", "grep", "find", "ls"]
export const GUARDED_TOOLS = ["write", "edit", "bash", "powershell"]

const KNOWN_CLASSIFIED_BUILTINS = new Set([...READ_ONLY_TOOLS, ...GUARDED_TOOLS])

export function classifyGuardTools(toolInfos, activeToolNames) {
  const active = new Set(activeToolNames ?? [])
  const builtinsActive = (toolInfos ?? [])
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

export function assertGuardableToolSet(toolInfos, activeToolNames) {
  const classified = classifyGuardTools(toolInfos, activeToolNames)
  if (!classified.blocked) return { ok: true }
  return { ok: false, message: guardDiagnostic(classified.unknown[0]) }
}

export function guardDiagnostic(unknownBuiltin) {
  return `[magi] unclassified active builtin tool "${unknownBuiltin}"; Magi activation fails closed. Disable the tool or extend the Magi guard before dispatch.`
}

export function deliberatorTimeoutMsOf(state) {
  return Math.min(positiveInteger(state?.deliberatorTimeoutMs, DEFAULT_DELIBERATOR_TIMEOUT_MS), HARD_MAX_DELIBERATOR_TIMEOUT_MS)
}

export function roundNumberOf(state) {
  return positiveInteger(state?.currentRound, 1)
}
export function reconPassNumberOf(state) {
  return positiveInteger(state?.currentReconPass, 1)
}
export function deliberationPassNumberOf(state) {
  return positiveInteger(state?.currentDeliberationPass, 1)
}
export function maxDeliberationPassesOf(state) {
  return Math.max(Math.min(positiveInteger(state?.maxDeliberationPasses, DEFAULT_MAX_DELIBERATION_PASSES), 5), 3)
}

const SED_INPLACE_PATTERN = /(?:^|[\s;&|])sed\s+(?:-[a-zA-Z]+\s+)*-i(?:\s|=)/
const POSIX_REDIRECT_PATTERN = /(?<![-\w])(?:\d{0,2}(?:>>|&>|>))\s*(?:"([^"]*)"|'([^']*)'|([^\s;&|]+))/g
const TEE_PATTERN = /(?:^|[\s;&|])tee\s+(?:-a\s+)?(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/g
const APPLY_PATCH_PATTERN = /(?:^|[\s;&|])apply_patch(?=[\s;&|]|$)/
const BUILD_TEST_PATTERN = /(?:^|[\s;&|])(?:npm|npx|pnpm|yarn|make|cmake|gradle|mvn|pytest|vitest|jest|cargo|go|node)\b/

const POWERSHELL_MUTATION_PATTERNS = [
  /(?:^|[\s;|])(?:Set-Content|Add-Content|Out-File|New-Item|Copy-Item|Move-Item|Clear-Content|Set-ItemProperty)(?=[\s;|]|$)/,
]
const POWERSHELL_DESTRUCTIVE_PATTERN = /(?:^|[\s;|])(?:Remove-Item|Clear-Content)(?=[\s;|]|$)/
const POWERSHELL_REDIRECT_PATTERN = /(?<![-\w])(?:\d+)?(?:>>|>)\s*(?:"([^"]*)"|'([^']*)'|([^\s;&|]+))/g

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
  return /\.(md|txt)$/i.test(String(target ?? "").trim())
}

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
    const open = heredocTag(line)
    if (open) {
      out.push(line.slice(0, line.indexOf("<<")))
      tag = open
      continue
    }
    out.push(line)
  }
  return out.join("\n")
}

function sanitizeShellText(command, shellFamily) {
  if (shellFamily === "powershell") return String(command ?? "")
  const stripped = stripHeredocs(command)
  return stripped.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""')
    .split("\n").map((line) => line.replace(/(^|\s)#.*$/, "$1")).join("\n")
}

function targetIsMutation(cwd, target) {
  return !isDocPath(target) && isProjectPath(cwd, resolve(cwd, target))
}

function isBuildTestTargetAllowed(cwd, target) {
  return isDocPath(target) || /\.log$/i.test(target) || isMagiPath(cwd, resolve(cwd, target))
}

export function shellMutationTargetsProject(cwd, command, shellFamily) {
  const family = shellFamily === "powershell" ? "powershell" : "bash"
  const text = String(command ?? "")
  if (family === "powershell") {
    const targets = allTargets(POWERSHELL_REDIRECT_PATTERN, text)
    const buildTest = BUILD_TEST_PATTERN.test(text)
    for (const target of targets) {
      if (buildTest && isBuildTestTargetAllowed(cwd, target)) continue
      if (targetIsMutation(cwd, target)) return true
    }
    for (const pattern of POWERSHELL_MUTATION_PATTERNS) {
      if (!pattern.test(text)) continue
      const destructive = POWERSHELL_DESTRUCTIVE_PATTERN.test(text)
      const paramTargets = [
        ...text.matchAll(/(?:-Path|-FilePath|-LiteralPath)\s+"?([^";|]+)"?/g),
        ...text.matchAll(/(?:Set-Content|Add-Content|Out-File|Remove-Item|New-Item|Copy-Item|Move-Item|Clear-Content|Set-ItemProperty)\s+"?([^";|\r\n]+)"?/g),
      ].map((match) => match[1])
      return paramTargets.some((target) => {
        if (!targetIsMutation(cwd, target)) return false
        return destructive || !isBuildTestTargetAllowed(cwd, target)
      })
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

const DECISION_ARTIFACT_PATTERN = /(?:^|[\s;&|'"])\.?\/?\.open_magi\/magi-log\/round-(\d{3})\/(?:council-\d{3}\/prompt\.md|verdict\.md)/

export function enforcePhaseGuard({ state, projectRoot, toolName, toolInput, existsImpl = existsSync }) {
  if (!state?.active) return { block: false }
  const cwd = projectRoot
  const fileTools = new Set(["write", "edit", "apply_patch"])
  const shellTools = new Set(["bash", "powershell"])
  const filePath = toolInput?.file_path ?? toolInput?.filePath ?? toolInput?.path
  const patchText = toolInput?.patch ?? toolInput?.content ?? (typeof toolInput?.input === "string" ? toolInput.input : null)
  const command = toolInput?.command ?? toolInput?.cmd ?? null
  const family = toolName === "powershell" ? "powershell" : "bash"

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
    const match = DECISION_ARTIFACT_PATTERN.exec(target)
    if (!match) continue
    const round = Number(match[1])
    const mode = state.currentCouncilMode === "recon" || state.currentCouncilMode === "review" ? state.currentCouncilMode : "decision"
    if (round !== roundNumberOf(state)) continue
    if (mode === "review") {
      return {
        block: true,
        reason: "[magi] A review pass is in flight; wait for the review council before writing decision artifacts or the verdict.",
      }
    }
    const pass = mode === "recon" ? reconPassNumberOf(state) : deliberationPassNumberOf(state)
    const folder = mode === "recon" ? `recon-${pad3(pass)}` : `council-${pad3(pass)}`
    const promptPath = join(cwd, LOG_DIR, `round-${pad3(round)}`, folder, "prompt.md")
    if (!existsImpl(promptPath)) continue
    const pending = [ "melchior", "balthasar", "casper" ].filter((sage) =>
      !existsImpl(join(cwd, LOG_DIR, `round-${pad3(round)}`, folder, `report-${sage}.md`)))
    if (pending.length > 0) {
      return {
        block: true,
        reason: `[magi] ${mode} pass ${pass} is in flight (waiting on ${pending.join(", ")}). Complete or supersede the pass before writing decision artifacts or the verdict.`,
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
  const verdictPath = join(cwd, LOG_DIR, `round-${pad3(roundNumberOf(state))}`, "verdict.md")
  if (!existsImpl(verdictPath)) {
    return {
      block: true,
      reason: `[magi] phase=execution but ${verdictPath} is missing. Produce the verdict through the council process before editing code.`,
    }
  }
  return { block: false }
}

function mentionedProjectPaths(text, cwd) {
  if (typeof text !== "string" || !text) return []
  return [...text.matchAll(/[^\s:'"]+\.(?:md|json|txt|js|ts|c|h|py|toml|yaml|yml)\b/g)]
    .map((match) => match[0])
    .filter((target) => targetIsMutation(cwd, target))
}
```

`targetIsMutation` and `isBuildTestTargetAllowed` must be exported for Task 8/9 consumers if referenced from other modules (module order: constants → patterns → path helpers → classify/guard → shell/phase guard → number helpers).

- [ ] **Step 4: GREEN**

Run: `node --test test/pi-adapter.test.mjs` and `node --check adapters/pi/lib/controller.js`
Expected: PASS; parser accepts the module.

- [ ] **Step 5: Commit**

```bash
git add adapters/pi/lib/controller.js test/pi-adapter.test.mjs
git commit -m "feat(pi): add builtin-provenance guard classification and two-shell phase guard"
```

---

### Task 6: Native council runner — `adapters/pi/lib/pi-runner.js`

**Files:**
- Create: `adapters/pi/lib/pi-runner.js`
- Test: `test/pi-adapter.test.mjs` (append)

**Interfaces:**
- Consumes: `DEFAULT_DELIBERATOR_TIMEOUT_MS`, `HARD_MAX_DELIBERATOR_TIMEOUT_MS`, `deliberatorTimeoutMsOf` from `./controller.js`.
- Produces:
  - `DELIBERATORS = [{ sage: "melchior" }, { sage: "balthasar" }, { sage: "casper" }]`
  - `ISOLATION_ARGS = ["--mode","json","--print","--no-session","--no-extensions","--no-skills","--no-context-files","--no-prompt-templates","--no-themes","--tools","read,grep,find,ls","--no-approve"]`
  - `resolvePiInvocation({ processArgv?, processExecPath?, existsImpl?, forcePathFallback? })` → `{ command, args }` (order mirrors Pi's official subagent example: reusable current script → packaged runtime (bun virtual / non-generic runtime binary) → `pi` from PATH last; always spawned with `shell: false`)
  - `buildChildArgs({ model, thinking })` → `[...ISOLATION_ARGS, "--model", model, "--thinking", level]` (level clamped to off|minimal|low|medium|high|xhigh|max, default medium)
  - `parseJsonlStream(stdoutText)` → `{ header, finalMessage, usage, text }`; throws `Error("invalid_json")` on unparseable lines, `Error("missing_final_response")` when no assistant `message_end` with non-empty text, and `Error("assistant_stop_reason_error"|"assistant_stop_reason_aborted")` for bad stop reasons
  - `runOnePiChild({ invocation, args, cwd, promptText, timeoutMs, signal, spawnFn? })` → process record `{ ok, piFailureType, error, exitCode, timedOut, timedOutAt, aborted, stdout, stderr, startedAtIso, endedAtIso, durationMs }` (`ok = exitCode === 0 && !timedOut && !aborted && !spawnError`; bounded stdout/stderr via `appendLimited` ≤ 20000 chars)
  - `piEnvelopeFor(processResult)` → `{ status: "ok"|"timeout"|"hard_error", failureType: "none"|"timeout"|"hard_error", nativeType: string|null, stance, blocking, risk }`
  - `reportPathForPrompt(promptPath, sage)` → `join(dirname(promptPath), report-${sage}.md)`
  - `reportBodyFor({ sage, model, processResult, stream, usage })` → report body string (`report_source: pi_json|pi_json_failed` + envelope fields + `agent:` + `model:` + usage fields + `---` + bounded `pi_diag:` on failure)
  - `writeReport({ promptPath, sage, model, processResult })` → atomic (sibling tmp + rename), parses stdout; post-close parse failures become `invalid_json` / `missing_final_response` hard errors — success is never fabricated
  - `runPiCouncil({ projectRoot, promptPath, round, pass, mode, roleModels, timeoutMs, signal, spawnLike?, runnerBin?, runnerBinArgs? })` → `{ ok, halt, haltReason, hardErrors, projectRoot, promptPath, round, pass, mode, executor: "spawn", results }` with per-result `{ sage, ok, failureType, piFailureType, exitCode, timedOut, reportPath, stderr, error }`
  - Child prompt build (per sage) = `adapters/pi/skills/magi/prompts/<sage>.md` content + council prompt + report output requirements; children receive the prompt as the last argv element; runner NEVER logs environment/secrets
- Never adds a general subagent tool; never uses `pi-subagents`; never falls back between models.

- [ ] **Step 1: Write the failing tests**

```js
mkdir test/fixtures-tmp 2>/dev/null || true
mkdir test/fixtures 2>/dev/null || true
mkdir test/fixtures/fake-bin 2>/dev/null || true
```

Create `test/fixtures/fake-pi` (committed test asset; mode 0755):

```js
#!/usr/bin/env node
const promptText = process.argv[process.argv.length - 1]
const sageMatch = /deliberator-(melchior|balthasar|casper)/.exec(promptText)
const sage = sageMatch ? sageMatch[1] : process.env.MAGI_FAKE_SAGE
const delay = Number(process.env.MAGI_FAKE_DELAY_MS ?? "0")
const fail = process.env.MAGI_FAKE_FAIL ?? "none"
const barrier = process.env.MAGI_BARRIER
if (barrier) {
  const { existsSync: barrierWait } = require("node:fs")
  const deadline = Date.now() + 10_000
  while (!barrierWait(`${barrier}-${sage}`) && Date.now() < deadline) {
    let spin = 0
    while (spin < 2000) spin += 1
  }
}
function emit() {
  if (fail === "timeout") process.exit(124)
  if (fail === "hard_error") { process.stderr.write("boom"); process.exit(3) }
  if (fail === "garbage") { process.stdout.write("this is not json line one\nnot json two\n"); process.exit(0) }
  process.stdout.write(JSON.stringify({
    type: "session", id: "fake", timestamp: new Date().toISOString(), cwd: process.cwd(),
  }) + "\n")
  process.stdout.write(JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      stopReason: "stop",
      text: `REPORT for ${sage}`,
      usage: { input: 11, output: 22, totalTokens: 33, cost: { total: 0.01 } },
    },
  }) + "\n")
}
if (delay > 0) setTimeout(emit, delay)
else emit()
```

Append to `test/pi-adapter.test.mjs`:

```js
import {
  DELIBERATORS, ISOLATION_ARGS, resolvePiInvocation, buildChildArgs, parseJsonlStream,
  runOnePiChild, piEnvelopeFor, reportPathForPrompt, writeReport, runPiCouncil,
} from "../adapters/pi/lib/pi-runner.js"
import { mkdtemp, readFile, writeFile as fsWriteFile, mkdir, stat, readdir } from "node:fs/promises"
import { statSync } from "node:fs"
import { spawn } from "node:child_process"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"

const FAKE_PI = join(repoRoot, "test", "fixtures", "fake-pi")

test("runner declares the deliberator trio and exact isolation args", () => {
  assert.deepEqual(DELIBERATORS.map((d) => d.sage), ["melchior", "balthasar", "casper"])
  assert.deepEqual(ISOLATION_ARGS.slice(0, 2), ["--mode", "json"])
  for (const flag of ["--print", "--no-session", "--no-extensions", "--no-skills", "--no-context-files", "--no-prompt-templates", "--no-themes", "--no-approve"]) {
    assert.ok(ISOLATION_ARGS.includes(flag))
  }
  const toolsIdx = ISOLATION_ARGS.indexOf("--tools")
  assert.equal(ISOLATION_ARGS[toolsIdx + 1], "read,grep,find,ls")
})

test("resolvePiInvocation reuses the current invocation and falls back last", () => {
  const reused = resolvePiInvocation({
    processArgv: ["/usr/local/bin/pi", "run"],
    processExecPath: "/usr/local/bin/pi",
    existsImpl: () => true,
  })
  assert.deepEqual(reused, { command: "/usr/local/bin/pi", args: [] })
  const nodeScript = resolvePiInvocation({
    processArgv: ["/x/node", "/y/cli.mjs"],
    processExecPath: "/x/node",
    existsImpl: () => true,
  })
  assert.deepEqual(nodeScript, { command: "/x/node", args: ["/y/cli.mjs"] })
  const fallback = resolvePiInvocation({
    processArgv: ["/x/node", "/y/cli.mjs"],
    processExecPath: "/x/node",
    existsImpl: () => false,
  })
  assert.deepEqual(fallback, { command: "pi", args: [] })
})

test("buildChildArgs clamps thinking level and appends model", () => {
  const args = buildChildArgs({ model: "p/m", thinking: "ultra" })
  assert.deepEqual(args.slice(-2), ["--model", "p/m"])
  assert.deepEqual(args.slice(-4, -2), ["--thinking", "medium"])
  assert.deepEqual(buildChildArgs({ model: "p/m", thinking: "high" }).slice(-4, -2), ["--thinking", "high"])
})

test("parseJsonlStream selects the final assistant message and its usage", () => {
  const header = JSON.stringify({ type: "session", id: "abc", timestamp: "t", cwd: "/p" })
  const first = JSON.stringify({ type: "message_end", message: { role: "assistant", stopReason: "stop", text: "draft", usage: { input: 1, output: 2 } } })
  const last = JSON.stringify({ type: "message_end", message: { role: "assistant", stopReason: "stop", text: "final", usage: { input: 10, output: 20 } } })
  const parsed = parseJsonlStream([header, first, last].join("\n"))
  assert.equal(parsed.text, "final")
  assert.equal(parsed.usage.output, 20)
  assert.throws(() => parseJsonlStream('{"type":"message_start"}'), /missing_final_response/)
  assert.throws(() => parseJsonlStream("not-json"), /invalid_json/)
})

test("runPiCouncil launches three concurrent isolated children from the captured cwd", async () => {
  const project = await mkdtemp(join(tmpdir(), "magi-pi-runner-"))
  const councilDir = join(project, ".open_magi", "magi-log", "round-001", "council-001")
  await mkdir(councilDir, { recursive: true })
  const promptPath = join(councilDir, "prompt.md")
  await fsWriteFile(promptPath, "# Council prompt", "utf8")
  for (const sage of ["melchior", "balthasar", "casper"]) {
    await fsWriteFile(join(project, "adapters", "pi", "skills", "magi", "prompts", `${sage}.md`), `You are deliberator-${sage}. Read-only.`, "utf8")
  }
  // Concurrency proof: each child blocks on its barrier file; barriers are only
  // created once ALL THREE children have spawned. If children were sequential,
  // the first child would never see its barrier and the test would time out.
  const barrierDir = await mkdtemp(join(tmpdir(), "magi-pi-barrier-"))
  const barrierDirEnv = { MAGI_BARRIER: join(barrierDir, "barrier") }
  const spawned = { cwd: [], flags: [], count: 0 }
  const spawnBarrierCreate = setTimeout(() => {
    for (const sage of ["melchior", "balthasar", "casper"]) {
      fsWriteFile(`${barrierDirEnv.MAGI_BARRIER}-${sage}`, "go", "utf8").catch(() => {})
    }
  }, 10_000)
  const results = await runPiCouncil({
    projectRoot: project,
    promptPath,
    round: 1,
    pass: 1,
    mode: "decision",
    roleModels: {
      melchior: { model: "p/m1", thinking: "high" },
      balthasar: { model: "p/m2", thinking: "low" },
      casper: { model: "p/m3", thinking: "off" },
    },
    runnerBin: FAKE_PI,
    childEnv: barrierDirEnv,
    spawnLike: (command, args, options) => {
      spawned.cwd.push(options.cwd)
      spawned.flags.push(args)
      spawned.count += 1
      return spawn(command, args, options)
    },
  })
  clearTimeout(spawnBarrierCreate)
  assert.equal(spawned.count, 3, "all three children spawned before any could complete (barrier waited for the trio)")
  assert.deepEqual([...results.results.map((r) => r.sage)].sort(), ["balthasar", "casper", "melchior"])
  assert.deepEqual([...spawned.cwd].sort(), [project, project, project])
  for (const flags of spawned.flags) {
    assert.ok(flags.includes("--no-approve"))
    assert.ok(flags.includes("read,grep,find,ls"))
    assert.ok(flags.includes("--no-session"))
  }
  assert.ok(results.ok)
  for (const result of results.results) {
    assert.equal(result.ok, true)
    assert.equal(result.failureType, null)
    const report = await readFile(join(councilDir, `report-${result.sage}.md`), "utf8")
    assert.match(report, /^report_source: pi_json$/m)
    assert.match(report, /^status: ok$/m)
    assert.match(report, /^failure_type: none$/m)
    assert.match(report, /^usage_output_tokens: 22$/m)
    assert.doesNotMatch(report, /process\.env|PATH=|credentials|api[_-]?key/i)
  }
})

test("runPiCouncil maps invalid JSON output to pi_json_failed hard_error without success mimicry", async () => {
  const project = await mkdtemp(join(tmpdir(), "magi-pi-garbage-"))
  const councilDir = join(project, ".open_magi", "magi-log", "round-003", "council-002")
  await mkdir(councilDir, { recursive: true })
  const promptPath = join(councilDir, "prompt.md")
  await fsWriteFile(promptPath, "# Council prompt", "utf8")
  for (const sage of ["melchior", "balthasar", "casper"]) {
    await fsWriteFile(join(project, "adapters", "pi", "skills", "magi", "prompts", `${sage}.md`), `You are deliberator-${sage}. Read-only.`, "utf8")
  }
  const results = await runPiCouncil({
    projectRoot: project,
    promptPath,
    round: 3,
    pass: 2,
    mode: "decision",
    roleModels: {
      melchior: { model: "p/m1", thinking: "low" },
      balthasar: { model: "p/m2", thinking: "low" },
      casper: { model: "p/m3", thinking: "low" },
    },
    runnerBin: FAKE_PI,
    runnerBinEnv: { MAGI_FAKE_FAIL: "garbage" },
  })
  assert.equal(results.halt, true)
  for (const result of results.results) {
    assert.equal(result.ok, false)
    assert.equal(result.failureType, "hard_error")
    assert.equal(result.piFailureType, "invalid_json")
    const report = await readFile(join(councilDir, `report-${result.sage}.md`), "utf8")
    assert.match(report, /^report_source: pi_json_failed$/m)
    assert.match(report, /^status: hard_error$/m)
    assert.match(report, /^pi_failure_subtype: invalid_json$/m)
    assert.match(report, /^stance: needs_evidence$/m)
    assert.doesNotMatch(report, /^status: ok$/m)
  }
})

test("timeouts, aborts, spawns, and nonzero exits map to the failure contract", async () => {
  const slowBin = join(await mkdtemp(join(tmpdir(), "magi-pi-slow-")), "slow-pi")
  await fsWriteFile(slowBin, [
    "#!/usr/bin/env node",
    "setTimeout(() => process.stdout.write('late'), 60000)",
  ].join("\n"), { mode: 0o755 })
  const crashBin = join(dirname(slowBin), "crash-pi")
  await fsWriteFile(crashBin, "process.stderr.write('boom');process.exit(3)", { mode: 0o755 })
  const slow = piEnvelopeFor(await runOnePiChild({
    invocation: { command: slowBin, args: [] },
    args: [], cwd: tmpdir(), promptText: "hi", timeoutMs: 60,
  }))
  assert.equal(slow.status, "timeout")
  assert.equal(slow.failureType, "timeout")
  assert.equal(slow.stance, "needs_evidence")
  assert.equal(slow.blocking, "yes")
  const crash = piEnvelopeFor(await runOnePiChild({
    invocation: { command: crashBin, args: [] },
    args: [], cwd: tmpdir(), promptText: "hi", timeoutMs: 5_000,
  }))
  assert.equal(crash.status, "hard_error")
  assert.equal(crash.nativeType, "nonzero_exit")
  const abortController = new AbortController()
  const abortBin = join(dirname(slowBin), "hang-pi")
  await fsWriteFile(abortBin, "setInterval(() => {}, 1000)", { mode: 0o755 })
  const abortPromise = runOnePiChild({
    invocation: { command: abortBin, args: [] },
    args: [], cwd: tmpdir(), promptText: "hi", timeoutMs: 60_000, signal: abortController.signal,
  })
  setTimeout(() => abortController.abort(), 50)
  const aborted = piEnvelopeFor(await abortPromise)
  assert.equal(aborted.nativeType, "aborted")
  assert.equal(aborted.failureType, "hard_error")
  const spawnFail = piEnvelopeFor(await runOnePiChild({
    invocation: { command: join(tmpdir(), "definitely-missing-pi"), args: [] },
    args: [], cwd: tmpdir(), promptText: "hi", timeoutMs: 5_000,
  }))
  assert.equal(spawnFail.nativeType, "spawn_error")
})
```

- [ ] **Step 2: RED**

Run: `node --test test/pi-adapter.test.mjs`
Expected: FAIL — `ERR_MODULE_NOT_FOUND .../pi-runner.js`.

- [ ] **Step 3: Write minimal implementation — `adapters/pi/lib/pi-runner.js`**

```js
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, readFile, rename, rm, chmod, stat as fsStat } from "node:fs/promises"
import { dirname, join } from "node:path"
import { DEFAULT_DELIBERATOR_TIMEOUT_MS, HARD_MAX_DELIBERATOR_TIMEOUT_MS } from "./controller.js"

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
]

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"])
function normalizeThinking(level) {
  return THINKING_LEVELS.has(level) ? level : "medium"
}

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
  const execName = String(execPath.split(/[\\/]/).pop() ?? "").toLowerCase()
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName)
  if (!isGenericRuntime) return { command: execPath, args: [] }
  return { command: "pi", args: [] }
}

export function buildChildArgs({ model, thinking }) {
  return [...ISOLATION_ARGS, "--model", String(model), "--thinking", normalizeThinking(thinking)]
}

export function parseJsonlStream(stdoutText) {
  const lines = String(stdoutText ?? "").split("\n").filter((line) => line.trim())
  let header = null
  let finalMessage = null
  let usage = null
  for (const line of lines) {
    let event
    try {
      event = JSON.parse(line)
    } catch {
      throw new Error("invalid_json")
    }
    if (event?.type === "session" && !header) header = event
    if (event?.type === "message_end" && event?.message?.role === "assistant") {
      finalMessage = event.message
      usage = event.message?.usage ?? usage
    }
  }
  if (!finalMessage) throw new Error("missing_final_response")
  const stopReason = finalMessage?.stopReason
  if (stopReason === "error" || stopReason === "aborted") {
    throw new Error(`assistant_stop_reason_${stopReason}`)
  }
  const text = Array.isArray(finalMessage?.content)
    ? finalMessage.content.filter((part) => part?.type === "text" && typeof part?.text === "string").map((part) => part.text).join("\n")
    : String(finalMessage?.text ?? "")
  if (!text.trim()) throw new Error("missing_final_response")
  return { header, finalMessage, usage, text }
}

function clampTimeout(timeoutMs) {
  const value = Number(timeoutMs)
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_DELIBERATOR_TIMEOUT_MS
  return Math.min(value, HARD_MAX_DELIBERATOR_TIMEOUT_MS)
}

const MAX_STREAM_BUFFER_CHARS = 20_000
function appendLimited(current, chunk) {
  const next = current === "" ? String(chunk) : current + String(chunk)
  return next.length > MAX_STREAM_BUFFER_CHARS ? next.slice(-MAX_STREAM_BUFFER_CHARS) : next
}

export function runOnePiChild({ invocation, args, cwd, promptText, timeoutMs, signal, childEnv, onChild, spawnFn = spawn }) {
  return new Promise((resolveRun) => {
    let child
    try {
      child = spawnFn(invocation.command, [...invocation.args, ...args, promptText], {
        cwd,
        env: childEnv ? { ...process.env, ...childEnv } : undefined,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      })
      onChild?.(child)
    } catch (spawnError) {
      return resolveRun(processRecord({ ok: false, piFailureType: "spawn_error", spawnErrorMsg: String(spawnError?.message ?? spawnError) }))
    }
    const record = { ok: false, piFailureType: null, error: null, timedOut: false, timedOutAt: null, aborted: false, stdout: "", stderr: "" }
    let settled = false
    let exitCode = null
    const startedAt = Date.now()
    const finalize = (overrides = {}) => {
      if (settled) return
      settled = true
      resolveRun(processRecord({ ...record, exitCode, ...overrides, durationMs: Date.now() - startedAt }))
    }
    child.stdout?.on("data", (chunk) => { record.stdout = appendLimited(record.stdout, chunk) })
    child.stderr?.on("data", (chunk) => { record.stderr = appendLimited(record.stderr, chunk) })
    child.on("error", (error) => {
      finalize({ ok: false, piFailureType: "spawn_error", error: String(error?.message ?? error) })
    })
    child.on("close", (code) => {
      exitCode = code
      if (record.timedOut) return
      if (record.aborted) return finalize({ ok: false, piFailureType: "aborted" })
      finalize({ ok: code === 0, piFailureType: code === 0 ? null : "nonzero_exit" })
    })
    const escalate = () => {
      try { child.kill("SIGTERM") } catch { /* already gone */ }
      const killer = setTimeout(() => { try { child.kill("SIGKILL") } catch { /* already gone */ } }, 5_000)
      if (typeof killer.unref === "function") killer.unref()
    }
    const timer = setTimeout(() => {
      record.timedOut = true
      record.timedOutAt = new Date().toISOString()
      finalize({ ok: false, piFailureType: "timeout" })
      escalate()
    }, clampTimeout(timeoutMs))
    if (typeof timer.unref === "function") timer.unref()
    signal?.addEventListener("abort", () => {
      if (settled) return
      record.aborted = true
      finalize({ ok: false, piFailureType: "aborted" })
      escalate()
    }, { once: true })
  })
}

function processRecord({ ok, piFailureType, error, exitCode = null, timedOut = false, timedOutAt = null, aborted = false, stdout = "", stderr = "", durationMs = 0, spawnErrorMsg = null }) {
  return {
    ok, piFailureType, error: error ?? spawnErrorMsg, exitCode, timedOut, timedOutAt, aborted: false,
    stdout, stderr, startedAtIso: new Date().toISOString(), endedAtIso: new Date().toISOString(), durationMs,
  }
}

export function piEnvelopeFor(processResult) {
  if (processResult.ok) return { status: "ok", failureType: "none", nativeType: null, stance: null, blocking: null, risk: null }
  if (processResult.timedOut) return { status: "timeout", failureType: "timeout", nativeType: "timeout", stance: "needs_evidence", blocking: "yes", risk: "medium" }
  const nativeType = processResult.piFailureType
    ?? (processResult.aborted ? "aborted" : processResult.exitCode !== null && processResult.exitCode !== 0 ? "nonzero_exit" : "spawn_error")
  return { status: "hard_error", failureType: "hard_error", nativeType, stance: "needs_evidence", blocking: "yes", risk: "high" }
}

export function reportPathForPrompt(promptPath, sage) {
  return join(dirname(promptPath), `report-${sage}.md`)
}

export function reportBodyFor({ sage, model, processResult, stream, usage }) {
  const envelope = piEnvelopeFor(processResult)
  const success = envelope.status === "ok"
  const body = [`report_source: ${success ? "pi_json" : "pi_json_failed"}`, `status: ${envelope.status}`]
  if (!success) {
    body.push(`stance: ${envelope.stance}`, `blocking_objection: ${envelope.blocking}`, `risk_level: ${envelope.risk}`)
  }
  body.push(
    `failure_type: ${envelope.failureType}`,
    `agent: deliberator-${sage}`,
    `model: ${model}`,
    `pi_failure_subtype: ${envelope.nativeType ?? "none"}`,
    `pi_exit_code: ${processResult.exitCode ?? "null"}`,
    `pi_timed_out: ${processResult.timedOut ? "true" : "false"}`,
    `pi_started_at: ${processResult.startedAtIso}`,
    `pi_ended_at: ${processResult.endedAtIso}`,
    `pi_duration_ms: ${processResult.durationMs}`,
  )
  if (usage) body.push(`usage_input_tokens: ${usage.input ?? "unknown"}`, `usage_output_tokens: ${usage.output ?? "unknown"}`)
  body.push("---")
  if (success) body.push(String(stream?.text ?? "").trim(), "")
  else body.push(`pi_diag: ${envelope.nativeType}: ${boundedDiagnostics(processResult?.stderr ?? processResult?.error ?? "")}`, "")
  return body.join("\n")
}

function boundedDiagnostics(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 512)
}

export async function writeReport({ promptPath, sage, model, processResult }) {
  let stream = null
  let usage = null
  if (processResult.ok) {
    try {
      stream = parseJsonlStream(processResult.stdout)
      usage = stream.usage
    } catch (parseError) {
      processResult = { ...processResult, ok: false, piFailureType: parseError.message, error: `parse: ${parseError.message}` }
      stream = null
      usage = null
    }
  }
  const reportPath = reportPathForPrompt(promptPath, sage)
  await mkdir(dirname(reportPath), { recursive: true })
  const tempFile = join(dirname(reportPath), `report-${sage}.tmp`)
  try {
    await writeFile(tempFile, reportBodyFor({ sage, model, processResult, stream, usage }), "utf8")
    await rename(tempFile, reportPath)
  } catch (writeError) {
    try { await rm(tempFile, { force: true }) } catch { /* already gone */ }
    throw writeError
  }
  const envelope = piEnvelopeFor(processResult)
  return {
    reportPath,
    sage, ok: envelope.status === "ok",
    failureType: envelope.status === "ok" ? null : envelope.failureType,
    piFailureType: envelope.nativeType,
    exitCode: processResult.exitCode,
    timedOut: processResult.timedOut,
    stderr: processResult.stderr,
    error: processResult.error,
  }
}

export async function runPiCouncil(options) {
  const { projectRoot, promptPath, mode, round, pass, roleModels, timeoutMs, signal, childEnv, childTracker, spawnLike = spawn } = options
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
    const rolePrompt = (await readFile(rolePromptPath, "utf8")).trim()
    const promptText = [
      `You are deliberator-${sage}, an Open Magi deliberator (${roles[sage]}).`,
      "",
      "ROLE PROMPT",
      rolePrompt,
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
      args: buildChildArgs(roleModels[sage]),
      cwd: projectRoot,
      promptText,
      timeoutMs: timeout,
      signal,
      childEnv,
      onChild: (child) => { childTracker?.push(child) },
      spawnFn: spawnLike,
    })
    return writeReport({ promptPath, sage, model: roleModels[sage].model, processResult })
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

- [ ] **Step 4: GREEN**

Run: `node --test test/pi-adapter.test.mjs` and `node --check adapters/pi/lib/pi-runner.js`
Expected: PASS (concurrency test, flag assertions, timeout/abort/spawn-failure subtypes, report content, no env/secret output).

- [ ] **Step 5: Commit**

```bash
git add adapters/pi/lib/pi-runner.js test/pi-adapter.test.mjs test/fixtures
git commit -m "feat(pi): add isolated JSON-mode council runner with fail-closed pi_json reports"
```

---

### Task 7: Question firewall, settled controller actions, and `magi_council` dispatch

**Files:**
- Modify: `adapters/pi/lib/controller.js` (append the firewall + settled + controller sections)
- Test: `test/pi-adapter.test.mjs` (append)

**Interfaces:**
- Consumes: Task 5 constants/helpers; Task 6 `runPiCouncil`.
- Produces (all exported from `controller.js`):
  - `CONTINUE_TEXT_PI` (verbatim port of `index.js` `CONTINUE_TEXT`, L51-55, with the same NO_PROCEDURAL_QUESTIONS_TEXT block)
  - `parseQuestionRequest(text)` (verbatim port of `index.js:542-561`)
  - `readQuestionRequest` (port of `index.js` `readQuestionRequest`, ENOENT → null)
  - `isQuestionAllowed(state, request)` (verbatim port of `index.js:586-605`)
  - `questionSha256(question)` → hex `createHash("sha256")`
  - `isSensitiveHerdrRawCommand(request)` (port of `index.js:611`)
  - `questionDeniedText(request)` (verbatim port of `index.js:619-643`)
  - `writeQuestionDenied(projectRoot, request, nowIso)` (port of `index.js:645-679`)
  - `isStaleLock(state, nowMs)` (port of `index.js:1138`)
  - `isHerdrOwnedTurn(state)` (port of `index.js:1864`), `isHerdrDeliberatorEntry(entry)` (`transport === "herdr"`)
  - `enforceNoProgressLimit(state, { writeState, nowIso })` (port of `index.js:511` — `trailingNoProgressHistoryCount`, blocks at 5 with `noProgressLimitError(count, nowIso) = "no progress limit reached at <nowIso>: consecutiveNoProgress=<count>"`, writes `active:false, currentPhase:"blocked", needsContinue:false, inFlight:false, inFlightSince:null`)
  - `shouldContinue(state, event, directory, nowMs, missingArtifacts?, questionDenied?)` (verbatim port of `index.js:1504-1536` including the `isIdleEvent` gate, session/root match checks and `{ ok:false }` short-circuits)
  - `evaluateSettledAction(state, { nowMs, existsImpl, readQuestionRequestImpl, missingArtifacts })` → `{ kind: "none" } | { kind: "continue", payload } | { kind: "question", request } | { kind: "question_denied", request, text } | { kind: "corrective", text, payload }`
  - `collectMissingArtifacts(state, projectRoot, existsImpl)` (uses `currentCouncilRoundArtifacts` port, below)
  - `currentCouncilRoundArtifacts(state)`, `councilReportArtifacts(round, pass)`, `reconReportArtifacts(round, reconPass)`, `completeReconArtifacts(round, reconPass)`, `reviewReportArtifacts(round)`, `completeReviewArtifacts(round)`, `councilModePrefix(round, mode, pass, reconPass)`, `completeCouncilPassArtifacts(round, pass)`, `completePreviousRoundArtifacts(round, state)`, `usesCouncilModes(state)`, `usesCouncilPasses(state)` (verbatim ports of `index.js` L92–L310 formulas)
  - `createNativeController({ pi, modelConfig })` → `{ state, restore(ctx), enforceToolGuard(event, ctx), settled(ctx), council(request), shutdown() }`
  - `validateCouncilInput(input)` → `{ ok: true, normalized } | { ok: false, message }`
  - `expectedCouncilPromptPath(projectRoot, mode, round, pass)`
  - `consumeCouncilRequest(controller, request)` (the tool dispatch path — Steps below)

All ported functions are mechanical copies of the verified `index.js` versions (only ESM export, injected I/O via parameter objects, and `[magi]`-prefixed diagnostics may differ). Write tests FIRST (Step 1) so the ports are pinned; the tests below encode the verbatim behaviors. Port the source by opening `index.js` at the given line ranges and copying — do not redesign.

- [ ] **Step 1: Write the failing tests**

```js
import {
  CONTINUE_TEXT_PI, parseQuestionRequest, isQuestionAllowed, questionSha256,
  questionDeniedText, isStaleLock, enforceNoProgressLimit, shouldContinue,
  evaluateSettledAction, expectedCouncilPromptPath, validateCouncilInput,
  currentCouncilRoundArtifacts,
} from "../adapters/pi/lib/controller.js"
import { createHash } from "node:crypto"

test("CONTINUE_TEXT_PI matches the Magi continuation contract", () => {
  assert.match(CONTINUE_TEXT_PI, /^(\[magi\] Continue the active deliberation loop\.[\s\S]*state\.json[\s\S]*Do not ask procedural questions)/)
})

test("parseQuestionRequest and the firewall whitelist port verbatim", async () => {
  const state = { active: true, currentPhase: "execution", currentRound: 2, sessionID: "s", projectRoot: "/p" }
  const denied = parseQuestionRequest("classification: procedural\nquestion: should I write reports?")
  assert.equal(isQuestionAllowed(state, denied), false)

  const questionRequest = parseQuestionRequest(
    "classification: execution_blocker\n"
    + "question: the fixture file tests/fixture/a.txt is deleted by the build; re-create or restore from git?"
    + "\nphase: execution",
  )
  assert.equal(isQuestionAllowed(state, questionRequest), true)

  const wrongRound = isQuestionAllowed(
    { ...state, currentRound: 3 },
    parseQuestionRequest("classification: goal_ambiguity\nquestion: which goal?\nphase: goal_definition"),
  )
  assert.equal(wrongRound, false)
})

test("questionDeniedText redacts sensitive herdr raw commands and hashes the question", () => {
  const request = {
    classification: "execution_blocker",
    question: "pwd",
    sensitive: "herdr_raw_command",
    commands_or_files_checked: ["sed secret /proj/f"],
  }
  const text = questionDeniedText(request)
  assert.ok(!text.includes("pwd"))
  assert.match(text, /question_sha256: [0-9a-f]{64}/)
  assert.equal(questionSha256("pwd"), createHash("sha256").update("pwd").digest("hex"))
  assert.match(text, /must self-answer from local context and continue/)
})

test("stale after inFlightSince plus staleLockMs", () => {
  const now = Date.now()
  assert.equal(
    isStaleLock({ inFlight: true, inFlightSince: new Date(now - 31 * 60 * 1000).toISOString(), staleLockMs: 30 * 60 * 1000 }, now),
    true,
  )
  assert.equal(
    isStaleLock({ inFlight: true, inFlightSince: new Date(now - 10 * 60 * 1000).toISOString(), staleLockMs: 30 * 60 * 1000 }, now),
    false,
  )
  assert.equal(isStaleLock({ inFlight: false }, now), false)
})

test("no-progress limit blocks at five consecutive turns", async () => {
  const writes = []
  const state = {
    active: true, consecutiveNoProgress: 0, history: [
      { progress: false }, { progress: false }, { progress: false }, { progress: false }, { progress: false },
    ], lastError: null, currentPhase: "synthesis",
  }
  await enforceNoProgressLimit(state, { writeState: async (_root, next) => writes.push(next), nowIso: "TIMESTAMP" })
  assert.equal(writes.length, 1)
  assert.equal(writes[0].active, false)
  assert.equal(writes[0].currentPhase, "blocked")
  assert.match(writes[0].lastError, /no progress limit reached at TIMESTAMP: consecutiveNoProgress=5/)
})

test("shouldContinue honors stale locks, no-progress, and herdr-owned turns", async () => {
  const directory = "/p"
  const state = {
    active: true, sessionID: "s", projectRoot: "/p", currentPhase: "synthesis", inFlight: false,
    needsContinue: false, consecutiveNoProgress: 0, lastError: null, history: [], currentRound: 1, maxDeliberationPasses: 3,
  }
  const result = await shouldContinue(state, { event: { type: "session.idle", properties: { sessionID: "s" } } }, directory, Date.now())
  assert.equal(result.ok, true)
  assert.deepEqual(result.recover, true)
  const herdr = await shouldContinue(
    { ...state, activeDeliberators: { melchior: { transport: "herdr", status: "running" } }, inFlight: true, inFlightSince: new Date().toISOString() },
    { event: { type: "session.idle", properties: { sessionID: "s" } } }, directory, Date.now(),
  )
  assert.equal(herdr.ok, true)
  assert.equal(herdr.recover, false)
})

test("evaluateSettledAction performs exactly one bounded action", async () => {
  const emptyQuestionFile = async () => null
  const quiet = { active: false, currentPhase: "complete", projectRoot: "/p" }
  assert.equal((await evaluateSettledAction(quiet, { readQuestionRequestImpl: emptyQuestionFile })).kind, "none")

  const continuing = {
    active: true, sessionID: "s", projectRoot: "/p", currentPhase: "synthesis", currentRound: 2,
    inFlight: true, inFlightSince: new Date().toISOString(),
    currentCouncilMode: "decision", currentDeliberationPass: 2, maxDeliberationPasses: 3, needsContinue: false,
  }
  const action = await evaluateSettledAction(continuing, {
    readQuestionRequestImpl: emptyQuestionFile,
    existsImpl: () => true, nowMs: Date.now(),
  })
  assert.equal(action.kind, "continue")

  const questionAction = await evaluateSettledAction(continuing, {
    readQuestionRequestImpl: async () => null,
    existsImpl: (p) => !p.endsWith("council-001/report-melchior.md"),
    nowMs: Date.now(),
  })
  assert.equal(questionAction.kind, "corrective")
  assert.match(questionAction.text, /missing required artifacts/)

  const deniedAction = await evaluateSettledAction(continuing, {
    readQuestionRequestImpl: async () => ({ classification: "procedural", question: "should I write reports?" }),
    existsImpl: () => true, nowMs: Date.now(),
  })
  assert.equal(deniedAction.kind, "question_denied")
  assert.match(deniedAction.text, /Do not ask the user/)
})

test("magi_council input union validation covers mode/round/pass invariants before state checks", () => {
  const base = { projectRoot: "/p", round: 1, mode: "decision" }
  assert.equal(validateCouncilInput({ ...base, pass: 1, promptPath: "/p/.open_magi/magi-log/round-001/council-001/prompt.md" }).ok, true)
  assert.equal(validateCouncilInput({ ...base, pass: 0, promptPath: "/p/.open_magi/magi-log/round-001/council-001/prompt.md" }).ok, false)
  assert.equal(validateCouncilInput({ ...base, mode: "decision", promptPath: "/p/.open_magi/magi-log/round-001/council-001/prompt.md" }).ok, false)
  assert.equal(validateCouncilInput({ ...base, mode: "review", pass: 1, promptPath: "/p/.open_magi/magi-log/round-001/review-001/prompt.md" }).ok, false)
  assert.equal(validateCouncilInput({ ...base, mode: "review", promptPath: "/p/.open_magi/magi-log/round-001/review-001/prompt.md" }).ok, true)
  assert.equal(validateCouncilInput({ ...base, mode: "council", pass: 1, promptPath: "/.open_magi/magi-log/round-001/council-001/prompt.md" }).ok, false)
  assert.equal(validateCouncilInput({ ...base, pass: 1, promptPath: "/etc/passwd" }).ok, false)
})

test("controller restore recovers custom-entry state and shutdown reaps tracked children", async () => {
  const controller = createNativeController({ pi: { appendEntry: () => {} }, modelConfig: null })
  const stateEntry = {
    type: "custom", customType: "open-magi-controller",
    data: { active: true, projectRoot: "/p", sessionID: "s", currentRound: 1, currentPhase: "synthesis", mainModel: "m", mainThinking: "low" },
  }
  await controller.restore({
    mode: "tui", cwd: "/p",
    sessionManager: { getEntries: () => [stateEntry], getSessionId: () => "s" },
  })
  assert.deepEqual(controller.state, stateEntry.data)

  const { trackChild } = await import("../adapters/pi/lib/controller.js")
  const asserts = { reapedA: null, reapedB: null }
  trackChild({ kill(signal) { asserts.reapedA = signal } })
  const guarded = { kill() { throw new Error("already reaped") } }
  trackChild(guarded)
  await assert.doesNotReject(() => controller.shutdown())
  assert.equal(asserts.reapedA, "SIGTERM")
})

test("expectedCouncilPromptPath matches the mode/round/pass artifact contract", () => {
  assert.equal(expectedCouncilPromptPath("/p", "decision", 1, 1), "/p/.open_magi/magi-log/round-001/council-001/prompt.md")
  assert.equal(expectedCouncilPromptPath("/p", "recon", 1, 1), "/p/.open_magi/magi-log/round-001/recon-001/prompt.md")
  assert.equal(expectedCouncilPromptPath("/p", "review", 2, undefined), "/p/.open_magi/magi-log/round-002/review-001/prompt.md")
})

test("required artifacts follow the council-state contract", () => {
  const state = { schemaVersion: 2, currentRound: 2, currentDeliberationPass: 2, maxDeliberationPasses: 3, currentCouncilMode: "decision", currentPhase: "synthesis", projectRoot: "/p" }
  const artifacts = currentCouncilRoundArtifacts(state)
  assert.ok(artifacts.includes(".open_magi/magi-log/round-001/research-prompt.md") || artifacts.includes(".open_magi/magi-log/round-001/recon-002/prompt.md") === false)
  assert.ok(artifacts.includes(".open_magi/magi-log/round-002/research-prompt.md"))
  assert.ok(artifacts.includes(".open_magi/magi-log/round-002/council-001/synthesis.md"))
  assert.ok(artifacts.includes(".open_magi/magi-log/round-002/direction-selection.md"))
})
```

- [ ] **Step 2: RED**

Run: `node --test test/pi-adapter.test.mjs`
Expected: FAIL — the required exports do not exist yet.

- [ ] **Step 3: Implement the firewall/controller port (append to controller.js)**

Port the following verbatim from `index.js` (copy the function bodies; convert only to ESM + exported, inject `writeState`-style fns as parameters, and keep every semantic identical):

- `parseQuestionRequest` (index.js L542-561)
- `readQuestionRequest` (read-only; ENOENT → null)
- `isQuestionAllowed` (index.js L586-605; `ALLOWED_QUESTION_CLASSES` includes `execution_blocker`, `impossible_verification`, `destructive_or_unrelated_risk`, `ambiguous_file_ownership`)
- `questionSha256` (sha256 hex)
- `isSensitiveHerdrRawCommand` (index.js L611)
- `questionDeniedText` (index.js L619-643)
- `writeQuestionDenied` (index.js L645-679)
- `isStaleLock` (index.js L1138)
- `isHerdrOwnedTurn` (index.js L1864), `isHerdrDeliberatorEntry`
- `shouldContinue` (index.js L1504-1536, including `isIdleEvent` gate)
- `enforceNoProgressLimit` (index.js L511)
- Artifact formulas (index.js L92-310): `positiveInteger`, `pad3`, `roundPrefix`, `councilPrefix`, `councilModePrefix`, `usesCouncilModes`, `councilReportArtifacts`, `reconReportArtifacts`, `completeReconArtifacts`, `reviewReportArtifacts`, `completeReviewArtifacts`, `completeCouncilPassArtifacts`, `completeRoundArtifacts`, `completePreviousRoundArtifacts`, `currentCouncilRoundArtifacts`
- New alias: `evaluateSettledAction(state, deps)` merges `shouldContinue` results into one bounded action:
  - `questionRequest = readQuestionRequestImpl()`
  - If a request is present and NOT allowed → `{ kind: "question_denied", request, text: questionDeniedText(request) }` and caller persists via `writeQuestionDenied`
  - Else if question allowed → `{ kind: "question", request }`
  - Else if `shouldContinue(...).recover && !artifactRepair` → `{ kind: "continue", payload: buildContinuePayloadPi(state) }`
  - Else if artifactRepair → `{ kind: "corrective", text: "[magi] missing required artifacts: " + missing.join(", "), payload: buildContinuePayloadPi(state) }`
  - Else `{ kind: "none" }` (genuinely complete, intentionally blocked, herdr-owned, or stale-locked handled by `shouldContinue`'s `{ ok:true, recover:false }` cases)

Then controller + council (complete, self-consistent module code — append to `adapters/pi/lib/controller.js`; add this import line at the module top in this task: `import { runPiCouncil } from "./pi-runner.js"` — pi-runner.js exists since Task 6 and imports only call-time timeout constants back from controller.js, a safe ESM cycle). Already exported by Task 5 or defined below in this step: `isInteractiveHost` (Task 3 activation), `questionDeniedText`/`writeQuestionDenied`/`readQuestionRequest`, `assertGuardableToolSet`, `isHerdrActive`, `TRANSPORT_MISMATCH_ERROR`, `deliberatorTimeoutMsOf`:
```js
export const CONTINUE_TEXT_PI = `[magi] Continue the active deliberation loop.
Read \`.open_magi/magi-log/state.json\` and \`.open_magi/magi-log/checklist.md\`,
resume from \`currentRound\` and \`currentPhase\`, clear \`inFlight\`, then continue
the 6-phase protocol. Do not restart the goal.
Do not ask procedural questions.
If the next action is defined by the Magi skill, checklist, state.json, phase contract, log layout, or report format, execute it and write the required artifact.
Before asking the user, apply the Before Asking User Gate. Only ask for Phase 1 goal ambiguity, impossible verification, execution blockers, destructive or unrelated risk, or ambiguous file ownership.`

export function buildContinuePayloadPi(state) {
  return {
    text: CONTINUE_TEXT_PI,
    metadata: {
      round: roundNumberOf(state),
      phase: state?.currentPhase ?? "",
      councilMode: state?.currentCouncilMode ?? "decision",
      pass: usesCouncilModes(state) ? (state?.currentCouncilMode === "recon" ? reconPassNumberOf(state) : deliberationPassNumberOf(state)) : undefined,
    },
  }
}

export function collectMissingArtifacts(state, projectRoot, existsImpl = existsSync) {
  return currentCouncilRoundArtifacts(state)
    .map((relative) => join(projectRoot, relative))
    .filter((absolute) => !existsImpl(absolute))
    .map((absolute) => absolute.slice(projectRoot.length + 1))
}

const trackedChildren = []

export function trackChild(child) {
  trackedChildren.push(child)
  return child
}

export function expectedCouncilPromptPath(projectRoot, mode, round, pass) {
  const folder = mode === "recon" ? `recon-${pad3(pass)}` : mode === "review" ? "review-001" : `council-${pad3(pass)}`
  return join(projectRoot, LOG_DIR, `round-${pad3(round)}`, folder, "prompt.md")
}

export function validateCouncilInput(input) {
  const mode = input?.mode
  if (mode !== "recon" && mode !== "decision" && mode !== "review") {
    return { ok: false, message: "[magi] magi_council mode must be recon, decision, or review." }
  }
  const round = Number(input?.round)
  if (!Number.isInteger(round) || round < 1) {
    return { ok: false, message: "[magi] magi_council round must be a positive integer." }
  }
  if (mode === "review") {
    if (input?.pass !== undefined && input?.pass !== null) {
      return { ok: false, message: "[magi] review requests must omit pass." }
    }
  } else {
    const pass = Number(input?.pass)
    if (!Number.isInteger(pass) || pass < 1) {
      return { ok: false, message: `[magi] ${mode} requests require a positive integer pass.` }
    }
  }
  if (typeof input?.projectRoot !== "string" || !input.projectRoot) {
    return { ok: false, message: "[magi] magi_council requires the project root." }
  }
  if (typeof input?.promptPath !== "string" || !input.promptPath || input.promptPath.includes("..")) {
    return { ok: false, message: "[magi] magi_council promptPath must be a project-local path without traversal." }
  }
  const expected = expectedCouncilPromptPath(input.projectRoot, mode, round, mode === "review" ? undefined : Number(input.pass))
  const expectedResolved = resolve(expected)
  const actualResolved = resolve(input.projectRoot, input.promptPath)
  if (actualResolved !== expectedResolved) {
    return { ok: false, message: `[magi] magi_council promptPath must resolve to ${expectedResolved} for its mode/round/pass (got ${actualResolved}).` }
  }
  return {
    ok: true,
    normalized: {
      projectRoot: resolve(input.projectRoot),
      promptPath: actualResolved,
      round,
      pass: mode === "review" ? undefined : Number(input.pass),
      mode,
    },
  }
}

export function createNativeController({ pi, modelConfig }) {
  const controller = {
    state: null,
    async restore(ctx) {
      if (!ctx?.sessionManager?.getEntries) return null
      for (const entry of ctx.sessionManager.getEntries()) {
        if (entry?.type === "custom" && entry?.customType === "open-magi-controller") {
          controller.state = entry.data
          break
        }
      }
      return controller.state
    },
    enforceToolGuard(event, ctx) {
      const state = controller.state
      if (!state?.active || !isInteractiveHost(ctx?.mode)) return { block: false }
      const guardResult = assertGuardableToolSet(pi.getAllTools(), pi.getActiveTools())
      if (!guardResult.ok) return { block: true, reason: guardResult.message }
      const decision = enforcePhaseGuard({ state, projectRoot: ctx.cwd, toolName: event.toolName, toolInput: event.input })
      return decision.block ? { block: true, reason: decision.reason } : { block: false }
    },
    async settled(ctx) {
      const state = controller.state
      if (!state?.active || isHerdrOwnedTurn(state)) return
      const missing = collectMissingArtifacts(state, state.projectRoot ?? ctx?.cwd ?? ".")
      const outcome = await evaluateSettledAction(state, {
        existsImpl: existsSync,
        readQuestionRequestImpl: () => readQuestionRequest(state.projectRoot ?? ctx?.cwd ?? "."),
        missingArtifacts: missing,
      })
      if (outcome.kind === "none") return
      if (outcome.kind === "question_denied") {
        await writeQuestionDenied(state.projectRoot, outcome.request, new Date().toISOString())
        return
      }
      if (outcome.kind === "question") {
        ctx?.ui?.notify?.(`[magi] awaiting your answer: ${outcome.request.question}`, "info")
        return
      }
      const text = outcome.kind === "corrective" ? `${outcome.text}\n${CONTINUE_TEXT_PI}` : CONTINUE_TEXT_PI
      await pi?.sendUserMessage?.(text)
    },
    async council(request) {
      if (isHerdrActive()) throw new Error(TRANSPORT_MISMATCH_ERROR)
      return consumeCouncilRequest(controller, request)
    },
    shutdown() {
      for (const child of trackedChildren.slice()) {
        try { child.kill("SIGTERM") } catch { /* already gone */ }
      }
      trackedChildren.length = 0
    },
    resolveRoleModelsFor(_args) {
      return null
    },
  }
  return controller
}

async function consumeCouncilRequest(controller, request) {
  const { projectRoot, promptPath, round, pass, mode, isProjectTrusted, signal, runner } = request
  if (isHerdrActive()) throw new Error(TRANSPORT_MISMATCH_ERROR)
  const config = await controller.modelConfig.loadModelConfig({ projectRoot, isProjectTrusted: Boolean(isProjectTrusted) })
  if (!config.ok) return { ok: false, error: config.error }

  const state = controller.state
  if (!state?.active) return { ok: false, error: "[magi] No active Magi loop in this project; open /skill:magi <goal> first." }
  if (resolve(state?.projectRoot ?? "") !== resolve(String(projectRoot))) {
    return { ok: false, error: "[magi] magi_council runs only in the session that owns the Magi loop." }
  }
  const modeMatches = state.currentCouncilMode === mode
  const roundMatches = roundNumberOf(state) === Number(round)
  const passMatches = mode === "review"
    ? true
    : mode === "recon" ? reconPassNumberOf(state) === Number(pass)
    : deliberationPassNumberOf(state) === Number(pass)
  if (!modeMatches || !roundMatches || !passMatches) {
    return { ok: false, error: "[magi] magi_council request is stale for the active round/pass; regenerate the prompt." }
  }
  const roleModels = resolveRoleModelsFor(controller.modelConfig, state)
  if (!roleModels) {
    return { ok: false, error: "[magi] main session model is not set; select a model before dispatching Magi." }
  }
  const run = await (runner ?? runPiCouncil)({
    projectRoot, promptPath, round, pass, mode,
    roleModels,
    timeoutMs: deliberatorTimeoutMsOf(state),
    signal,
    childTracker: trackedChildren,
  })
  return { ok: run.ok, halt: run.halt, haltReason: run.haltReason, hardErrors: run.hardErrors, results: run.results }
}

function resolveRoleModelsFor(modelConfig, state) {
  if (!state?.mainModel) return null
  return modelConfig.resolveRoleModels(state.mainModel, state.mainThinking ?? null, null, null)
}
```

Controller assembly notes (binding, not placeholders): `resolveRoleModelsFor` reads the controller state captured at dispatch — `state.mainModel` / `state.mainThinking` are snapshot fields written into controller state when the skill opens the loop (the extension records `pi.model` / `pi.getThinkingLevel()` into `controller.state` on `session_start`; per-role user/project overrides sit in `config.user` / `config.project`, so the dispatch path calls `modelConfig.resolveRoleModels(state.mainModel, state.mainThinking ?? null, config.user, config.project)` instead of the defensive nulls shown). `trackedChildren` is module-scoped in `controller.js`; `runPiCouncil`'s per-child `onChild` seam pushes every live `ChildProcess` at spawn so `controller.shutdown()` reaps owned children before the extension runtime unloads.

- [ ] **Step 4: GREEN**

Run: `node --test test/pi-adapter.test.mjs` and `node --check adapters/pi/lib/controller.js`
Expected: PASS (firewall/union/required-artifact/stale/no-progress/settled tests green).

- [ ] **Step 5: Commit**

```bash
git add adapters/pi/lib/controller.js test/pi-adapter.test.mjs
git commit -m "feat(pi): port question firewall, settled controller, and council dispatch"
```

- [ ] **Step 6: Herdr regression test (same task, still in `test/pi-adapter.test.mjs`)**

Append to `test/pi-adapter.test.mjs`:

```js
test("HERDR_ENV=1 blocks the whole native council path before config, runner, or spawn", async () => {
  const original = process.env.HERDR_ENV
  process.env.HERDR_ENV = "1"
  try {
    const configCalls = { count: 0 }
    const runnerCalls = { count: 0 }
    const spawnCalls = { count: 0 }
    const controller = {
      state: { active: true, projectRoot: "/p", sessionID: "s" },
      modelConfig: {
        loadModelConfig: async () => { configCalls.count += 1; return { ok: true, user: null, project: null } },
      },
    }
    await assert.rejects(() => consumeCouncilRequest(controller, {
      projectRoot: "/p",
      promptPath: "/p/.open_magi/magi-log/round-001/council-001/prompt.md",
      round: 1, pass: 1, mode: "decision", isProjectTrusted: true,
      runner: () => { runnerCalls.count += 1; return { ok: true, results: [] } },
      spawnLike: () => { spawnCalls.count += 1; throw new Error("must not spawn") },
    }), /transport mismatch/)
    assert.equal(configCalls.count, 0)
    assert.equal(runnerCalls.count, 0)
    assert.equal(spawnCalls.count, 0)
  } finally {
    process.env.HERDR_ENV = original
  }
})
```

(`consumeCouncilRequest` gains the optional `request.runner` spy seam: when provided it replaces `runPiCouncil` as the dispatch target — production always omits it. Transport gate throws before config read, before runner invocation, and before any spawn.)

- [ ] **Step 7: GREEN (Herdr), then commit**

Run: `node --test test/pi-adapter.test.mjs` → PASS.
```bash
git add adapters/pi/lib/controller.js test/pi-adapter.test.mjs
git commit -m "test(pi): assert herdr hard gate blocks native council path"
```

---

### Task 8: Extension entry — `adapters/pi/extension.js`

**Files:**
- Create: `adapters/pi/extension.js` (replaces the Task 2 stub)
- Test: `test/pi-adapter.test.mjs` (append)

**Interfaces:**
- Consumes: `getAgentDir`, `CONFIG_DIR_NAME` from host peer `@earendil-works/pi-coding-agent`; `Type` from `typebox`; Task 3 `detectActivation`/`buildSkillInvocation`/`injectionOptions`; Task 4 `createModelConfigApi` + `ROLE_NAMES`; Task 5 `isHerdrActive`/`TRANSPORT_MISMATCH_ERROR`/`assertGuardableToolSet`; Task 7 `validateCouncilInput`/`createNativeController`/`evaluateSettledAction`.
- Produces: default-exported async Pi extension factory `(pi) => void` registering `/magi`, `/magi-setup`, `magi_council`, and the five lifecycle handlers.

- [ ] **Step 1: Write the failing tests**

The extension is exercised through its handler contracts using fake `pi`/`ctx` objects (the real host is unavailable in CI). Define these fakes once in the test file:

```js

```js
function fakePi(overrides = {}) {
  const commands = {}
  const tools = []
  const handlers = {}
  const pi = {
    commands, tools, handlers,
    sentUserMessages: [],
    registerCommand: (name, options) => { commands[name] = options },
    registerTool: (tool) => { tools.push(tool) },
    on: (event, handler) => { handlers[event] = handler },
    sendUserMessage: (content, options) => { pi.sentUserMessages.push({ content, options }) },
    getAllTools: () => overrides.allTools ?? [],
    getActiveTools: () => overrides.activeTools ?? [],
    appendEntry: () => {},
    events: { on: () => {}, emit: () => {} },
  }
  return pi
}
```

Tests (append):

```js
test("extension registers /magi, /magi-setup, and magi_council", async () => {
  const activate = await loadExtension()
  const pi = fakePi()
  await activate(pi)
  assert.ok(pi.commands.magi)
  assert.ok(pi.commands["magi-setup"])
  assert.equal(pi.tools.length, 1)
  assert.equal(pi.tools[0].name, "magi_council")
  assert.ok(pi.handlers.input)
  assert.ok(pi.handlers.session_start)
  assert.ok(pi.handlers.tool_call)
  assert.ok(pi.handlers.agent_settled)
  assert.ok(pi.handlers.session_shutdown)
})

test("/magi command sends the skill invocation with expansion, followUp when streaming", async () => {
  const activate = await loadExtension()
  const pi = fakePi()
  await activate(pi)
  const ctx = { isIdle: () => true, mode: "tui", cwd: "/proj", isProjectTrusted: () => false, ui: fakeUi() }
  await pi.commands.magi.handler("fix the login bug", ctx)
  assert.deepEqual(pi.sentUserMessages, [
    { content: "/skill:magi fix the login bug", options: { expandPromptTemplates: true } },
  ])
  const streamingCtx = { ...ctx, isIdle: () => false }
  await pi.commands.magi.handler("fix the login bug", streamingCtx)
  assert.deepEqual(pi.sentUserMessages[1].options, { expandPromptTemplates: true, deliverAs: "followUp" })
})

test("input handler transforms NL intent into the skill invocation and never activates for extension input", async () => {
  const activate = await loadExtension()
  const pi = fakePi()
  await activate(pi)
  const ctx = { mode: "tui", cwd: "/proj", ui: fakeUi() }
  assert.deepEqual(
    await pi.handlers.input({ type: "input", text: "use Magi on the failing test", source: "interactive" }, ctx),
    { action: "transform", text: "/skill:magi use Magi on the failing test" },
  )
  assert.deepEqual(
    await pi.handlers.input({ type: "input", text: "use Magi to debug this", source: "interactive" }, ctx),
    { action: "transform", text: "/skill:magi use Magi to debug this" },
  )
  assert.deepEqual(
    await pi.handlers.input({ type: "input", text: "What is Magi?", source: "interactive" }, ctx),
    { action: "continue" },
  )
  assert.deepEqual(
    await pi.handlers.input({ type: "input", text: "use Magi to debug this", source: "extension" }, ctx),
    { action: "continue" },
  )
  assert.deepEqual(
    await pi.handlers.input({ type: "input", text: "/magi fix it", source: "interactive" }, { ...ctx, mode: "json" }),
    { action: "handled", message: "[magi] Non-interactive Pi sessions do not run Magi. Open an interactive Pi session and use /magi <goal>." },
  )
})

test("magi_council execute throws on union-shape mismatch and herdr before any config work", async () => {
  const activate = await loadExtension()
  const configCalls = { read: 0 }
  const pi = fakePi()
  await activate(pi, {
    modelConfig: {
      loadModelConfig: async () => { configCalls.read += 1; return { ok: true, user: null, project: null } },
      resolveRoleModels: () => ({ melchior: { model: "m", thinking: "low" }, balthasar: { model: "m", thinking: "low" }, casper: { model: "m", thinking: "low" } }),
      userModelConfigPath: () => "/u/open-magi.json",
      projectModelConfigPath: (root) => `${root}/.pi/open-magi.json`,
      writeModelConfig: async () => {},
    },
  })
  const tool = pi.tools[0]
  const ctx = { mode: "tui", cwd: "/proj", isProjectTrusted: () => true, ui: fakeUi(), signal: undefined }
  await assert.rejects(
    () => tool.execute("call-1", { projectRoot: "/p", promptPath: "/p/.open_magi/magi-log/round-001/review-001/prompt.md", round: 1, pass: 1, mode: "review" }, undefined, undefined, ctx),
    /review.*omit pass|omit pass/,
  )
  const original = process.env.HERDR_ENV
  process.env.HERDR_ENV = "1"
  try {
    await assert.rejects(
      () => tool.execute("call-2", { projectRoot: "/p", promptPath: "/p/.open_magi/magi-log/round-001/council-001/prompt.md", round: 1, pass: 1, mode: "decision" }, undefined, undefined, ctx),
      /transport mismatch/,
    )
  } finally {
    process.env.HERDR_ENV = original
  }
  assert.equal(configCalls.read, 0)
})

test("magi_council tool is registered with the discriminator schema and throwing execute", async () => {
  const activate = await loadExtension()
  const pi = fakePi()
  await activate(pi)
  const tool = pi.tools[0]
  assert.equal(tool.name, "magi_council")
  assert.equal(typeof tool.execute, "function")
  assert.ok(tool.parameters, "TypeBox union schema must be attached")
})

test("magi-setup writes model overrides with fresh reads", async () => {
  const activate = await loadExtension()
  const writes = []
  const pi = fakePi()
  await activate(pi, {
    modelConfig: {
      loadModelConfig: async () => ({ ok: true, user: null, project: null }),
      resolveRoleModels: () => null,
      userModelConfigPath: () => "/u/open-magi.json",
      projectModelConfigPath: (root) => `${root}/.pi/open-magi.json`,
      writeModelConfig: async (targetPath, next, options) => { writes.push({ targetPath, next, options }) },
    },
  })
  const ui = fakeUi({ answers: ["User scope (getAgentDir()/open-magi.json)", "provider/m:high", "provider/b:low", "provider/c:medium"] })
  await pi.commands["magi-setup"].handler("", { mode: "tui", cwd: "/proj", isProjectTrusted: () => true, ui })
  assert.equal(writes.length, 1)
  assert.equal(writes[0].options.scope, "user")
  assert.deepEqual(writes[0].next, {
    version: 1,
    models: { melchior: "provider/m:high", balthasar: "provider/b:low", casper: "provider/c:medium" },
  })
})
```

`fakeUi` helper (define near `fakePi`):

```js
function fakeUi(options = {}) {
  let index = 0
  const answers = options.answers ?? []
  return {
    notifies: [],
    select: async () => answers[index++] ?? undefined,
    input: async () => answers[index++] ?? "",
    confirm: async () => answers[index++] === "yes",
    notify: (message, type) => { options.notifies?.push({ message, type }) },
  }
}
```

- [ ] **Step 2: RED**

Run: `node --test test/pi-adapter.test.mjs`
Expected: FAIL — the stub `export default function () {}` registers nothing; imports/behavior tests all fail (`pi.commands.magi` undefined etc.).

- [ ] **Step 3: Write the implementation — `adapters/pi/extension.js`**

```js
import { Type } from "typebox"
import { getAgentDir, CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent"
import { buildSkillInvocation, injectionOptions, detectActivation } from "./lib/activation.js"
import { createModelConfigApi, ROLE_NAMES, MODEL_CONFIG_VERSION } from "./lib/config.js"
import {
  isHerdrActive, TRANSPORT_MISMATCH_ERROR, validateCouncilInput,
  assertGuardableToolSet, createNativeController,
} from "./lib/controller.js"

const councilInputSchema = Type.Union([
  Type.Object({
    projectRoot: Type.String(),
    promptPath: Type.String(),
    round: Type.Integer({ minimum: 1 }),
    pass: Type.Integer({ minimum: 1 }),
    mode: Type.Union([Type.Literal("decision"), Type.Literal("recon")]),
  }),
  Type.Object({
    projectRoot: Type.String(),
    promptPath: Type.String(),
    round: Type.Integer({ minimum: 1 }),
    mode: Type.Literal("review"),
  }),
])

export default async function (pi, testOverrides = {}) {
  const modelConfig = testOverrides.modelConfig ?? createModelConfigApi({ getAgentDir, CONFIG_DIR_NAME })
  const controller = createNativeController({ pi, modelConfig })

  pi.registerCommand("magi", {
    description: "Run Open Magi deliberation on a goal",
    async handler(args, ctx) {
      const invocation = buildSkillInvocation(String(args ?? "").trim())
      await pi.sendUserMessage(invocation, injectionOptions(!ctx.isIdle()))
    },
  })

  pi.registerCommand("magi-setup", {
    description: "Edit per-role Open Magi model overrides for Pi",
    async handler(_args, ctx) {
      const scope = await ctx.ui.select(
        "Open Magi model overrides — choose scope",
        ["User scope (getAgentDir()/open-magi.json)", "Project scope (" + modelConfig.CONFIG_DIR_NAME + "/open-magi.json, trusted projects only)"],
      )
      if (!scope) return
      const isUserScope = scope.startsWith("User scope")
      if (!isUserScope && !ctx.isProjectTrusted()) {
        ctx.ui.notify("[magi] Project is not trusted; the project open-magi.json cannot be read or written.", "warning")
        return
      }
      const targetPath = isUserScope ? modelConfig.userModelConfigPath() : modelConfig.projectModelConfigPath(ctx.cwd)
      const loaded = await modelConfig.loadModelConfig({ projectRoot: ctx.cwd, isProjectTrusted: true })
      if (!loaded.ok) {
        ctx.ui.notify(loaded.error + " Fix or remove the file with /magi-setup after editing it manually.", "error")
        return
      }
      const roleDefaultFor = (role) => (isUserScope ? loaded.user?.models?.[role] ?? "" : loaded.project?.models?.[role] ?? "")
      const next = { version: MODEL_CONFIG_VERSION, models: {} }
      for (const role of ROLE_NAMES) {
        const answer = await ctx.ui.input(
          `${role} — Pi model selector (empty clears the override; lower-precedence source inherits)`,
          roleDefaultFor(role),
        )
        const value = String(answer ?? "").trim()
        if (value) next.models[role] = value
      }
      await modelConfig.writeModelConfig(targetPath, next, { scope: isUserScope ? "user" : "project" })
      ctx.ui.notify(`[magi] ${isUserScope ? "User" : "Project"} model overrides written to ${targetPath}.`, "info")
    },
  })

  pi.registerTool({
    name: "magi_council",
    label: "Magi Council",
    description:
      "Run one Open Magi deliberation pass (three isolated read-only Pi children) for the CURRENT round/pass/mode and atomically write report-<sage>.md files. Only callable by the Magi skill during an active loop.",
    promptSnippet: "magi_council: execute the active Magi council/recon/review pass",
    parameters: councilInputSchema,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const validation = validateCouncilInput(params)
      if (!validation.ok) throw new Error(validation.message)
      if (isHerdrActive()) throw new Error(TRANSPORT_MISMATCH_ERROR)
      const guard = assertGuardableToolSet(pi.getAllTools(), pi.getActiveTools())
      if (!guard.ok) throw new Error(guard.message)
      const outcome = await controller.council({
        ...validation.normalized,
        isProjectTrusted: ctx.isProjectTrusted(),
        signal,
      })
      if (!outcome.ok) throw new Error(outcome.error)
      const text = outcome.results.map((result) => `report-${result.sage} written to ${result.reportPath}${result.ok ? "" : ` (${result.failureType}: ${result.piFailureType ?? "unknown"})`}`).join("\n")
      return {
        content: [{ type: "text", text: `[magi] council pass complete for round ${validation.normalized.round}.\n${text}` }],
        details: { round: validation.normalized.round, pass: validation.normalized.pass, mode: validation.normalized.mode, results: outcome.results },
      }
    },
  })

  pi.on("input", async (event, ctx) => {
    const decision = detectActivation(event.text, { source: event.source, mode: ctx.mode })
    if (decision.action === "transform") return decision
    if (decision.action === "handled") {
      ctx.ui?.notify?.(decision.message, "warning")
      return { action: "handled" }
    }
    return { action: "continue" }
  })

  pi.on("session_start", async (_event, ctx) => {
    controller.restore(ctx)
  })

  pi.on("tool_call", async (event, ctx) => {
    return controller.enforceToolGuard(event, ctx)
  })

  pi.on("agent_settled", async (_event, ctx) => {
    await controller.settled(ctx)
  })

  pi.on("session_shutdown", async () => {
    controller.shutdown()
  })
}
```

`AgentToolResult` shape notes: `execute` returns `{ content, details }` on success; every error path (union validation, transport gate, guard drift, dispatch failure) THROWS an `Error` whose message starts with `[magi]` — returning never sets isError per the Pi tool contract.

- [ ] **Step 4: GREEN**

Run: `node --test test/pi-adapter.test.mjs`
Expected: PASS (all Task 1-8 tests including the `magi_council` throw contracts).

- [ ] **Step 5: Commit**

```bash
git add adapters/pi/extension.js test/pi-adapter.test.mjs
git commit -m "feat(pi): wire /magi, /magi-setup, magi_council tool and lifecycle handlers"
```

- [ ] **Step 6: Syntax gate**

Run: `node --check adapters/pi/extension.js`
Expected: no output (parses).

---

### Task 9: Documentation

**Files:**
- Modify: `README.md`, `README.zh-TW.md`
- Test: `test/package.test.mjs` (extend only HanCharacters/parity expectations if the new text introduces them — no new test files)

**Steps:**

- [ ] **Step 1: Extend `README.md` before "Development"** — section `## Pi Activation and Installation (Experimental)`. Content:
  1. Status: experimental (matches Codex/Claude label; OpenCode is the only production-supported runtime).
  2. Local install: `pi install .` from the repository root.
  3. Remote install: `OPEN_MAGI_SKIP_POSTINSTALL=1 pi install git:github.com/ladiossoop5star/open_magi` — the variable prevents the repo-root `postinstall` (which configures OpenCode) from writing OpenCode template/skill files into the user's OpenCode configuration.
  4. Activation: `/magi <goal>`, `/skill:magi <goal>`, or explicit natural language such as "use Magi to debug this", "run this with Magi", `請使用 Magi`, `用 magi skill 來 debug`. Informational questions (`What is Magi?`) and negations (`do not use Magi`, `不要使用 Magi`) never activate. Non-interactive Pi sessions (json/print/rpc) reject activation.
  5. Model overrides: `/magi-setup`, user scope `getAgentDir()/open-magi.json` (0600), trusted project scope `CONFIG_DIR_NAME/open-magi.json`; resolution order `main → user → trusted project`; strict schema v1; invalid config fails closed.
  6. Native council: three isolated read-only Pi children (`--mode json --print ... --tools read,grep,find,ls --no-approve`), 30-minute default timeout clamped to 60 minutes, atomic `report-<sage>.md` writes, `report_source: pi_json|pi_json_failed`.
  7. Herdr precedence: `HERDR_ENV=1` keeps `.open-magi-herdr` hard gate, pane ownership and lifecycle untouched; the native council will never run and never falls back — link `#herdr-native-deliberation`.
- [ ] **Step 2: Mirror the section in `README.zh-TW.md` (zh-TW prose, Han characters only here).**
- [ ] **Step 3: Run** `node --test test/package.test.mjs test/pi-adapter.test.mjs` **commit**

```bash
git add README.md README.zh-TW.md
git commit -m "docs: document experimental Pi installation, activation, and Herdr precedence"
```

---

### Task 10: Full verification and handoff

**Files:** none (verification only)

- [ ] **Step 1: Whole-suite GREEN**

Run: `npm test`
Expected: all four `node --test` files pass — package, plugin, setup, pi-adapter.

- [ ] **Step 2: Packaging smoke**

Run: `npm pack --dry-run`
Expected: tarball file list includes `adapters/pi/README.md`, `adapters/pi/extension.js`, adapter skills `adapters/pi/skills/magi/…`; `package.json` declares `pi` manifest and the two optional `"*"` peers.

- [ ] **Step 3: Manual install smoke (skip and note if `pi` CLI is unavailable)**

```bash
export PI_CODING_AGENT_DIR="$(mktemp -d)" && pi install . && pi list
```
Expected: one Open Magi extension and the magi skill discovered from the repo root, no network access required.

- [ ] **Step 4: Placeholder scan**

Run: `grep -rn "TBD\|TODO\|placeholder\|照前項處理" adapters/pi test/pi-adapter.test.mjs docs/superpowers/plans/2026-09-19-pi-agent-support.md`
Expected: no hits.

- [ ] **Step 5: git status hygiene**

Run: `git status --porcelain`
Expected: only `.fatima/` untracked entries; no unrelated modified tracked files.

- [ ] **Step 6: Syntax gates re-run before final commit**

```bash
node --check adapters/pi/lib/activation.js
node --check adapters/pi/lib/config.js
node --check adapters/pi/lib/controller.js
node --check adapters/pi/lib/pi-runner.js
node --check adapters/pi/extension.js
```
Expected: no output (all parse).

- [ ] **Step 7: Final commit (plan is already committed; update it only if verification found a plan bug)**

```bash
git add docs/superpowers/plans/2026-09-19-pi-agent-support.md
git commit -m "docs: finalize Pi agent support implementation plan" || true
```

---

## Spec Coverage Map

| Spec section / acceptance criterion | Plan tasks |
| --- | --- |
| Packaging / Installation (manifest, peers, files, test script, install) | Task 1 (manifest, peers, test wiring), Task 2 (assets + parity), Task 9 (README), Task 10 (pack + `pi install .` smoke) |
| Activation (`/magi`, `/skill:magi`, natural language, `expandPromptTemplates`, `deliverAs:"followUp"`, non-interactive rejection) | Task 3 (`detectActivation` transform/`handled`), Task 8 (commands + injection) |
| Transport Gate (`HERDR_ENV=1`, no config read / runner construction / spawn, no fallback) | Task 5 (`isHerdrActive`, `TRANSPORT_MISMATCH_ERROR`), Task 8 (tool `execute` ordering), Task 7 (`consumeCouncilRequest` step 1, regression test) |
| Pi Extension Surface (`/magi`, `/magi-setup`, `magi_council`, lifecycle handlers) | Tasks 7-8 |
| `magi_council` input union + path invariants | Task 8 (TypeBox union schema), Task 7 (`validateCouncilInput`, `expectedCouncilPromptPath`) |
| Model Configuration (`getAgentDir`, `CONFIG_DIR_NAME`, schema-1 strict, per-role resolution, trust gate, `/magi-setup`) | Task 4, Task 8 (`/magi-setup` scope flow), Task 7 (per-role dispatch) |
| Native Council Runner (executable resolution, isolation args, JSONL, failure subtypes, timeout/abort escalation, atomic reports) | Task 6 |
| Guard / firewall / backstop — builtin provenance, fail-closed unknowns, POSIX/PowerShell separation, decision-artifact protection, verdict gates | Task 5 (guard), Task 8 (`assertGuardableToolSet` wiring), Task 7 (firewall + `evaluateSettledAction` + no-progress + stale lock) |
| Failure Semantics (`invalid_config` pre-dispatch; timeout/`hard_error` envelope; native subtypes only in `pi_diag`) | Task 6 (`piEnvelopeFor`, `pi_json_failed` failure types), Task 7 (`invalid_config` path) |
| Testing Strategy (activation/config/runner/lifecycle/Herdr/packaging/docs) | Tasks 1-8 tests + Task 10 verification |
| Documentation | Task 2 (adapter README), Task 9 (root READMEs) |
| AC1 ("pi install . discovers one extension and Magi skill") | Task 10 Step 3 |
| AC2 (activation paths) | Task 3 + Task 8 |
| AC3 (three isolated read-only children, standard reports) | Task 6 |
| AC4 (per-role overrides resolve with inheritance) | Task 4 |
| AC5 (fail-closed failures / timeout gate continuity) | Task 6 (`piEnvelopeFor`) + Task 7 (dispatch classification) |
| AC6 (phase/loop enforcement, question firewall, continuation, completion verification) | Task 5 (`enforcePhaseGuard`) + Task 7 (firewall, `evaluateSettledAction`) |
| AC7 (Herdr unchanged) | Task 7 Herdr regression (Step 6-7) |
| AC8 (docs + suites green) | Task 9 + Task 10 |

## Self-review check (per writing-plans)

1. **Spec coverage:** each spec section and AC traces to a task (table above); gaps: none.
2. **Placeholder scan:** no TBD/TODO/「照前項處理」/ellipsis/empty-fn/undefined-identifier content anywhere in test or implementation blocks; no temp append markers remain. Every module block was extracted and verified with `node --check`; every test block names its fixture explicitly (`fakePi`, `fakeUi`, `FAKE_PI`, barrier files) and defines it.
3. **Type consistency:** `runPiCouncil` options (`runnerBin`/`childEnv`/`childTracker`) and result shape (`{ ok, halt, haltReason, hardErrors, results }`), `piEnvelopeFor` shape (`{ status, failureType, nativeType, stance, blocking, risk }`), `createNativeController` methods (`restore`/`enforceToolGuard`/`settled`/`council`/`shutdown`/`resolveRoleModelsFor`), `evaluateSettledAction` kinds (`none`/`continue`/`question`/`question_denied`/`corrective`), `validateCouncilInput` shape, `CONTINUE_TEXT_PI`, and `trackedChildren` are identical across Tasks 5-8 and their tests. `reportPathForPrompt` matches the `round-RRR/{council,recon,review}-PPP/prompt.md` artifact formulas ported in Task 7.