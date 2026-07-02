import assert from "node:assert/strict"
import { execFile as execFileCallback, spawn } from "node:child_process"
import { access, chmod, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises"
import { constants, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"
import test from "node:test"

const repoRoot = fileURLToPath(new URL("../", import.meta.url))
const magiStopHookPath = fileURLToPath(new URL("../adapters/codex/hooks/magi-stop", import.meta.url))
const hanPattern = /\p{Script=Han}/u
const execFile = promisify(execFileCallback)
const chars = (...codes) => String.fromCodePoint(...codes)
const oldExampleModel = ["deepseek", "-spark3/deepseek", "-spark3"].join("")
const localOnlyModel = ["qw", "en"].join("")
const localStatusWarning = ["unavailable", "or", "restarting"].join(" ")
const sharedMagiReferences = [
  "checklist-template.md",
  "deliberation.md",
  "execution-and-verification.md",
  "protocol.md",
  "question-firewall.md",
  "troubleshooting.md",
]
const requiredMagiReferences = [...sharedMagiReferences, "runtime.md"]

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue
    if (/\.sw[pon]$/i.test(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path)))
    } else if (entry.isFile()) {
      files.push(path)
    }
  }
  return files
}

async function readMagiReferences() {
  const entries = await Promise.all(
    requiredMagiReferences.map(async (name) => {
      const text = await readFile(new URL(`../skills/magi/references/${name}`, import.meta.url), "utf8")
      return [name, text]
    }),
  )
  return Object.fromEntries(entries)
}

async function listTrackedFiles() {
  const { stdout } = await execFile("git", ["ls-files"], { cwd: repoRoot })
  const files = []

  for (const rel of stdout.trim().split("\n").filter(Boolean)) {
    try {
      await access(join(repoRoot, rel), constants.F_OK)
      files.push(rel)
    } catch (error) {
      if (error?.code === "ENOENT") continue
      throw error
    }
  }

  return files
}

async function mkTempProject(prefix) {
  return mkdtemp(join(tmpdir(), prefix))
}

function runInteractiveCli(args, input, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [options.script || "bin/open-magi.js", ...args], {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...(options.env || {}) },
    })
    let stdout = ""
    let stderr = ""
    let settled = false
    const timeoutMs = options.timeoutMs ?? 2000
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill("SIGKILL")
      resolve({ code: "timeout", stdout, stderr })
    }, timeoutMs)

    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.on("error", reject)
    child.on("close", (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
    child.stdin.end(input)
  })
}

function rpcFrame(payload) {
  const json = JSON.stringify(payload)
  return `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`
}

function parseRpcFrames(output) {
  const frames = []
  let buffer = Buffer.from(output)
  const delimiter = Buffer.from("\r\n\r\n")

  while (buffer.length) {
    const index = buffer.indexOf(delimiter)
    if (index === -1) break
    const header = buffer.slice(0, index).toString("utf8")
    const length = Number(header.match(/Content-Length:\s*(\d+)/i)?.[1])
    const start = index + delimiter.length
    const end = start + length
    if (!Number.isFinite(length) || buffer.length < end) break
    frames.push(JSON.parse(buffer.slice(start, end).toString("utf8")))
    buffer = buffer.slice(end)
  }

  return frames
}

