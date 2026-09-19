import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { mkdtemp, readFile, writeFile, mkdir, chmod, stat, readdir, rename, rm } from "node:fs/promises"
// fsWriteFile is the alias the Task 6 test blocks use for writeFile.
const fsWriteFile = writeFile
import { tmpdir } from "node:os"
import { spawn } from "node:child_process"
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

import {
  DELIBERATORS, ISOLATION_ARGS, resolvePiInvocation, buildChildArgs, parseJsonlStream,
  runOnePiChild, piEnvelopeFor, reportPathForPrompt, writeReport, runPiCouncil,
} from "../adapters/pi/lib/pi-runner.js"

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

test("resolvePiInvocation matches the real Pi invocation shapes and falls back last", () => {
  const nodeScript = resolvePiInvocation({
    processArgv: ["/x/node", "/y/cli.mjs"],
    processExecPath: "/x/node",
    existsImpl: () => true,
  })
  assert.deepEqual(nodeScript, { command: "/x/node", args: ["/y/cli.mjs"] })
  const standalone = resolvePiInvocation({
    processArgv: ["/usr/local/bin/pi"],
    processExecPath: "/usr/local/bin/pi",
    existsImpl: () => true,
  })
  assert.deepEqual(standalone, { command: "/usr/local/bin/pi", args: [] })
  const bun = resolvePiInvocation({
    processArgv: ["/usr/local/bin/pi", "/$bunfs/root/pi"],
    processExecPath: "/usr/local/bin/pi",
    existsImpl: () => true,
  })
  assert.deepEqual(bun, { command: "/usr/local/bin/pi", args: [] })
  const fallback = resolvePiInvocation({
    processArgv: ["/x/node", "/missing/cli.mjs"],
    processExecPath: "/x/node",
    existsImpl: () => false,
  })
  assert.deepEqual(fallback, { command: "pi", args: [] })
})

