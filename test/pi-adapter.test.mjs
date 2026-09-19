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