test("package metadata exposes OpenCode plugin, setup CLI, and injected plugin tests", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
  const cli = await readFile(new URL("../bin/open-magi.js", import.meta.url), "utf8")
  const postinstall = await readFile(new URL("../bin/postinstall.js", import.meta.url), "utf8")
  const setupLib = await readFile(new URL("../lib/setup.js", import.meta.url), "utf8")

  assert.equal(pkg.name, "open-magi-opencode")
  assert.equal(pkg.type, "module")
  assert.equal(pkg.repository.url, "git+https://github.com/ladiossoop5star/open_magi.git")
  assert.equal(pkg.main, "./index.js")
  assert.equal(pkg.exports["."], "./index.js")
  assert.equal(pkg.exports["./setup"], "./lib/setup.js")
  assert.equal(pkg.bin["open-magi"], "bin/open-magi.js")
  assert.equal(pkg.files.includes("README.zh-TW.md"), true)
  assert.equal(pkg.files.includes(".codex-plugin"), false)
  assert.equal(pkg.files.includes(".agents"), false)
  assert.equal(pkg.files.includes("hooks"), false)
  assert.equal(pkg.files.includes("docs/README.codex.md"), false)
  assert.equal(pkg.files.includes("adapters/codex"), false)
  assert.equal(pkg.files.includes("shared"), false)
  assert.doesNotMatch(cli, /setup-codex/)
  assert.match(postinstall, /setupOpenMagi/)
  assert.match(postinstall, /allowDefaultModel: true/)
  assert.doesNotMatch(setupLib, /setupCodexMagi|buildCodexAgentConfig|defaultCodex/)
  assert.equal(pkg.scripts.postinstall, "node bin/postinstall.js")
  assert.equal(pkg.scripts.test, "node --test test/package.test.mjs test/plugin.test.mjs test/setup.test.mjs")
  const suitePath = new URL("./plugin-suite.mjs", import.meta.url)
  const suite = await readFile(suitePath, "utf8")
  const wrapper = await readFile(new URL("./plugin.test.mjs", import.meta.url), "utf8")
  const suiteModule = await import(suitePath.href)

  assert.equal(typeof suiteModule.runPluginTests, "function")
  assert.match(suite, /export\s+async\s+function\s+runPluginTests/)
  assert.doesNotMatch(suite, /\.\.\/index\.js/)
  assert.match(wrapper, /runPluginTests/)
  assert.match(wrapper, /\.\.\/index\.js/)
  assert.doesNotMatch(wrapper, /test\("idle event/)
})

test("Codex plugin manifest exposes the portable magi skill", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
  const codexPkg = JSON.parse(await readFile(new URL("../adapters/codex/package.json", import.meta.url), "utf8"))
  const manifest = JSON.parse(await readFile(new URL("../adapters/codex/.codex-plugin/plugin.json", import.meta.url), "utf8"))
  const mcp = JSON.parse(await readFile(new URL("../adapters/codex/.mcp.json", import.meta.url), "utf8"))

  assert.equal(manifest.name, "open-magi")
  assert.equal(manifest.version, pkg.version)
  assert.equal(codexPkg.name, "open-magi-codex")
  assert.equal(codexPkg.files.includes(".mcp.json"), true)
  assert.equal(codexPkg.files.includes("shared"), false)
  assert.equal(codexPkg.files.includes("../.."), false)
  assert.equal(manifest.repository, "https://github.com/ladiossoop5star/open_magi")
  assert.equal(manifest.homepage, "https://github.com/ladiossoop5star/open_magi#readme")
  assert.equal(manifest.license, "MIT")
  assert.equal(manifest.skills, "./skills/")
  assert.equal(manifest.hooks, undefined)
  assert.equal(manifest.mcpServers, "./.mcp.json")
  assert.equal(manifest.apps, undefined)
  assert.deepEqual(Object.keys(mcp), ["open-magi"])
  assert.equal(mcp["open-magi"].command, "node")
  assert.deepEqual(mcp["open-magi"].args, ["bin/mcp-server.js"])
  assert.equal(mcp["open-magi"].cwd, ".")
  assert.equal(manifest.interface.displayName, "Open Magi")
  assert.equal(manifest.interface.category, "Coding")
  assert.ok(manifest.interface.capabilities.includes("Interactive"))
  assert.ok(manifest.interface.capabilities.includes("Read"))
  assert.ok(manifest.interface.capabilities.includes("Write"))
  assert.ok(manifest.keywords.includes("codex"))
  assert.ok(manifest.keywords.includes("multi-agent"))
  assert.ok(manifest.description.length > 20)
  assert.ok(manifest.interface.shortDescription.length > 20)
  assert.ok(manifest.interface.longDescription.length > manifest.interface.shortDescription.length)
  assert.equal(manifest.interface.defaultPrompt.length, 3)
})

