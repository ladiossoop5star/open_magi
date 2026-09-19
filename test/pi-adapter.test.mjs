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
