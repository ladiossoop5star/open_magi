import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { mkdtemp, readFile, writeFile, mkdir, chmod, stat, readdir, rename, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
import {
  detectActivation, MAGI_COMMAND, SKILL_COMMAND, buildSkillInvocation, injectionOptions, isInteractiveHost,
} from "../adapters/pi/lib/activation.js"
import {
  createModelConfigApi, validateModelConfig, ROLE_NAMES, MODEL_CONFIG_FILE,
} from "../adapters/pi/lib/config.js"

function agentApiFor(agentDir, configDir = ".pi") {
  return createModelConfigApi({ getAgentDir: () => agentDir, CONFIG_DIR_NAME: configDir })
}
const interactive = { source: "interactive", mode: "tui" }
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
  assert.deepEqual(detectActivation("run Magi now", interactive).action, "transform")
  assert.deepEqual(detectActivation("start Magi on this failure", interactive).action, "transform")
  assert.deepEqual(detectActivation("debug this through Magi", interactive).action, "transform")
})

test("natural-language Chinese requests transform preserving the original", () => {
  const first = detectActivation("\u8ACB\u4F7F\u7528 Magi \u8655\u7406\u9019\u500B\u554F\u984C", interactive)
  assert.deepEqual(first, { action: "transform", text: "/skill:magi \u8ACB\u4F7F\u7528 Magi \u8655\u7406\u9019\u500B\u554F\u984C" })
  assert.deepEqual(detectActivation("\u7528 magi skill \u4F86 debug", interactive).action, "transform")
})

test("informational questions do not activate", () => {
  assert.deepEqual(detectActivation("What is Magi?", interactive), { action: "continue" })
  assert.deepEqual(detectActivation("Magi \u662F\u600E\u9EBC\u904B\u4F5C\u7684\uFF1F", interactive), { action: "continue" })
})

test("incidental mentions without use/start/run markers do not activate", () => {
  assert.deepEqual(detectActivation("magi has three roles", interactive), { action: "continue" })
  assert.deepEqual(detectActivation("the magi log is at .open_magi/magi-log", interactive), { action: "continue" })
})

test("negations do not activate regardless of markers", () => {
  assert.deepEqual(detectActivation("do not use Magi", interactive), { action: "continue" })
  assert.deepEqual(detectActivation("Don't run this with Magi", interactive), { action: "continue" })
  assert.deepEqual(detectActivation("Please don't use Magi", interactive), { action: "continue" })
  assert.deepEqual(detectActivation("\u4E0D\u8981\u4F7F\u7528 Magi", interactive), { action: "continue" })
  assert.deepEqual(detectActivation("\u4E0D\u8981\u4F7F\u7528 Magi\uFF0C\u8ACB\u50C5\u81EA\u884C\u5206\u6790", interactive), { action: "continue" })
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

test("user config path derives from getAgentDir including PI_CODING_AGENT_DIR-style overrides", () => {
  assert.equal(agentApiFor("/tmp/agentdir").CONFIG_DIR_NAME, ".pi")
  assert.equal(agentApiFor("/x", ".otherpi").CONFIG_DIR_NAME, ".otherpi")
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
    assert.equal((info.mode & 0o777).toString(8), "600")
  }
  // No temp file residue: completed writes clean up their sibling temps.
  const residue = (await readdir(tmpUser)).filter((name) => name.includes(MODEL_CONFIG_FILE) && name !== MODEL_CONFIG_FILE)
  assert.deepEqual(residue, [])

  // Project scope keeps ordinary modes and clears removed roles.
  const target2 = join(tmpUser, "nested", MODEL_CONFIG_FILE)
  await mkdir(dirname(target2), { recursive: true })
  await writeFile(target2, JSON.stringify({ version: 1, models: { melchior: "x/y", balthasar: "p/q", casper: "r/s" } }), "utf8")
  await api.writeModelConfig(target2, { version: 1, models: { melchior: "x/z" } }, { scope: "project" })
  const merged = JSON.parse(await readFile(target2, "utf8"))
  assert.deepEqual(merged, { version: 1, models: { melchior: "x/z" } })
})

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
  const denied = enforcePhaseGuard({ state: base, projectRoot: "/proj", toolName: "edit", toolInput: { file_path: "/proj/src/a.js" } })
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

test("decision-artifact protection matches absolute and relative targets across shell families", () => {
  const inFlight = (existsImpl) => ({
    state: { active: true, currentRound: 1, currentPhase: "parallel_deliberation", currentCouncilMode: "decision", currentDeliberationPass: 1, maxDeliberationPasses: 3 },
    existsImpl,
  })
  // Only the melchior report exists: pass 1 is in flight, decision writes denied.
  const inFlightState = inFlight((p) => !p.endsWith("report-melchior.md"))
  const relativeDenial = enforcePhaseGuard({
    ...inFlightState, projectRoot: "/proj", toolName: "bash",
    toolInput: { command: "echo stale > .open_magi/magi-log/round-001/council-001/prompt.md" },
  })
  assert.equal(relativeDenial.block, true)
  assert.match(relativeDenial.reason, /pass 1 is in flight/)
  const absoluteDenial = enforcePhaseGuard({
    ...inFlightState, projectRoot: "/proj", toolName: "bash",
    toolInput: { command: "echo stale > /proj/.open_magi/magi-log/round-001/council-001/prompt.md" },
  })
  assert.equal(absoluteDenial.block, true)
  const editAbsoluteDenial = enforcePhaseGuard({
    ...inFlightState, projectRoot: "/proj", toolName: "edit",
    toolInput: { file_path: "/proj/.open_magi/magi-log/round-001/verdict.md" },
  })
  assert.equal(editAbsoluteDenial.block, true)
  const reviewDenial = enforcePhaseGuard({
    state: { ...inFlightState.state, currentCouncilMode: "review" },
    projectRoot: "/proj", toolName: "powershell",
    toolInput: { command: "Set-Content -Path /proj/.open_magi/magi-log/round-001/verdict.md -Value x" },
    existsImpl: () => true,
  })
  assert.equal(reviewDenial.block, true)
  assert.match(reviewDenial.reason, /review pass is in flight/)
  // Once every report exists, the same write no longer touches a pending council.
  const resolved = enforcePhaseGuard({
    state: { ...inFlightState.state, currentPhase: "research_task" },
    projectRoot: "/proj", toolName: "bash",
    toolInput: { command: "echo notes > .open_magi/magi-log/round-001/council-001/prompt.md" },
    existsImpl: () => true,
  })
  assert.equal(resolved.block, false)
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

test("deliberator timeout: any positive override is honored and clamped only above the hard max", () => {
  assert.equal(deliberatorTimeoutMsOf({}), 30 * 60 * 1000)
  assert.equal(deliberatorTimeoutMsOf({ deliberatorTimeoutMs: 10 }), 10)
  assert.equal(deliberatorTimeoutMsOf({ deliberatorTimeoutMs: 10 * 60 * 1000 }), 10 * 60 * 1000)
  assert.equal(deliberatorTimeoutMsOf({ deliberatorTimeoutMs: 90 * 60 * 1000 }), 60 * 60 * 1000)
  assert.equal(deliberatorTimeoutMsOf({ deliberatorTimeoutMs: 0 }), 30 * 60 * 1000)
  assert.equal(deliberatorTimeoutMsOf({ deliberatorTimeoutMs: "abc" }), 30 * 60 * 1000)
})

test("positiveInteger falls back cleanly", () => {
  assert.equal(positiveInteger("7", 3), 7)
  assert.equal(positiveInteger(0, 3), 3)
  assert.equal(positiveInteger(undefined, 3), 3)
})