test("Codex MCP server supports Content-Length handshake and exposes run_council", async () => {
  const input = [
    rpcFrame({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      },
    }),
    rpcFrame({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  ].join("")
  const result = await runInteractiveCli([], input, {
    script: "adapters/codex/bin/mcp-server.js",
  })
  const frames = parseRpcFrames(result.stdout)

  assert.equal(result.code, 0, result.stderr)
  assert.equal(frames[0].id, 1)
  assert.equal(frames[0].result.serverInfo.name, "open-magi")
  assert.deepEqual(frames[0].result.capabilities.tools, { listChanged: false })
  assert.equal(frames[1].id, 2)
  assert.deepEqual(frames[1].result.tools.map((tool) => tool.name), ["run_council"])
})

test("Codex marketplace metadata can install this repo as a local development plugin", async () => {
  const marketplace = JSON.parse(await readFile(new URL("../.agents/plugins/marketplace.json", import.meta.url), "utf8"))
  const entry = marketplace.plugins.find((plugin) => plugin.name === "open-magi")

  assert.equal(marketplace.name, "open-magi-dev")
  assert.equal(marketplace.interface.displayName, "Open Magi Dev")
  assert.ok(entry)
  assert.deepEqual(entry.source, { source: "url", url: "./adapters/codex" })
  assert.equal(entry.policy.installation, "AVAILABLE")
  assert.equal(entry.policy.authentication, "ON_INSTALL")
  assert.equal(entry.category, "Developer Tools")
})

test("Codex documentation describes skill-first experimental support", async () => {
  const docs = await readFile(new URL("../adapters/codex/README.md", import.meta.url), "utf8")

  assert.match(docs, /Codex/)
  assert.match(docs, /experimental/i)
  assert.match(docs, /skill-first/i)
  assert.match(docs, /\/goal Use the magi skill/)
  assert.match(docs, /goal tool is available/)
  assert.match(docs, /Stop hook/i)
  assert.match(docs, /Magi loop is still active/)
  assert.match(docs, /setup-codex/)
  assert.match(docs, /`open-magi` is not on PATH/)
  assert.match(docs, /node \/path\/to\/open_magi\/adapters\/codex\/bin\/open-magi\.js setup-codex/)
  assert.match(docs, /--melchior-model/)
  assert.match(docs, /first-use/i)
  assert.match(docs, /~\/\.codex\/agents\/deliberator-melchior\.toml/)
  assert.match(docs, /model = "default-model"/)
  assert.match(docs, /Leave provider unset/)
  assert.match(docs, /custom agents/i)
  assert.match(docs, /MCP/i)
  assert.match(docs, /run-council/)
  assert.match(docs, /custom MCP tools are\s+not exposed to the model/)
  assert.match(docs, /codex exec/i)
  assert.match(docs, /does not overwrite existing/)
  assert.doesNotMatch(docs, /~\/\.codex\/open_magi\/codex\.json/)
  assert.doesNotMatch(docs, /`deliberator-\*\.toml` lookup/)
  assert.match(docs, /codex plugin marketplace add/)
  assert.match(docs, /codex plugin add open-magi@open-magi-dev/)
  assert.match(docs, /\.open_magi\/magi-log/)
  assert.match(docs, /OpenCode runtime backstop/i)
  assert.doesNotMatch(docs, hanPattern)
})

test("Codex Stop hook is bundled and points at the Magi stop checker", async () => {
  const hooks = JSON.parse(await readFile(new URL("../adapters/codex/hooks/hooks.json", import.meta.url), "utf8"))
  const stopHooks = hooks.hooks.Stop?.[0]?.hooks || []
  const commandHook = stopHooks.find((hook) => hook.type === "command")

  assert.ok(commandHook)
  assert.match(commandHook.command, /hooks\/magi-stop/)
  assert.equal(commandHook.timeout, 10)
  assert.match(commandHook.statusMessage, /Magi/)
})

test("Codex Magi Stop hook returns a continuation decision for active loops", async () => {
  const project = await mkTempProject("open-magi-codex-stop-active-")
  const logDir = join(project, ".open_magi", "magi-log")
  await mkdir(logDir, { recursive: true })
  await writeFile(
    join(logDir, "state.json"),
    `${JSON.stringify(
      {
        active: true,
        goal: "finish the migration",
        currentRound: 2,
        currentPhase: "research_task",
        needsContinue: true,
        verificationCommands: ["npm test"],
      },
      null,
      2,
    )}\n`,
  )

  const { stdout } = await execFile(magiStopHookPath, [], { cwd: project })
  const output = JSON.parse(stdout)

  assert.equal(output.decision, "block")
  assert.match(output.reason, /Magi loop is still active/)
  assert.match(output.reason, /currentPhase: research_task/)
  assert.match(output.reason, /currentRound: 2/)
  assert.match(output.reason, /final-report\.md/)
  assert.match(output.reason, /npm test/)
})

test("Codex Magi Stop hook is silent when no Magi loop needs continuation", async () => {
  const project = await mkTempProject("open-magi-codex-stop-silent-")
  const { stdout: noStateStdout } = await execFile(magiStopHookPath, [], { cwd: project })

  const logDir = join(project, ".open_magi", "magi-log")
  await mkdir(logDir, { recursive: true })
  await writeFile(join(logDir, "state.json"), `${JSON.stringify({ active: true, currentRound: 1 })}\n`)
  await writeFile(join(logDir, "final-report.md"), "complete\n")
  const { stdout: finalReportStdout } = await execFile(magiStopHookPath, [], { cwd: project })

  assert.equal(noStateStdout, "")
  assert.equal(finalReportStdout, "")
})

test("Codex Magi Stop hook is disabled inside deliberator subprocesses", async () => {
  const project = await mkTempProject("open-magi-codex-stop-disabled-")
  const logDir = join(project, ".open_magi", "magi-log")
  await mkdir(logDir, { recursive: true })
  await writeFile(join(logDir, "state.json"), `${JSON.stringify({ active: true, currentRound: 1 })}\n`)

  const { stdout } = await execFile(magiStopHookPath, [], {
    cwd: project,
    env: { ...process.env, OPEN_MAGI_DISABLE_STOP_BACKSTOP: "1" },
  })

  assert.equal(stdout, "")
})

test("English README documents install and avoids local-only model warnings", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8")

  assert.match(readme, /\[Traditional Chinese\]\(README\.zh-TW\.md\)/)
  assert.match(readme, /\[Codex experimental notes\]\(adapters\/codex\/README\.md\)/)
  assert.match(readme, /Until the npm package is published, install directly from this public GitHub/)
  assert.match(readme, /opencode plugin open-magi-opencode -g/)
  assert.match(readme, /open-magi setup|npx open-magi-opencode setup/)
  assert.match(readme, /Codex Experimental Notes/)
  assert.match(readme, /packaged separately under `adapters\/codex`/)
  assert.match(readme, /Ask an AI agent to install it/)
  assert.match(readme, /Please install the public OpenCode plugin `open-magi-opencode`/)
  assert.match(readme, /deliberator-melchior/)
  assert.match(readme, /deepseek-v4-flash/)
  assert.match(readme, /Use one shared model for all three deliberators|one\s+shared model for all three deliberators/i)
  assert.match(readme, /--melchior-model model-a/)
  assert.match(readme, /\.open_magi\/magi-log/)
  assert.match(readme, /Development Hygiene/)
  assert.match(readme, /Small changes, documentation edits, and routine debugging may be committed\s+directly on `main`/)
  assert.match(readme, /Use a feature branch for risky or large changes/)
  assert.match(readme, /Adapter-specific config files should live under that coding agent's own config/)
  assert.doesNotMatch(readme, /setup-codex/)
  assert.doesNotMatch(readme, /~\/\.codex\/open_magi\/codex\.json/)
  assert.doesNotMatch(readme, new RegExp(oldExampleModel))
  assert.doesNotMatch(readme, new RegExp(localStatusWarning, "i"))
  assert.doesNotMatch(readme, new RegExp(`--model ${localOnlyModel}`, "i"))
  assert.doesNotMatch(readme, new RegExp("pr" + "ivate", "i"))
})

test("Traditional Chinese README exists for zh-TW users", async () => {
  const readme = await readFile(new URL("../README.zh-TW.md", import.meta.url), "utf8")

  assert.match(readme, hanPattern)
  assert.match(readme, /AI agent/)
  assert.match(readme, /deepseek-v4-flash/)
  assert.match(readme, /\.open_magi\/magi-log/)
  assert.match(readme, new RegExp(chars(0x958b, 0x767c, 0x885b, 0x751f)))
  assert.match(readme, new RegExp(`${chars(0x5c0f, 0x4fee, 0x6539)}[\\s\\S]*debug[\\s\\S]*commit[\\s\\S]*\`main\``))
  assert.match(readme, new RegExp(`${chars(0x9ad8, 0x98a8, 0x96aa, 0x6216, 0x5927, 0x578b, 0x8b8a, 0x66f4)}[\\s\\S]*branch`))
  assert.doesNotMatch(readme, new RegExp(oldExampleModel))
  assert.doesNotMatch(readme, new RegExp(localOnlyModel, "i"))
})

test("bundled magi skill assets contain the expected contract", async () => {
  const skill = await readFile(new URL("../skills/magi/SKILL.md", import.meta.url), "utf8")
  const codexSkill = await readFile(new URL("../adapters/codex/skills/magi/SKILL.md", import.meta.url), "utf8")
  const codexRuntime = await readFile(new URL("../adapters/codex/skills/magi/references/runtime.md", import.meta.url), "utf8")
  const references = await readMagiReferences()
  const contract = [skill, ...Object.values(references)].join("\n")

  assert.match(skill, /^---\nname: magi\n/m)
  assert.match(skill, /start deliberation/)
  assert.match(skill, /Open-Magi/)
  assert.match(skill, /@Open-Magi/)
  assert.match(skill, /coding-agent/)
  assert.doesNotMatch(skill, /Use when.*OpenCode/)
  assert.doesNotMatch(skill, /Codex Bootstrap Gate/)
  assert.doesNotMatch(skill, /setup-codex/)
  assert.doesNotMatch(contract, /Codex|setup-codex|spawn_agent/)
  assert.match(codexSkill, /Codex Bootstrap Gate/)
  assert.match(codexSkill, /If running in Codex and a goal tool is available/)
  assert.match(codexSkill, /~\/\.codex\/agents\/deliberator-melchior\.toml/)
  assert.match(codexSkill, /default-model/)
  assert.match(codexSkill, /plugin's cached `bin\/open-magi\.js` first/)
  assert.match(codexSkill, /Use PATH `open-magi setup-codex` only if no/)
  assert.match(codexSkill, /plugin cache/)
  assert.match(codexRuntime, /run the bundled plugin-cache\s+CLI/)
  assert.match(codexRuntime, /open-magi --help \| grep -q run-council/)
  assert.match(codexSkill, /Do not claim that `\/goal` provides runtime artifact repair/)
  assert.match(references["runtime.md"], /OpenCode Runtime Reference/)
  assert.match(references["runtime.md"], /OpenCode `session\.abort`/)
  assert.doesNotMatch(references["runtime.md"], /setup-codex|spawn_agent/)
  assert.match(codexRuntime, /Codex Runtime Reference/)
  assert.match(codexRuntime, /setup-codex/)
  assert.match(codexRuntime, /spawn_agent/)
  assert.doesNotMatch(codexRuntime, /OpenCode `session\.abort`/)
  assert.match(skill, /\.open_magi\/magi-log/)
  assert.ok(skill.split("\n").length <= 300, "SKILL.md should stay concise and route detail to references")
  assert.ok(Buffer.byteLength(skill, "utf8") <= 14000, "SKILL.md should stay below the main-load context budget")
  assert.doesNotMatch(skill, /\.omo|deliberation-log/)
  assert.doesNotMatch(skill, hanPattern)
  for (const name of requiredMagiReferences) {
    assert.match(skill, new RegExp(`references/${name.replace(".", "\\.")}`), `SKILL.md should route to ${name}`)
    assert.doesNotMatch(references[name], hanPattern, `${name} should not contain Chinese characters`)
  }

  assert.match(contract, /acceptanceCriteria/)
  assert.match(contract, /verificationCommands/)
  assert.match(skill, /Report Integrity Gate/)
  assert.match(contract, /report-melchior\.md/)
  assert.match(contract, /verification\.md/)
  assert.match(contract, /final-report\.md/)
  assert.match(skill, /needsContinue=true/)
  assert.match(skill, /Phase Transition Checklist Gate/)
  assert.match(skill, /\.open_magi\/magi-log\/checklist\.md/)
  assert.match(skill, /Before every phase transition, read/)
  assert.match(contract, /report-melchior\.md/)
  assert.match(skill, /Debug Direction Gate/)
  assert.match(skill, /Direction questions are allowed only during Phase 1/)
  assert.match(skill, /Do not ask the user which debug direction to try next/)
  assert.match(skill, /verification is impossible/)
  assert.match(contract, /failure_diagnostic_commands/)
  assert.match(contract, /Only run these commands after verification fails/)
  assert.match(contract, /Diagnostic evidence from the previous failed round/)
  assert.match(contract, /Phase 5 executes verification and failure diagnostics/)
  assert.match(contract, /Phase 6 only judges pass\/fail/)
  assert.match(skill, /Procedural Autonomy Gate/)
  assert.match(skill, /Before Asking User Gate/)
  assert.match(skill, /Question Request Firewall/)
  assert.match(contract, /question-request\.md/)
  assert.match(contract, /question-denied\.md/)
  assert.match(contract, /consumes `question-request\.md`/)
  assert.match(contract, /default_action_if_denied/)
  assert.match(contract, /missing or unknown `classification` is denied/)
  assert.match(skill, /currentDeliberationPass/)
  assert.match(skill, /maxDeliberationPasses/)
  assert.match(skill, /Council Pass Gate/)
  assert.match(skill, /proposal-first deliberation/)
  assert.match(skill, /main agent prepares an evidence packet/)
  assert.match(skill, /does not propose a fix/)
  assert.match(contract, /proposal pass/)
  assert.match(contract, /direction-selection\.md/)
  assert.match(contract, /review pass/)
  assert.match(contract, /selected direction/)
  assert.match(contract, /Pass 1 is not a veto pass/)
  assert.match(contract, /Pass 2 starts veto review/)
  assert.match(skill, /default `maxDeliberationPasses` is 3/)
  assert.match(skill, /hard maximum is 5/)
  assert.match(skill, /blocking_objection/)
  assert.match(skill, /Do not ask the user whether another council pass is needed/)
  assert.match(skill, /Do not ask procedural questions/)
  assert.match(skill, /whether to write report files/)
  assert.match(skill, /which role each deliberator should play/)
  assert.match(skill, /question_classification/)
  assert.match(skill, /No procedural question was asked/)
  assert.match(skill, /Checkpoint Commit and Rollback Gate/)
  assert.match(contract, /checkpoint_commit_plan/)
  assert.match(skill, /git checkpoint commit/)
  assert.match(skill, /do not stage `\.open_magi\//)
  assert.match(skill, /revert this round's uncommitted code changes/)
  assert.match(contract, /checkpoint_commit/)
  assert.match(skill, /Set `currentPhase=complete`/)
  assert.match(skill, /`progress: true\|false`/)
  assert.match(skill, /Round Transition Gate/)
  assert.match(skill, /currentRound > 1 must never use `goal_definition`/)
  assert.match(skill, /Do not perform extended single-agent debugging/)
  assert.match(contract, /Phase 6: Goal Check/)

  for (const name of ["melchior", "balthasar", "casper"]) {
    const prompt = await readFile(new URL(`../skills/magi/prompts/${name}.md`, import.meta.url), "utf8")
    assert.match(prompt, /## Summary/)
    assert.match(prompt, /## Evidence/)
    assert.match(prompt, /## Risks/)
    assert.match(prompt, /## Recommended Next Action/)
    assert.match(prompt, /## Confidence/)
    assert.match(prompt, /## Blocking Questions/)
    assert.match(prompt, /stance: approve \| oppose \| needs_evidence/)
    assert.match(prompt, /blocking_objection: yes \| no/)
    assert.match(prompt, /proposal pass/)
    assert.match(prompt, /review pass/)
    assert.match(prompt, /direction proposal/)
    assert.match(prompt, /Do not modify files/)
    assert.match(prompt, /Do not ask procedural questions/)
    assert.match(prompt, /whether to write report files/)
    assert.match(prompt, /which role each deliberator should play/)
    assert.match(prompt, /whether another council pass is\s+needed/)
    assert.match(prompt, /answer it yourself/)
    assert.doesNotMatch(prompt, hanPattern)
  }
})

test("shared Magi prompts and common references are identical across adapter skills", async () => {
  for (const name of sharedMagiReferences) {
    const shared = await readFile(new URL(`../shared/magi/references/${name}`, import.meta.url), "utf8")
    const opencode = await readFile(new URL(`../skills/magi/references/${name}`, import.meta.url), "utf8")
    const codex = await readFile(new URL(`../adapters/codex/skills/magi/references/${name}`, import.meta.url), "utf8")

    assert.equal(opencode, shared, `OpenCode ${name} should match shared source`)
    assert.equal(codex, shared, `Codex ${name} should match shared source`)
  }

  const opencodeRuntime = await readFile(new URL("../skills/magi/references/runtime.md", import.meta.url), "utf8")
  const codexRuntime = await readFile(new URL("../adapters/codex/skills/magi/references/runtime.md", import.meta.url), "utf8")

  assert.notEqual(opencodeRuntime, codexRuntime)
  assert.match(opencodeRuntime, /OpenCode Runtime Reference/)
  assert.match(codexRuntime, /Codex Runtime Reference/)
  assert.doesNotMatch(opencodeRuntime, /Codex|setup-codex|spawn_agent/)
  assert.doesNotMatch(codexRuntime, /OpenCode `session\.abort`/)

  for (const name of ["melchior.md", "balthasar.md", "casper.md"]) {
    const shared = await readFile(new URL(`../shared/magi/prompts/${name}`, import.meta.url), "utf8")
    const opencode = await readFile(new URL(`../skills/magi/prompts/${name}`, import.meta.url), "utf8")
    const codex = await readFile(new URL(`../adapters/codex/skills/magi/prompts/${name}`, import.meta.url), "utf8")

    assert.equal(opencode, shared, `OpenCode ${name} should match shared source`)
    assert.equal(codex, shared, `Codex ${name} should match shared source`)
  }
})

test("GitHub Actions CI runs tests and package dry-run", async () => {
  const workflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")

  assert.match(workflow, /node-version:\s*\[20\.x,\s*22\.x\]/)
  assert.match(workflow, /npm test/)
  assert.match(workflow, /npm pack --dry-run/)
})

test("gitignore protects local runtime and scratch artifacts", async () => {
  const ignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8")

  assert.match(ignore, /^\.open_magi\/$/m)
  assert.match(ignore, /^docs\/superpowers\/$/m)
  assert.match(ignore, /^\*\.sw\[pon\]$/m)
  assert.match(ignore, /^\.env$/m)
  assert.match(ignore, /^\.env\.\*$/m)
  assert.match(ignore, /^tmp\/$/m)
})

test("CLI entrypoint exists and is executable", async () => {
  await access(new URL("../bin/open-magi.js", import.meta.url), constants.X_OK)
})

test("CLI setup writes independent OpenCode deliberator models", async () => {
  const configDir = await mkTempProject("open-magi-opencode-cli-independent-")
  const { stdout } = await execFile(
    "node",
    [
      "bin/open-magi.js",
      "setup",
      "--config-dir",
      configDir,
      "--melchior-model",
      "model-a",
      "--balthasar-model",
      "model-b",
      "--casper-model",
      "model-c",
    ],
    { cwd: repoRoot },
  )
  const output = JSON.parse(stdout)
  const cfg = JSON.parse(await readFile(join(configDir, "opencode.json"), "utf8"))

  assert.equal(output.ok, true)
  assert.deepEqual(output.models, {
    melchior: "model-a",
    balthasar: "model-b",
    casper: "model-c",
  })
  assert.equal(cfg.agent["deliberator-melchior"].model, "model-a")
  assert.equal(cfg.agent["deliberator-balthasar"].model, "model-b")
  assert.equal(cfg.agent["deliberator-casper"].model, "model-c")
})

test("CLI setup without model writes an editable OpenCode template", async () => {
  const configDir = await mkTempProject("open-magi-opencode-cli-template-")
  const { stdout } = await execFile(
    "node",
    ["bin/open-magi.js", "setup", "--config-dir", configDir],
    { cwd: repoRoot },
  )
  const cfg = JSON.parse(await readFile(join(configDir, "opencode.json"), "utf8"))

  assert.deepEqual(JSON.parse(stdout).models, {
    melchior: "default-model",
    balthasar: "default-model",
    casper: "default-model",
  })
  assert.equal(cfg.agent["deliberator-melchior"].model, "default-model")
  assert.equal(cfg.agent["deliberator-balthasar"].model, "default-model")
  assert.equal(cfg.agent["deliberator-casper"].model, "default-model")
  assert.equal(cfg.agent["deliberator-melchior"].permission.edit, "deny")
  assert.equal(cfg.agent["deliberator-melchior"].permission.bash, "deny")
})

test("postinstall writes an editable OpenCode template during plugin install", async () => {
  const configDir = await mkTempProject("open-magi-opencode-postinstall-")
  const { stderr } = await execFile("node", ["bin/postinstall.js"], {
    cwd: repoRoot,
    env: { ...process.env, OPENCODE_CONFIG_DIR: configDir },
  })
  const cfg = JSON.parse(await readFile(join(configDir, "opencode.json"), "utf8"))

  assert.match(stderr, /OpenCode template written/)
  assert.equal(cfg.agent["deliberator-melchior"].model, "default-model")
  assert.equal(cfg.agent["deliberator-balthasar"].model, "default-model")
  assert.equal(cfg.agent["deliberator-casper"].model, "default-model")
  assert.equal(cfg.agent["deliberator-melchior"].permission.edit, "deny")
  assert.equal(cfg.agent["deliberator-melchior"].permission.bash, "deny")
  assert.equal(existsSync(join(configDir, "skills", "magi", "SKILL.md")), true)
})

test("CLI setup-codex dry-run reports generated custom agent paths", async () => {
  const agentsDir = await mkTempProject("open-magi-codex-cli-agents-")
  const { stdout } = await execFile(
    "node",
    [
      "adapters/codex/bin/open-magi.js",
      "setup-codex",
      "--agents-dir",
      agentsDir,
      "--provider",
      "litellm",
      "--melchior-model",
      "model-a",
      "--balthasar-model",
      "model-b",
      "--casper-model",
      "model-c",
      "--dry-run",
    ],
    { cwd: repoRoot },
  )
  const output = JSON.parse(stdout)

  assert.equal(output.ok, true)
  assert.equal(output.dryRun, true)
  assert.equal(output.agentsDir, agentsDir)
  assert.equal(output.configPath, undefined)
  assert.equal(output.agentFiles.length, 3)
  assert.deepEqual(output.written, [])
  assert.deepEqual(output.skipped, [])
  assert.match(output.agentFiles.join("\n"), /deliberator-melchior\.toml/)
})

test("Codex postinstall writes editable custom agent templates during plugin install", async () => {
  const agentsDir = await mkTempProject("open-magi-codex-postinstall-")
  const { stderr } = await execFile("node", ["adapters/codex/bin/postinstall.js"], {
    cwd: repoRoot,
    env: { ...process.env, CODEX_AGENTS_DIR: agentsDir },
  })

  assert.match(stderr, /Codex templates written/)
  assert.match(stderr, /Codex MCP config unchanged in source checkout/)
  assert.match(await readFile(join(agentsDir, "deliberator-melchior.toml"), "utf8"), /model = "default-model"/)
  assert.match(await readFile(join(agentsDir, "deliberator-balthasar.toml"), "utf8"), /model = "default-model"/)
  assert.match(await readFile(join(agentsDir, "deliberator-casper.toml"), "utf8"), /model = "default-model"/)
})

test("CLI setup-codex interactive writes custom agent files without long flags", async () => {
  const agentsDir = await mkTempProject("open-magi-codex-cli-interactive-")
  const result = await runInteractiveCli(
    ["setup-codex", "--interactive", "--agents-dir", agentsDir],
    "y\nlitellm\nmodel-a\nmodel-b\nmodel-c\n\ny\n",
    { script: "adapters/codex/bin/open-magi.js" },
  )

  assert.equal(result.code, 0, result.stderr)
  assert.doesNotMatch(result.stdout, /configPath/)
  assert.match(result.stdout, /specific model provider/)
  assert.match(result.stdout, /Melchior model/)
  assert.match(await readFile(join(agentsDir, "deliberator-melchior.toml"), "utf8"), /model = "model-a"/)
  assert.match(await readFile(join(agentsDir, "deliberator-balthasar.toml"), "utf8"), /model = "model-b"/)
  assert.match(await readFile(join(agentsDir, "deliberator-casper.toml"), "utf8"), /model = "model-c"/)
  assert.equal(existsSync(join(agentsDir, "codex.json")), false)
})

test("CLI setup-codex without arguments writes editable templates", async () => {
  const agentsDir = await mkTempProject("open-magi-codex-cli-default-template-")
  const { stdout } = await execFile(
    "node",
    ["adapters/codex/bin/open-magi.js", "setup-codex"],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        CODEX_AGENTS_DIR: agentsDir,
      },
    },
  )
  const output = JSON.parse(stdout)

  assert.equal(output.ok, true)
  assert.equal(output.agentsDir, agentsDir)
  assert.equal(output.configPath, undefined)
  assert.match(await readFile(join(agentsDir, "deliberator-melchior.toml"), "utf8"), /model = "default-model"/)
})

test("CLI setup-codex preserves existing Codex agent files by default", async () => {
  const agentsDir = await mkTempProject("open-magi-codex-cli-preserve-")
  await writeFile(join(agentsDir, "deliberator-casper.toml"), "model = \"user-edited\"\n")
  const { stdout } = await execFile(
    "node",
    [
      "adapters/codex/bin/open-magi.js",
      "setup-codex",
      "--agents-dir",
      agentsDir,
      "--melchior-model",
      "model-a",
      "--balthasar-model",
      "model-b",
      "--casper-model",
      "model-c",
    ],
    { cwd: repoRoot },
  )
  const output = JSON.parse(stdout)
  const melchior = await readFile(join(agentsDir, "deliberator-melchior.toml"), "utf8")

  assert.deepEqual(output.skipped, [join(agentsDir, "deliberator-casper.toml")])
  assert.match(melchior, /model = "model-a"/)
  assert.equal(await readFile(join(agentsDir, "deliberator-casper.toml"), "utf8"), "model = \"user-edited\"\n")
})

test("CLI run-council writes reports through configured Codex subprocesses", async () => {
  const projectRoot = await mkTempProject("open-magi-codex-cli-run-council-")
  const agentsDir = await mkTempProject("open-magi-codex-cli-run-council-agents-")
  const binDir = await mkTempProject("open-magi-codex-cli-run-council-bin-")
  const promptPath = join(projectRoot, ".open_magi", "magi-log", "round-001", "council-001", "prompt.md")
  const fakeCodex = join(binDir, "codex")
  const fakeLog = join(projectRoot, "fake-codex.jsonl")

  await mkdir(join(projectRoot, ".open_magi", "magi-log", "round-001", "council-001"), { recursive: true })
  await writeFile(promptPath, "# Council Prompt\n")
  for (const [sage, model] of [
    ["melchior", "model-a"],
    ["balthasar", "model-b"],
    ["casper", "model-c"],
  ]) {
    await writeFile(
      join(agentsDir, `deliberator-${sage}.toml`),
      [
        `name = "deliberator-${sage}"`,
        `model = "${model}"`,
        'model_provider = "litellm"',
        'sandbox_mode = "read-only"',
        'developer_instructions = """',
        `Role: ${sage}.`,
        '"""',
        "",
      ].join("\n"),
    )
  }
  await writeFile(
    fakeCodex,
    [
      "#!/usr/bin/env node",
      "import { appendFileSync, writeFileSync } from 'node:fs'",
      "const args = process.argv.slice(2)",
      "let stdin = ''",
      "process.stdin.setEncoding('utf8')",
      "process.stdin.on('data', (chunk) => { stdin += chunk })",
      "process.stdin.on('end', () => {",
      "  appendFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify({ args, stdin }) + '\\n')",
      "  const output = args[args.indexOf('-o') + 1]",
      "  writeFileSync(output, 'stance: approve\\nblocking_objection: no\\nrecommended_plan: cli\\nverification_plan: true\\nrisk_level: low\\n')",
      "})",
      "",
    ].join("\n"),
  )
  await chmod(fakeCodex, 0o755)

  const { stdout } = await execFile(
    "node",
    [
      "adapters/codex/bin/open-magi.js",
      "run-council",
      "--project-root",
      projectRoot,
      "--prompt-path",
      promptPath,
      "--round",
      "1",
      "--pass",
      "1",
      "--timeout-ms",
      "2000",
      "--agents-dir",
      agentsDir,
      "--codex-bin",
      fakeCodex,
    ],
    {
      cwd: repoRoot,
      env: { ...process.env, FAKE_CODEX_LOG: fakeLog },
    },
  )
  const output = JSON.parse(stdout)

  assert.equal(output.ok, true)
  assert.equal((await readFile(fakeLog, "utf8")).trim().split("\n").length, 3)
  assert.match(
    await readFile(join(projectRoot, ".open_magi", "magi-log", "round-001", "council-001", "report-melchior.md"), "utf8"),
    /report_source: codex_exec/,
  )
})

test("CLI setup-codex interactive leaves provider unset when user has no custom provider", async () => {
  const agentsDir = await mkTempProject("open-magi-codex-cli-no-provider-")
  const result = await runInteractiveCli(
    ["setup-codex", "--interactive", "--agents-dir", agentsDir],
    "n\nmodel-a\nmodel-b\nmodel-c\n\ny\n",
    { script: "adapters/codex/bin/open-magi.js" },
  )
  const melchior = await readFile(join(agentsDir, "deliberator-melchior.toml"), "utf8")

  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /specific model provider/)
  assert.doesNotMatch(melchior, /model_provider/)
})

test("CLI setup-codex interactive fails without real setup answers", async () => {
  const agentsDir = await mkTempProject("open-magi-codex-cli-empty-interactive-")
  const result = await runInteractiveCli(
    ["setup-codex", "--interactive", "--agents-dir", agentsDir],
    "",
    { script: "adapters/codex/bin/open-magi.js", timeoutMs: 500 },
  )

  assert.notEqual(result.code, "timeout")
  assert.notEqual(result.code, 0)
  assert.match(result.stderr, /interactive setup requires input/i)
  await assert.rejects(() => readFile(join(agentsDir, "deliberator-melchior.toml"), "utf8"))
})

test("only README.zh-TW.md contains Chinese characters", async () => {
  const files = await listFiles(repoRoot)
  const allowed = new Set(["README.zh-TW.md"])

  for (const file of files) {
    const rel = relative(repoRoot, file)
    if (allowed.has(rel)) continue
    const text = await readFile(file, "utf8")
    assert.doesNotMatch(text, hanPattern, `${rel} should not contain Chinese characters`)
  }
})

test("tracked public files avoid local environment markers", async () => {
  const files = await listTrackedFiles()
  const forbidden = [
    [/\/home\//, "home directory path"],
    [/\/opt\//, "local opt path"],
    [new RegExp(`\\b${["pen", "guin"].join("")}\\b`, "i"), "local user name"],
    [new RegExp(`\\b${["ad", "am"].join("")}\\b`, "i"), "local user name"],
    [new RegExp(`\\b${["URI", "AL"].join("")}\\b`, "i"), "local test branch name"],
    [new RegExp(`\\b${["ai", "_test"].join("")}\\b`, "i"), "local test directory"],
    [new RegExp(`\\b${["local", "host"].join("")}\\b`, "i"), "local host name"],
    [/\b127\.0\.0\.1\b/, "loopback address"],
    [/\b192\.168\.\d+\.\d+\b/, "private network address"],
    [/\b10\.\d+\.\d+\.\d+\b/, "private network address"],
    [/\b172\.(1[6-9]|2\d|3[01])\.\d+\.\d+\b/, "private network address"],
  ]

  for (const rel of files) {
    const text = await readFile(join(repoRoot, rel), "utf8")
    for (const [pattern, label] of forbidden) {
      assert.doesNotMatch(text, pattern, `${rel} contains ${label}`)
    }
  }
})