test("buildChildArgs has one precise order ending with model then thinking; prompt is separate argv last", () => {
  const args = buildChildArgs({ model: "p/m", thinking: "ultra" })
  const toolsIdx = args.indexOf("--tools")
  assert.deepEqual(args.slice(0, toolsIdx), ["--mode", "json", "--print", "--no-session", "--no-extensions", "--no-skills", "--no-context-files", "--no-prompt-templates", "--no-themes"])
  assert.deepEqual(args.slice(toolsIdx, toolsIdx + 2), ["--tools", "read,grep,find,ls"])
  assert.equal(args[toolsIdx + 2], "--no-approve")
  assert.deepEqual(args.slice(-4), ["--model", "p/m", "--thinking", "medium"])
  assert.deepEqual(buildChildArgs({ model: "p/m", thinking: "high" }).slice(-4), ["--model", "p/m", "--thinking", "high"])
  assert.deepEqual(buildChildArgs({ model: "p/m", thinking: "off" }).slice(-4), ["--model", "p/m", "--thinking", "off"])
  // The child prompt is always the last element of the FULL spawned argv (added by runOnePiChild).
  assert.deepEqual(
    [...resolvePiInvocation({ processArgv: [], processExecPath: "/x/node", existsImpl: () => false }).args, ...buildChildArgs({ model: "p/m", thinking: "low" }), "PROMPT TEXT"].slice(-1),
    ["PROMPT TEXT"],
  )
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
  await mkdir(join(project, "role-prompts"), { recursive: true })
  const promptPath = join(councilDir, "prompt.md")
  await fsWriteFile(promptPath, "# Council prompt", "utf8")
  for (const sage of ["melchior", "balthasar", "casper"]) {
    await fsWriteFile(join(project, "role-prompts", `${sage}.md`), `You are deliberator-${sage}. Read-only.`, "utf8")
  }
  // Concurrency proof: each child blocks on its barrier file; barriers are only
  // created once ALL THREE children have spawned. If children were sequential,
  // the first child would never see its barrier and the test would time out.
  const barrierDir = await mkdtemp(join(tmpdir(), "magi-pi-barrier-"))
  const barrierDirEnv = { MAGI_BARRIER: join(barrierDir, "barrier") }
  const spawned = { cwd: [], flags: [], count: 0 }
  const registered = { bodies: [] }
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
    rolePromptRoot: join(project, "role-prompts"),
    childEnv: barrierDirEnv,
    childTracker: { add: (child) => registered.bodies.push(child.pid ?? null) },
    spawnLike: (command, args, options) => {
      spawned.cwd.push(options.cwd)
      spawned.flags.push(args)
      spawned.count += 1
      // Release the trio ONLY after all three have spawned: a sequential
      // implementation would hang since no child may finish before then.
      if (spawned.count === 3) {
        for (const sage of ["melchior", "balthasar", "casper"]) {
          fsWriteFile(`${barrierDirEnv.MAGI_BARRIER}-${sage}`, "go", "utf8").catch(() => {})
        }
      }
      return spawn(command, args, options)
    },
  })
  assert.equal(spawned.count, 3, "all three children spawned before any could complete (barrier waited for the trio)")
  assert.deepEqual([...results.results.map((r) => r.sage)].sort(), ["balthasar", "casper", "melchior"])
  assert.deepEqual([...spawned.cwd].sort(), [project, project, project])
  for (const flags of spawned.flags) {
    assert.ok(flags.includes("--no-approve"))
    assert.ok(flags.includes("read,grep,find,ls"))
    assert.ok(flags.includes("--no-session"))
    assert.equal(flags.at(-1).includes("COUNCIL PROMPT"), true, "prompt is the final argv element")
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
  await mkdir(join(project, "role-prompts"), { recursive: true })
  const promptPath = join(councilDir, "prompt.md")
  await fsWriteFile(promptPath, "# Council prompt", "utf8")
  for (const sage of ["melchior", "balthasar", "casper"]) {
    await fsWriteFile(join(project, "role-prompts", `${sage}.md`), `You are deliberator-${sage}. Read-only.`, "utf8")
  }
  const results = await runPiCouncil({
    projectRoot: project,
    rolePromptRoot: join(project, "role-prompts"),
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
    childEnv: { MAGI_FAKE_FAIL: "garbage" },
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
  await fsWriteFile(crashBin, [
    "#!/usr/bin/env node",
    "process.stderr.write('boom');process.exit(3)",
  ].join("\n"), { mode: 0o755 })
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
  await fsWriteFile(abortBin, [
    "#!/usr/bin/env node",
    "setInterval(() => {}, 1000)",
  ].join("\n"), { mode: 0o755 })
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

test("runner handles sync-throw spawnFn, async error events, and pre-aborted signals", async () => {
  const syncThrow = await runOnePiChild({
    invocation: { command: "ignored", args: [] },
    args: [], cwd: "/anywhere", promptText: "hi", timeoutMs: 5_000,
    spawnFn: () => { throw new Error("cannot spawn from sync fn") },
  })
  assert.equal(syncThrow.ok, false)
  assert.equal(syncThrow.piFailureType, "spawn_error")
  assert.match(syncThrow.error, /cannot spawn from sync/)
  assert.notEqual(syncThrow.startedAtIso, null)
  assert.notEqual(syncThrow.endedAtIso, null)

  const { EventEmitter } = await import("node:events")
  const asyncError = await runOnePiChild({
    invocation: { command: "ignored", args: [] },
    args: [], cwd: "/x", promptText: "hi", timeoutMs: 5_000,
    spawnFn: () => {
      const fake = new EventEmitter()
      fake.stdout = undefined
      fake.stderr = undefined
      const fakeChild = Object.assign(fake, { kill: () => {}, exitCode: null, killed: false })
      setTimeout(() => fake.emit("error", new Error("cannot spawn from async")), 10)
      return fakeChild
    },
  })
  assert.equal(asyncError.ok, false)
  assert.equal(asyncError.piFailureType, "spawn_error")
  assert.match(asyncError.error, /cannot spawn from async/)

  const preAbortBin = join(await mkdtemp(join(tmpdir(), "magi-pi-preabort-")), "hang-pi")
  await fsWriteFile(preAbortBin, [
    "#!/usr/bin/env node",
    "setInterval(() => {}, 1000)",
  ].join("\n"), { mode: 0o755 })
  const preAborted = new AbortController()
  preAborted.abort()
  const preAbortedRecord = await runOnePiChild({
    invocation: { command: preAbortBin, args: [] },
    args: [], cwd: tmpdir(), promptText: "hi", timeoutMs: 20_000, signal: preAborted.signal,
  })
  assert.equal(preAbortedRecord.aborted, true)
  assert.equal(piEnvelopeFor(preAbortedRecord).nativeType, "aborted")
})

test("model/auth/provider failures classify as model_unavailable, not nonzero_exit", async () => {
  const authDir = await mkdtemp(join(tmpdir(), "magi-pi-auth-"))
  const authBin = join(authDir, "authfail-pi")
  await fsWriteFile(authBin, [
    "#!/usr/bin/env node",
    "process.stderr.write('Error: invalid_api_key (unauthorized 401): provider rejected the credentials');process.exit(3)",
  ].join("\n"), { mode: 0o755 })
  const authRecord = await runOnePiChild({
    invocation: { command: authBin, args: [] },
    args: [], cwd: tmpdir(), promptText: "hi", timeoutMs: 5_000,
  })
  const envelope = piEnvelopeFor(authRecord)
  assert.equal(envelope.status, "hard_error")
  assert.equal(envelope.nativeType, "model_unavailable")
})

import {
  CONTINUE_TEXT_PI, parseQuestionRequest, isQuestionAllowed, questionSha256,
  questionDeniedText, isStaleLock, enforceNoProgressLimit, shouldContinue,
  evaluateSettledAction, expectedCouncilPromptPath, validateCouncilInput,
  currentCouncilRoundArtifacts, readMagiState, writeMagiState,
  createNativeController, consumeCouncilRequest,
} from "../adapters/pi/lib/controller.js"
import { createHash } from "node:crypto"
import { writeFileSync, existsSync, rmSync } from "node:fs"
import { spawn as fsSpawn } from "node:child_process"

test("CONTINUE_TEXT_PI matches the Magi continuation contract", () => {
  assert.match(CONTINUE_TEXT_PI, /^(\[magi\] Continue the active deliberation loop\.[\s\S]*state\.json[\s\S]*Do not ask procedural questions)/)
})

test("parseQuestionRequest and the firewall whitelist produce deny/allow/question decisions", async () => {
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

test("state file without mainModel still dispatches; session metadata carries the model capture", async () => {
  // The shared Fatima workspace carries HERDR_ENV=1; the dispatch test below
  // explicitly exercises the NON-Herdr transport path.
  const herdrOriginal = process.env.HERDR_ENV
  process.env.HERDR_ENV = "0"
  // The state file deliberately holds NO mainModel/mainThinking. Role models
  // must come from the session-local metadata captured in restore(ctx, {...}).
  const calls = { runCalls: 0, seenRoleModels: null, loadedWith: null }
  const pi = fakePi()
  const resolveCalls = []
  // The live state file holds NO mainModel fields at all.
  const project = await mkdtemp(join(tmpdir(), "magi-state-less-"))
  const logDir = join(project, ".open_magi", "magi-log")
  await mkdir(logDir, { recursive: true })
  await writeFile(join(logDir, "state.json"), JSON.stringify({
    active: true, currentRound: 1, currentPhase: "parallel_deliberation",
    currentCouncilMode: "review", maxDeliberationPasses: 3, schemaVersion: 2,
  }), "utf8")
  const modelConfig = {
    loadModelConfig: async (params) => { calls.loadedWith = params; return { ok: true, user: null, project: null } },
    resolveRoleModels: (mainModel, mainThinking, user, project) => {
      resolveCalls.push([mainModel, mainThinking, user, project])
      return {
        melchior: { model: `resolved:${mainModel}:${mainThinking}`, thinking: mainThinking ?? "low" },
        balthasar: { model: "b/f", thinking: "low" },
        casper: { model: "c/f", thinking: "low" },
      }
    },
    userModelConfigPath: () => "/u/open-magi.json",
    projectModelConfigPath: (root) => `${root}/.pi/open-magi.json`,
    writeModelConfig: async () => {},
  }
  const controller = createNativeController({ pi, modelConfig })
  // session_start capture (refresh pattern from Task 8 impl): the Pi API surfaces
  // (pi.getThinkingLevel() + ctx.model) have already delivered the session values.
  await controller.restore({ mode: "tui", cwd: project, model: { id: "provider/main" } }, { mainModel: "provider/m2", thinkingLevel: "high" })
  assert.equal(controller.session.mainModel, "provider/m2")
  assert.equal(controller.session.mainThinking, "high")
  assert.equal(controller.session.projectRoot, project)
  const promptPath = join(project, ".open_magi", "magi-log", "round-001", "review-001", "prompt.md")
  await mkdir(dirname(promptPath), { recursive: true })
  await writeFile(promptPath, "# review prompt", "utf8")
  const outcome = await consumeCouncilRequest(controller, {
    projectRoot: project,
    promptPath,
    round: 1, mode: "review", isProjectTrusted: true,
    runner: (options) => {
      calls.runCalls += 1
      calls.seenRoleModels = options.roleModels
      return { ok: true, halt: false, haltReason: null, hardErrors: [], results: [] }
    },
  })
  assert.equal(outcome.ok, true)
  assert.equal(calls.runCalls, 1)
  assert.equal(resolveCalls.length, 1)
  assert.deepEqual(resolveCalls[0], ["provider/m2", "high", null, null])
  process.env.HERDR_ENV = herdrOriginal
})

test("two controllers keep fully isolated child registries; registerChild removes on close", async () => {
  const { EventEmitter } = await import("node:events")
  const makeFakeChild = () => {
    const child = new EventEmitter()
    child.exitCode = null
    child.killed = false
    child.killedSignals = []
    child.kill = (signal) => {
      child.killedSignals.push(signal)
      if (signal === "SIGTERM") { child.exitCode = 0; child.emit("close", 0) }
    }
    return child
  }
  const modelConfigStub = {}
  const a = createNativeController({ pi: { appendEntry: () => {} }, modelConfig: modelConfigStub })
  const b = createNativeController({ pi: { appendEntry: () => {} }, modelConfig: modelConfigStub })
  const childA = a.registerChild(makeFakeChild())
  assert.equal(a.childRegistry.size, 1)
  assert.equal(b.childRegistry.size, 0, "second controller registry never touched")
  childA.kill("SIGTERM") // close escalation removes it from ONLY controller a's registry
  assert.equal(a.childRegistry.size, 0, "registerChild removes the child when the close event fires")
  assert.equal(b.childRegistry.size, 0)
})

test("shutdown kills and reaps live children; SIGKILL fallback and empty registry resolve", async () => {
  const controller = createNativeController({ pi: { appendEntry: () => {} }, modelConfig: {} })
  // Empty registry: resolves immediately.
  await assert.doesNotReject(() => controller.shutdown())
  const closeDeferrer = {}
  const fake = {
    exitCode: null, killed: false, killedSignals: [],
    kill(signal) { this.killedSignals.push(signal) },
    once(event, fn) { if (event === "close") closeDeferrer.fire = () => { fn(0) } },
  }
  controller.registerChild(fake)
  const promise = controller.shutdown({ killAfterMs: 40 })
  let resolved = false
  promise.then(() => { resolved = true })
  await new Promise((r) => setTimeout(r, 10))
  assert.deepEqual(fake.killedSignals.slice(0, 1), ["SIGTERM"])
  assert.equal(resolved, false, "shutdown must WAIT for the reaped close")
  closeDeferrer.fire()
  await promise
  assert.equal(controller.childRegistry.size, 0)
  // SIGKILL fallback fires after killAfterMs when the child ignores SIGTERM.
  // SIGKILL fallback fires after killAfterMs when the child ignores SIGTERM.
  const stubborn = {
    exitCode: null, killed: false, killedSignals: [], closeListeners: [],
    once(event, fn) { if (event === "close") this.closeListeners.push(fn) },
    kill(signal) { this.killedSignals.push(signal); if (signal === "SIGKILL") { this.exitCode = 137; this.closeListeners.forEach((fn) => fn(137)) } },
  }
  controller.registerChild(stubborn)
  await controller.shutdown({ killAfterMs: 40 })
  assert.ok(stubborn.killedSignals.includes("SIGKILL"), "SIGKILL fallback must fire after killAfterMs")
  assert.equal(controller.childRegistry.size, 0, "stubborn child removed via the SIGKILL close")
})

test("a close-capable child MUST NOT be reaped by a timer: shutdown resolves only on the real close", async () => {
  const { EventEmitter } = await import("node:events")
  const controller = createNativeController({ pi: { appendEntry: () => {} }, modelConfig: {} })
  const child = new EventEmitter()
  child.exitCode = null
  child.killed = false
  child.killedSignals = []
  // A real ChildProcess-compatible fake: supports once and emits close ONLY when the test fires it.
  child.kill = (signal) => child.killedSignals.push(signal)
  const closeFire = {}
  child.once("close", (fn) => { closeFire.fire = fn })
  child.once = ((event, fn) => { if (event === "close") closeDeferrerRegister(child, fn); return EventEmitter.prototype.once.call(child, event, fn) })
  function closeDeferrerRegister(target, fn) { closeFire.fire = () => target.emit("close", 0) }
  controller.registerChild(child)
  const settled = { done: false }
  const shutdownPromise = controller.shutdown({ killAfterMs: 60 })
  shutdownPromise.then(() => { settled.done = true })
  // LONG past BOTH the SIGKILL grace (60ms) and every timer/fallback horizon;
  // resolved-by-grace would have completed shutdown by this point.
  await new Promise((r) => setTimeout(r, 400))
  assert.ok(child.killedSignals.includes("SIGTERM"), "SIGTERM must be sent")
  assert.ok(child.killedSignals.includes("SIGKILL"), "SIGKILL must escalate after killAfterMs")
  assert.equal(settled.done, false, "death by grace-interval NEVER counts as reaping; wait for the real close")
  // THE ACTUAL reap: the test emits close like a real ChildProcess does after SIGKILL.
  closeFire.fire()
  await shutdownPromise
  assert.equal(controller.childRegistry.size, 0, "reap placed on close only")
})

function unusableStubChild() {
  // A fake that genuinely lacks once/on/close semantics (adversarial API stub).
  return { kill() {}, exitCode: null }
}

test("no-progress limit reached: blocked state persists and NOTHING is sent", async () => {
  const project = await mkdtemp(join(tmpdir(), "magi-no-progress-"))
  const logDir = join(project, ".open_magi", "magi-log")
  await mkdir(logDir, { recursive: true })
  await writeFile(join(logDir, "state.json"), JSON.stringify({
    active: true, projectRoot: project, sessionID: "s", currentRound: 1, currentPhase: "synthesis",
    consecutiveNoProgress: 0,
    history: [{ progress: false }, { progress: false }, { progress: false }, { progress: false }, { progress: false }],
  }), "utf8")
  const sent = []
  const pi = { sendUserMessage: async (content) => { sent.push(content) }, appendEntry: () => {} }
  const controller = createNativeController({ pi, modelConfig: null })
  await controller.settled({ mode: "tui", cwd: project, ui: fakeUi({ answers: [] }) })
  assert.equal(sent.length, 0, "no continuation when the no-progress limit fires")
  const blocked = readMagiState(project)
  assert.equal(blocked.active, false)
  assert.equal(blocked.currentPhase, "blocked")
  assert.match(blocked.lastError, /no progress limit reached/)
})

test("approved question shows the true question, sends the answer back, and consumes the artifact", async () => {
  const project = await mkdtemp(join(tmpdir(), "magi-question-"))
  const logDir = join(project, ".open_magi", "magi-log")
  await mkdir(logDir, { recursive: true })
  await writeFile(join(logDir, "state.json"), JSON.stringify({
    active: true, projectRoot: project, sessionID: "s", currentRound: 2, currentPhase: "execution",
    currentDeliberationPass: 2, maxDeliberationPasses: 3, schemaVersion: 2,
  }), "utf8")
  const requestText = "classification: execution_blocker\nquestion: fixture tests/fixture/a.txt was deleted; re-create it?\nphase: execution"
  const requestPath = join(logDir, "question-request.txt")
  await writeFile(requestPath, requestText, "utf8")
  const sent = []
  const uiQuestions = []
  const pi = { sendUserMessage: async (content) => { sent.push(content) }, appendEntry: () => {} }
  const controller = createNativeController({ pi, modelConfig: null })
  const ctx = {
    mode: "tui", cwd: project, ui: fakeUi({ asks: uiQuestions, answers: ["From docs: re-run fixture setup then continue"] }),
  }
  await controller.settled(ctx)
  assert.equal(uiQuestions.length, 1)
  assert.match(uiQuestions[0], /a\.txt was deleted;/)
  assert.equal(sent.length, 1)
  assert.match(sent[0], /question answered by the user: From docs: re-run fixture setup then continue/)
  await assert.rejects(() => readFile(requestPath, "utf8"), /no such file|enoent/i)
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

test("no filesystem state -> restore returns null and does NOT start a loop", async () => {
  const controller = createNativeController({ pi: { appendEntry: () => {} }, modelConfig: null })
  const restore = await controller.restore({ mode: "tui", cwd: "/no-such-project" })
  assert.equal(restore, null)
  assert.equal(controller.state, null)
  assert.equal(controller.session.projectRoot, "/no-such-project")
})

test("registered children are reaped through shutdown; two controllers never interfere", async () => {
  const { EventEmitter } = await import("node:events")
  const controller = createNativeController({ pi: { appendEntry: () => {} }, modelConfig: {} })
  const otherController = createNativeController({ pi: { appendEntry: () => {} }, modelConfig: {} })
  const child = new EventEmitter()
  child.exitCode = null
  child.killed = false
  child.killedSignals = []
  child.kill = (signal) => { child.killedSignals.push(signal); if (signal === "SIGTERM") { child.exitCode = 0; child.emit("close", 0) } }
  controller.registerChild(child)
  assert.equal(controller.childRegistry.size, 1)
  assert.equal(otherController.childRegistry.size, 0)
  await controller.shutdown()
  assert.equal(child.killedSignals[0], "SIGTERM")
  assert.equal(controller.childRegistry.size, 0)
  assert.equal(otherController.childRegistry.size, 0, "shutdown of ONE controller never touches another controller's registry")
})

test("controller lifecycle reads CURRENT filesystem state, never a stale snapshot", async () => {
  const project = await mkdtemp(join(tmpdir(), "magi-ctl-fs-"))
  const logDir = join(project, ".open_magi", "magi-log")
  await mkdir(logDir, { recursive: true })
  const writeStateFile = (state) => writeFileSync(join(logDir, "state.json"), JSON.stringify(state), "utf8")
  const sent = []
  const controller = createNativeController({
    pi: { sendUserMessage: async (content) => { sent.push(content) }, appendEntry: () => {} },
    modelConfig: null,
  })
  // 1) activate on an in-flight decision round: tool_call is phase-blocked.
  writeStateFile({ active: true, projectRoot: project, sessionID: "s", currentRound: 1, currentPhase: "parallel_deliberation", currentCouncilMode: "decision", currentDeliberationPass: 1, maxDeliberationPasses: 3 })
  const guard1 = controller.enforceToolGuard(
    { toolName: "write", input: { file_path: join(project, "src", "a.js") } },
    { mode: "tui", cwd: project, ui: fakeUi() },
  )
  assert.equal(guard1.block, true)
  assert.match(guard1.reason, /phase=parallel_deliberation/)
  // 2) the skill advances the loop on disk; the guard must see the new state without any custom-entry rebind.
  writeStateFile({ active: true, projectRoot: project, sessionID: "s", currentRound: 1, currentPhase: "execution", currentCouncilMode: "decision", currentDeliberationPass: 3, maxDeliberationPasses: 3 })
  await mkdir(join(logDir, "round-001"), { recursive: true })
  await writeFile(join(logDir, "round-001", "verdict.md"), "verdict", "utf8")
  const guard2 = controller.enforceToolGuard(
    { toolName: "write", input: { file_path: join(project, "src", "a.js") } },
    { mode: "tui", cwd: project, ui: fakeUi() },
  )
  assert.equal(guard2.block, false)

  // agent_settled injects the CONTINUE_TEXT_PI continuation over the fresh state.
  await controller.settled({ mode: "tui", cwd: project, ui: fakeUi({ answers: [] }) })
  assert.equal(sent.length, 1)
  assert.match(sent[0], /Continue the active deliberation loop/)

  // 3) question flows: allowed question -> ui.input; denied -> artifact file.
  const deniedWrites = []
  const deniedController = createNativeController({
    pi: { sendUserMessage: async (content) => { sent.push(content) } },
    modelConfig: null,
  })
  writeStateFile({ active: true, projectRoot: project, sessionID: "s", currentRound: 2, currentPhase: "execution", currentCouncilMode: "decision", currentDeliberationPass: 1, maxDeliberationPasses: 3 })
  await mkdir(join(logDir, "round-002", "council-001"), { recursive: true })
  writeFileSync(join(logDir, "question-request.txt"), "classification: procedural\nquestion: should I write the reports?", "utf8")
  await controller.settled({ mode: "tui", cwd: project, ui: { input: async (title) => { deniedWrites.push(title); return undefined }, notify: () => {} } })
  const deniedFile = await readFile(join(logDir, "question-denied.md"), "utf8")
  assert.match(deniedFile, /denied by Magi question firewall/)
  // The approved question path uses ui.input (never a notify masquerade).
  const allowed = parseQuestionRequest("classification: execution_blocker\nquestion: fixture tests/fixture/a.txt was deleted; re-create it?\nphase: execution")
  await mkdir(join(logDir, "round-002"), { recursive: true })
  await assert.doesNotReject(async () => {
    const outcome = await evaluateSettledAction(readMagiState(project), {
      readQuestionRequestImpl: () => allowed,
      existsImpl: () => true,
    })
    assert.equal(outcome.kind, "question")
  })
})

test("artifact repair and false completion produce corrective continuations over fresh state", async () => {
  const project = await mkdtemp(join(tmpdir(), "magi-ctl-repair-"))
  const logDir = join(project, ".open_magi", "magi-log")
  await mkdir(join(logDir, "round-002"), { recursive: true })
  const state = {
    active: true, projectRoot: project, sessionID: "s",
    currentRound: 2, currentPhase: "parallel_deliberation", currentCouncilMode: "decision",
    currentDeliberationPass: 1, maxDeliberationPasses: 3, schemaVersion: 2,
  }
  // missing council reports → artifactRepair case
  const missingArtifacts = await evaluateSettledAction(state, {
    directory: project, readQuestionRequestImpl: async () => null,
    existsImpl: existsSync,
  })
  assert.equal(missingArtifacts.kind, "corrective")
  assert.match(missingArtifacts.text, /missing required artifacts/)
  // false-completion repair: state claims execution but the verdict is NOT on disk.
  const falseDone = { ...state, currentPhase: "execution", currentDeliberationPass: 3, maxDeliberationPasses: 3 }
  assert.equal((await evaluateSettledAction(falseDone, { directory: project, readQuestionRequestImpl: async () => null, existsImpl: existsSync })).kind, "corrective")
  // genuine completion: terminal phase is silent.
  const complete = { ...state, currentPhase: "complete", active: true }
  assert.equal((await evaluateSettledAction(complete, { directory: project, readQuestionRequestImpl: async () => null, existsImpl: existsSync })).kind, "none")
  // stale lock neither continues nor injects a continuation after settle.
  const stale = { ...state, currentPhase: "synthesis", inFlight: true, inFlightSince: new Date(Date.now() - 31 * 60 * 1000).toISOString(), staleLockMs: 30 * 60 * 1000 }
  assert.equal((await evaluateSettledAction(stale, { directory: project, readQuestionRequestImpl: async () => null, existsImpl: existsSync, nowMs: Date.now() })).kind, "none")
})

function fakeUi(options = {}) {
  let index = 0
  const answers = options.answers ?? []
  return {
    notifies: [],
    asks: options.asks ?? [],
    select: async (title) => { (options.selects ?? []).push?.(title); return answers[index++] ?? undefined },
    input: async (title, placeholder) => {
      (options.asks ?? []).push(title)
      // undefined == a cancelled dialog; empty string == "clear this role".
      if (index >= answers.length) { index += 1; return undefined }
      return answers[index] === undefined ? (index += 1, undefined) : answers[index++]
    },
    confirm: async () => answers[index++] === "yes",
    notify: (message, type) => { options.notifies?.push({ message, type }) },
  }
}

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


// ---------- Task 8 extension test seams ----------
function makeFakeType() {
  return {
    Object: (shape, options) => ({ kind: "object", shape, options }),
    Union: (variants) => ({ kind: "union", variants }),
    Literal: (value) => ({ kind: "literal", value }),
    Integer: (options) => ({ kind: "integer", options }),
    String: () => ({ kind: "string" }),
  }
}

function fakeHost() {
  return { getAgentDir: () => "/tmp/fake-agentdir", CONFIG_DIR_NAME: ".pi" }
}

async function loadExtension() {
  const module = await import("../adapters/pi/extension.js")
  assert.equal(typeof module.default, "function")
  const activate = async (pi, overrides = {}) => module.default(pi, {
    host: fakeHost(),
    typebox: makeFakeType(),
    ...overrides,
  })
  return { activate }
}

async function activateControllerForTest({ pi, controllerOverride, modelConfig }) {
  const module = await import("../adapters/pi/extension.js")
  await module.default(pi, {
    host: fakeHost(),
    typebox: makeFakeType(),
    ...(modelConfig ? { modelConfig } : {}),
    controllerOverride,
  })
  return pi.tools[0]
}

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

// Helper that builds a fake modelConfig for the /magi-setup tests.
function magiSetupModelConfigHooks({ writes, current, project }) {
  return {
    loadModelConfig: async () => ({ ok: true, user: { models: current }, project: project ?? null }),
    userModelConfigPath: () => "/u/open-magi.json",
    projectModelConfigPath: (root) => `${root}/.pi/open-magi.json`,
    CONFIG_DIR_NAME: ".pi",
    writeModelConfig: async (targetPath, next, options) => { writes.push({ targetPath, next, options }) },
  }
}

// Task 8 extension wiring tests

test("extension registers /magi, /magi-setup, and magi_council", async () => {
  const { activate } = await loadExtension()
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
  const { activate } = await loadExtension()
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
  const { activate } = await loadExtension()
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
  const { activate } = await loadExtension()
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

test("post-dispatch timeout/hard_error results are RETURNED by execute (not thrown)", async () => {
  const herdrOriginal = process.env.HERDR_ENV
  process.env.HERDR_ENV = "0" // exercise the non-Herdr transport path
  try {
  const { activate } = await loadExtension()
  const pi = fakePi()
  // The runner results carry the standard role reports after either failure;
  // tool must ROUTE the outcome back to gates instead of throwing.
  const runOutcome = {
    ok: false, halt: false, haltReason: null,
    hardErrors: [], results: [
      { sage: "melchior", ok: false, failureType: "timeout", piFailureType: "timeout", exitCode: null, timedOut: true, reportPath: "/p/.open_magi/magi-log/round-001/council-001/report-melchior.md", stderr: "", error: null },
      { sage: "balthasar", ok: false, failureType: "timeout", piFailureType: "timeout", exitCode: null, timedOut: true, reportPath: "/p/report-b", stderr: "", error: null },
      { sage: "casper", ok: false, failureType: "timeout", piFailureType: "timeout", exitCode: null, timedOut: true, reportPath: "/p/.open_magi/magi-log/round-001/council-001/report-casper.md", stderr: "", error: null },
    ],
  }
  const statefulController = {
    modelConfig: magiSetupModelConfigHooks({ writes: [], current: {} }),
    council: async () => runOutcome,
  }
  const tool = await activateControllerForTest({ pi, controllerOverride: statefulController, modelConfig: statefulController.modelConfig })
  const result = await tool.execute("call-5", {
    projectRoot: "/p",
    promptPath: "/p/.open_magi/magi-log/round-001/council-001/prompt.md",
    round: 1, pass: 1, mode: "decision",
  }, undefined, undefined, { mode: "tui", cwd: "/p", isProjectTrusted: () => true, ui: fakeUi() })
  assert.ok(result.content?.[0]?.text?.length > 10, "tool returns the timeout outcome as content")
  assert.equal(result.details.results.length, 3)
  assert.equal(result.details.results.every((entry) => entry.failureType === "timeout"), true)
  } finally {
    process.env.HERDR_ENV = herdrOriginal
  }
})

test("magi-setup pi-setup guard path keeps config use narrowed to the trusted door", async () => {
  const { activate } = await loadExtension()
  const loadCalls = []
  const pi = fakePi()
  await activate(pi, {
    modelConfig: {
      loadModelConfig: async (options) => { loadCalls.push(options); return { ok: true, user: null, project: null } },
      resolveRoleModels: () => null,
      userModelConfigPath: () => "/u/open-magi.json",
      projectModelConfigPath: (root) => `${root}/.pi/open-magi.json`,
      CONFIG_DIR_NAME: ".pi",
      writeModelConfig: async () => {},
    },
  })
  const ui = fakeUi({ answers: ["User scope (getAgentDir()/open-magi.json)", "a/b:low", "b2:low", "c3:low"] })
  const ctx = { mode: "tui", cwd: "/proj", isProjectTrusted: () => false, ui }
  await pi.commands["magi-setup"].handler("", ctx)
  assert.equal(loadCalls.length, 1)
  assert.equal(loadCalls[0].isProjectTrusted, false, "user scope must pass ctx.isProjectTrusted() verbatim")
})

test("magi-setup project scope empty string clears a role (no merge-back)", async () => {
  const { activate } = await loadExtension()
  const writes = []
  const pi = fakePi()
  await activate(pi, {
    modelConfig: magiSetupModelConfigHooks({
      writes, current: { melchior: "old/m1:low", casper: "old/c3:low" }, project: { models: { melchior: "old/m1:low", casper: "old/c3:low" } },
    }),
  })
  const ui = fakeUi({ answers: ["Project scope (.pi/open-magi.json, trusted projects only)", "", "old/b2:low", "old/c3:low"] })
  await pi.commands["magi-setup"].handler("", { mode: "tui", cwd: "/proj", isProjectTrusted: () => true, ui })
  assert.equal(writes[0].options.scope, "project")
  // melchior answered "" -> cleared; balthasar/casper answered non-empty -> preserved; NO merge-back.
  assert.equal(writes[0].next.models.melchior, undefined)
  assert.equal(writes[0].next.models.casper, "old/c3:low")
})

test("magi_council tool is registered with the discriminator schema and throwing execute", async () => {
  const { activate } = await loadExtension()
  const pi = fakePi()
  await activate(pi)
  const tool = pi.tools[0]
  assert.equal(tool.name, "magi_council")
  assert.equal(typeof tool.execute, "function")
  assert.ok(tool.parameters, "TypeBox union schema must be attached")
})

test("magi-setup cancel aborts the whole update without writing", async () => {
  const { activate } = await loadExtension()
  const writes = []
  const notifies = []
  const pi = fakePi()
  await activate(pi, {
    modelConfig: magiSetupModelConfigHooks({ writes, current: { melchior: "old/m1:low" } }),
  })
  // Scope selected ("User scope …"), then the melchior dialog is CANCELLED.
  const notifications = []
  const ui = fakeUi({ answers: ["User scope (getAgentDir()/open-magi.json)", undefined], notifies: notifications })
  await pi.commands["magi-setup"].handler("", { mode: "tui", cwd: "/proj", isProjectTrusted: () => true, ui })
  assert.deepEqual(writes, [])
  // The cancel note reached the UI (not silently swallowed).
  assert.ok(notifications.some((entry) => String(entry?.message ?? entry).includes("cancelled")))
})

test("magi-setup empty string clears a role; untouched roles are preserved from fresh reads", async () => {
  const { activate } = await loadExtension()
  const writes = []
  const pi = fakePi()
  await activate(pi, {
    modelConfig: magiSetupModelConfigHooks({
      writes,
      current: { melchior: "old/m1:low", balthasar: "old/b2:medium" },
    }),
  })
  // melchior: "" clears it; balthasar/ casper pre-filled with the fresh stored
  // value and confirmed unchanged (empty string would ALSO clear them).
  const ui = fakeUi({ answers: ["User scope (getAgentDir()/open-magi.json)", "", "old/b2:low", "old/c3:high"] })
  await pi.commands["magi-setup"].handler("", { mode: "tui", cwd: "/proj", isProjectTrusted: () => true, ui })
  assert.equal(writes.length, 1)
  assert.equal(writes[0].options.scope, "user")
  assert.deepEqual(writes[0].next, {
    version: 1,
    models: { balthasar: "old/b2:low", casper: "old/c3:high" },
  })
})

test("magi-setup replaces one role and preserves the rest from the CURRENT config read", async () => {
  const { activate } = await loadExtension()
  const writes = []
  const pi = fakePi()
  await activate(pi, {
    modelConfig: magiSetupModelConfigHooks({
      writes,
      current: { melchior: "old/m1:low" },
    }),
  })
  const ui = fakeUi({ answers: ["User scope (getAgentDir()/open-magi.json)", "new/m9:high", "old/b2:low", "old/c3:high"] })
  await pi.commands["magi-setup"].handler("", { mode: "tui", cwd: "/proj", isProjectTrusted: () => true, ui })
  // Only melchior changed; balthasar/ casper keep their untouched values.
  assert.deepEqual(writes[0].next.models.melchior, "new/m9:high")
  assert.deepEqual(writes[0].next.models.balthasar, "old/b2:low")
  assert.deepEqual(writes[0].next.models.casper, "old/c3:high")
})

// Helper that builds a fake modelConfig for the /magi-setup tests.
test("magi-setup notify path comes through the real ui object with CONFIG_DIR_NAME from the api", async () => {
  const { activate } = await loadExtension()
  const notifications = []
  const pi = fakePi()
  await activate(pi, {
    modelConfig: magiSetupModelConfigHooks({ writes: [], current: {} }),
  })
  const ui = fakeUi({
    answers: ["User scope (getAgentDir()/open-magi.json)", "a/b:low", "b:low", "c:low"],
    notifies: notifications,
  })
  await pi.commands["magi-setup"].handler("", { mode: "tui", cwd: "/proj", isProjectTrusted: () => true, ui })
  assert.ok(notifications.length >= 1)
  assert.ok(JSON.stringify(notifications).includes("open-magi.json"))
  assert.ok(JSON.stringify(notifications).includes("CONFIG_DIR_NAME=.pi"))
})

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
