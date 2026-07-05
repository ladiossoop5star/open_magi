import assert from "node:assert/strict"
import { execFile as execFileCallback } from "node:child_process"
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import test from "node:test"

import {
  DEFAULT_MODEL_SENTINEL,
  DEFAULT_PLUGIN_SPEC,
  buildAgentConfig,
  setupOpenMagi,
} from "../lib/setup.js"
import {
  buildCodexAgentConfig,
  writeCodexMcpConfig,
  setupCodexMagi,
} from "../adapters/codex/lib/setup.js"
import { runCouncil } from "../adapters/codex/lib/codex-runner.js"

const localOnlyModel = ["qw", "en"].join("")
const execFile = promisify(execFileCallback)

test("buildAgentConfig creates three read-only deliberator subagents", () => {
  const agents = buildAgentConfig("deepseek-v4-flash")

  for (const name of ["deliberator-melchior", "deliberator-balthasar", "deliberator-casper"]) {
    assert.equal(agents[name].mode, "subagent")
    assert.equal(agents[name].model, "deepseek-v4-flash")
    assert.equal(agents[name].permission.edit, "deny")
    assert.equal(agents[name].permission.bash, "deny")
    assert.match(agents[name].prompt, /Evidence|Recommended Next Action|Confidence/)
    assert.doesNotMatch(agents[name].prompt, new RegExp(localOnlyModel, "i"))
  }
})

test("buildAgentConfig accepts independent deliberator models", () => {
  const agents = buildAgentConfig({
    melchior: "model-a",
    balthasar: "model-b",
    casper: "model-c",
  })

  assert.equal(agents["deliberator-melchior"].model, "model-a")
  assert.equal(agents["deliberator-balthasar"].model, "model-b")
  assert.equal(agents["deliberator-casper"].model, "model-c")
})

test("buildAgentConfig uses bundled prompt files as the single source of truth", async () => {
  const agents = buildAgentConfig("deepseek-v4-flash")

  for (const name of ["melchior", "balthasar", "casper"]) {
    const agentName = `deliberator-${name}`
    const prompt = await readFile(new URL(`../skills/magi/prompts/${name}.md`, import.meta.url), "utf8")
    assert.equal(agents[agentName].prompt, prompt)
  }
})

test("buildCodexAgentConfig creates three custom agents with independent model settings", () => {
  const agents = buildCodexAgentConfig({
    provider: "litellm",
    melchiorModel: "model-a",
    balthasarModel: "model-b",
    casperModel: "model-c",
    melchiorEffort: "high",
    balthasarEffort: "medium",
    casperEffort: "low",
  })

  assert.deepEqual(Object.keys(agents), [
    "deliberator-melchior.toml",
    "deliberator-balthasar.toml",
    "deliberator-casper.toml",
  ])
  assert.match(agents["deliberator-melchior.toml"], /name = "deliberator-melchior"/)
  assert.match(agents["deliberator-melchior.toml"], /model = "model-a"/)
  assert.match(agents["deliberator-balthasar.toml"], /model = "model-b"/)
  assert.match(agents["deliberator-casper.toml"], /model = "model-c"/)
  assert.match(agents["deliberator-casper.toml"], /model_provider = "litellm"/)
  assert.match(agents["deliberator-melchior.toml"], /model_reasoning_effort = "high"/)
  assert.match(agents["deliberator-balthasar.toml"], /model_reasoning_effort = "medium"/)
  assert.match(agents["deliberator-casper.toml"], /model_reasoning_effort = "low"/)
  assert.match(agents["deliberator-melchior.toml"], /sandbox_mode = "read-only"/)
  assert.match(agents["deliberator-melchior.toml"], /developer_instructions = """/)
  assert.match(agents["deliberator-melchior.toml"], /Evidence|Recommended Next Action|Confidence/)
})

test("buildCodexAgentConfig creates editable Codex templates when models are not provided", () => {
  const agents = buildCodexAgentConfig()

  assert.match(agents["deliberator-melchior.toml"], /model = "default-model"/)
  assert.match(agents["deliberator-balthasar.toml"], /model = "default-model"/)
  assert.match(agents["deliberator-casper.toml"], /model = "default-model"/)
  assert.doesNotMatch(agents["deliberator-melchior.toml"], /model_provider/)
  assert.match(agents["deliberator-melchior.toml"], /Edit model before using Magi/)
})

test("setupCodexMagi writes editable Codex custom agent templates without a config file", async () => {
  const agentsDir = await mkdtemp(join(tmpdir(), "open-magi-codex-agents-"))

  const result = await setupCodexMagi({ agentsDir })

  assert.equal(result.agentsDir, agentsDir)
  assert.equal(result.configPath, undefined)
  assert.equal(result.config, undefined)
  assert.equal(result.dryRun, false)
  assert.deepEqual(result.agentFiles.map((file) => file.name), [
    "deliberator-melchior.toml",
    "deliberator-balthasar.toml",
    "deliberator-casper.toml",
  ])
  assert.deepEqual(result.written.map((file) => file.name), [
    "deliberator-melchior.toml",
    "deliberator-balthasar.toml",
    "deliberator-casper.toml",
  ])
  assert.deepEqual(result.skipped, [])

  const melchior = await readFile(join(agentsDir, "deliberator-melchior.toml"), "utf8")
  const balthasar = await readFile(join(agentsDir, "deliberator-balthasar.toml"), "utf8")
  const casper = await readFile(join(agentsDir, "deliberator-casper.toml"), "utf8")

  assert.match(melchior, /model = "default-model"/)
  assert.match(balthasar, /model = "default-model"/)
  assert.match(casper, /model = "default-model"/)
  assert.doesNotMatch(melchior, /model_provider/)
  assert.match(melchior, /sandbox_mode = "read-only"/)
  assert.match(melchior, /developer_instructions = """/)
  assert.equal(existsSync(join(agentsDir, "codex.json")), false)
  assert.equal(existsSync(join(agentsDir, "open-magi-codex.json")), false)

  await rm(agentsDir, { recursive: true, force: true })
})

test("setupCodexMagi writes concrete Codex custom agent files when models are provided", async () => {
  const agentsDir = await mkdtemp(join(tmpdir(), "open-magi-codex-agents-"))
  const result = await setupCodexMagi({
    agentsDir,
    provider: "litellm",
    melchiorModel: "model-a",
    balthasarModel: "model-b",
    casperModel: "model-c",
  })

  assert.equal(result.agentsDir, agentsDir)
  assert.equal(result.configPath, undefined)
  assert.equal(result.dryRun, false)
  assert.deepEqual(result.agentFiles.map((file) => file.name), [
    "deliberator-melchior.toml",
    "deliberator-balthasar.toml",
    "deliberator-casper.toml",
  ])

  const melchior = await readFile(join(agentsDir, "deliberator-melchior.toml"), "utf8")
  const balthasar = await readFile(join(agentsDir, "deliberator-balthasar.toml"), "utf8")
  const casper = await readFile(join(agentsDir, "deliberator-casper.toml"), "utf8")

  assert.match(melchior, /model = "model-a"/)
  assert.match(balthasar, /model = "model-b"/)
  assert.match(casper, /model = "model-c"/)
  assert.match(casper, /model_provider = "litellm"/)
  assert.equal(existsSync(join(agentsDir, "open-magi-codex.json")), false)

  await rm(agentsDir, { recursive: true, force: true })
})

test("buildClaudePluginFiles creates a skills-dir plugin with concrete deliberator models", async () => {
  const { buildClaudePluginFiles } = await import("../adapters/claude/lib/setup.js")

  const files = buildClaudePluginFiles({
    melchiorModel: "model-a",
    balthasarModel: "model-b",
    casperModel: "model-c",
  })
  const manifest = JSON.parse(files[".claude-plugin/plugin.json"])

  assert.equal(manifest.name, "open-magi")
  assert.equal(manifest.skills, "./skills/")
  assert.equal(manifest.defaultEnabled, true)
  assert.equal(manifest.userConfig, undefined)
  assert.match(files["agents/deliberator-melchior.md"], /^model: model-a$/m)
  assert.match(files["agents/deliberator-balthasar.md"], /^model: model-b$/m)
  assert.match(files["agents/deliberator-casper.md"], /^model: model-c$/m)
  assert.doesNotMatch(files["agents/deliberator-melchior.md"], /\$\{user_config\./)
  assert.match(files["skills/magi/SKILL.md"], /Claude Bootstrap Gate/)
  assert.match(files["hooks/hooks.json"], /magi-stop/)
  assert.match(files["hooks/magi-stop"], /MAGI_STOP_BACKSTOP/)
})

test("buildClaudePluginFiles writes editable Claude templates when models are omitted", async () => {
  const { CLAUDE_DEFAULT_MODEL_SENTINEL, buildClaudePluginFiles } = await import("../adapters/claude/lib/setup.js")

  const files = buildClaudePluginFiles()

  assert.equal(CLAUDE_DEFAULT_MODEL_SENTINEL, "default-model")
  assert.match(files["agents/deliberator-melchior.md"], /^model: default-model$/m)
  assert.match(files["agents/deliberator-balthasar.md"], /^model: default-model$/m)
  assert.match(files["agents/deliberator-casper.md"], /^model: default-model$/m)
  assert.match(files["agents/deliberator-melchior.md"], /Edit model before using Magi/)
})

test("setupClaudeMagi writes a generated Claude skills-dir plugin", async () => {
  const { setupClaudeMagi } = await import("../adapters/claude/lib/setup.js")
  const pluginDir = await mkdtemp(join(tmpdir(), "open-magi-claude-plugin-"))

  const result = await setupClaudeMagi({
    pluginDir,
    melchiorModel: "model-a",
    balthasarModel: "model-b",
    casperModel: "model-c",
  })

  assert.equal(result.pluginDir, pluginDir)
  assert.equal(result.dryRun, false)
  assert.ok(result.files.some((file) => file.name === "agents/deliberator-melchior.md"))
  assert.ok(result.files.some((file) => file.name === "skills/magi/SKILL.md"))
  assert.ok(result.files.some((file) => file.name === "bin/open-magi-claude.js"))
  assert.ok(result.files.some((file) => file.name === "lib/claude-runner.js"))
  assert.ok(result.files.some((file) => file.name === "hooks/magi-stop"))
  assert.match(await readFile(join(pluginDir, ".claude-plugin", "plugin.json"), "utf8"), /"name": "open-magi"/)
  assert.match(await readFile(join(pluginDir, "agents", "deliberator-melchior.md"), "utf8"), /^model: model-a$/m)
  assert.match(await readFile(join(pluginDir, "agents", "deliberator-balthasar.md"), "utf8"), /^model: model-b$/m)
  assert.match(await readFile(join(pluginDir, "agents", "deliberator-casper.md"), "utf8"), /^model: model-c$/m)
  assert.equal(existsSync(join(pluginDir, "skills", "magi", "references", "runtime.md")), true)
  assert.equal(existsSync(join(pluginDir, "lib", "claude-runner.js")), true)
  assert.ok((await stat(join(pluginDir, "bin", "open-magi-claude.js"))).mode & 0o111)
  assert.ok((await stat(join(pluginDir, "hooks", "magi-stop"))).mode & 0o111)

  await rm(pluginDir, { recursive: true, force: true })
})

test("defaultClaudePluginDir uses Claude home skills directory", async () => {
  const { defaultClaudePluginDir } = await import("../adapters/claude/lib/setup.js")

  assert.equal(defaultClaudePluginDir({ CLAUDE_HOME: "/tmp/claude-home" }), join("/tmp/claude-home", "skills", "open-magi"))
  assert.equal(defaultClaudePluginDir({ CLAUDE_SKILLS_DIR: "/tmp/skills" }), join("/tmp/skills", "open-magi"))
})

test("runClaudeCouncil launches three Claude subprocesses concurrently and writes reports", async () => {
  const { runClaudeCouncil } = await import("../adapters/claude/lib/claude-runner.js")
  const projectRoot = await mkdtemp(join(tmpdir(), "open-magi-claude-runner-project-"))
  const pluginDir = await mkdtemp(join(tmpdir(), "open-magi-claude-runner-plugin-"))
  const binDir = await mkdtemp(join(tmpdir(), "open-magi-claude-runner-bin-"))
  const promptPath = join(projectRoot, ".open_magi", "magi-log", "round-001", "council-001", "prompt.md")
  const fakeClaude = join(binDir, "claude")
  const fakeLog = join(projectRoot, "fake-claude-calls.jsonl")

  await mkdir(dirname(promptPath), { recursive: true })
  await mkdir(join(pluginDir, "agents"), { recursive: true })
  await writeFile(promptPath, "# Council Prompt\n\nUse the required report format.\n")
  for (const [sage, model] of [
    ["melchior", "model-a"],
    ["balthasar", "model-b"],
    ["casper", "model-c"],
  ]) {
    await writeFile(
      join(pluginDir, "agents", `deliberator-${sage}.md`),
      `---\nname: deliberator-${sage}\nmodel: ${model}\ntools: ["Read", "Grep", "Glob"]\n---\n\nRole ${sage}\n`,
    )
  }
  await writeFile(
    fakeClaude,
    [
      "#!/usr/bin/env node",
      "import { appendFileSync } from 'node:fs'",
      "const args = process.argv.slice(2)",
      "const model = args[args.indexOf('--model') + 1]",
      "const startedAt = Date.now()",
      "let prompt = args[args.length - 1] || ''",
      "appendFileSync(process.env.OPEN_MAGI_FAKE_LOG, JSON.stringify({ event: 'start', model, startedAt, args, prompt }) + '\\n')",
      "setTimeout(() => {",
      "  const endedAt = Date.now()",
      "  appendFileSync(process.env.OPEN_MAGI_FAKE_LOG, JSON.stringify({ event: 'end', model, endedAt }) + '\\n')",
      "  console.log(`stance: approve\\nblocking_objection: no\\nrecommended_plan: fake ${model}\\nverification_plan: true\\nrisk_level: low\\n\\n## Summary\\nFake Claude report for ${model}.`)",
      "}, 120)",
      "",
    ].join("\n"),
  )
  await chmod(fakeClaude, 0o755)

  const result = await runClaudeCouncil({
    projectRoot,
    promptPath,
    round: 1,
    pass: 1,
    pluginDir,
    claudeBin: fakeClaude,
    timeoutMs: 2000,
    env: { OPEN_MAGI_FAKE_LOG: fakeLog },
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.results.map((entry) => entry.agent), [
    "open-magi:deliberator-melchior",
    "open-magi:deliberator-balthasar",
    "open-magi:deliberator-casper",
  ])
  assert.deepEqual(result.results.map((entry) => entry.model), ["model-a", "model-b", "model-c"])
  assert.ok(result.results.every((entry) => Number.isInteger(entry.startedAt)))
  assert.ok(result.results.every((entry) => Number.isInteger(entry.endedAt)))
  assert.ok(result.results.every((entry) => Number.isInteger(entry.durationMs)))
  assert.ok(Math.max(...result.results.map((entry) => entry.startedAt)) < Math.min(...result.results.map((entry) => entry.endedAt)))

  for (const [sage, model] of [
    ["melchior", "model-a"],
    ["balthasar", "model-b"],
    ["casper", "model-c"],
  ]) {
    const report = await readFile(
      join(projectRoot, ".open_magi", "magi-log", "round-001", "council-001", `report-${sage}.md`),
      "utf8",
    )
    assert.match(report, /report_source: claude_headless/)
    assert.match(report, new RegExp(`model: ${model}`))
    assert.match(report, /claude_exit_code: 0/)
    assert.match(report, /claude_started_at: \d+/)
    assert.match(report, /claude_ended_at: \d+/)
    assert.match(report, /claude_duration_ms: \d+/)
    assert.match(report, new RegExp(`Fake Claude report for ${model}`))
  }

  const calls = (await readFile(fakeLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line))
  const starts = calls.filter((call) => call.event === "start")
  const ends = calls.filter((call) => call.event === "end")
  assert.equal(starts.length, 3)
  assert.equal(ends.length, 3)
  assert.ok(starts.every((call) => call.args.includes("-p")))
  assert.ok(starts.every((call) => call.args.includes("--allowedTools")))
  assert.ok(starts.every((call) => call.prompt.includes("REPORT OUTPUT REQUIREMENTS")))
  assert.ok(Math.max(...starts.map((call) => call.startedAt)) < Math.min(...ends.map((call) => call.endedAt)))

  await rm(projectRoot, { recursive: true, force: true })
  await rm(pluginDir, { recursive: true, force: true })
  await rm(binDir, { recursive: true, force: true })
})

test("Claude setup CLI run-council writes reports through the headless runner", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "open-magi-claude-cli-project-"))
  const pluginDir = await mkdtemp(join(tmpdir(), "open-magi-claude-cli-plugin-"))
  const binDir = await mkdtemp(join(tmpdir(), "open-magi-claude-cli-bin-"))
  const promptPath = join(projectRoot, ".open_magi", "magi-log", "round-001", "council-001", "prompt.md")
  const fakeClaude = join(binDir, "claude")

  await mkdir(dirname(promptPath), { recursive: true })
  await mkdir(join(pluginDir, "agents"), { recursive: true })
  await writeFile(promptPath, "# Council Prompt\n")
  for (const [sage, model] of [
    ["melchior", "model-a"],
    ["balthasar", "model-b"],
    ["casper", "model-c"],
  ]) {
    await writeFile(join(pluginDir, "agents", `deliberator-${sage}.md`), `---\nname: deliberator-${sage}\nmodel: ${model}\n---\n`)
  }
  await writeFile(
    fakeClaude,
    [
      "#!/usr/bin/env node",
      "const args = process.argv.slice(2)",
      "const model = args[args.indexOf('--model') + 1]",
      "console.log(`stance: approve\\nblocking_objection: no\\nrecommended_plan: ${model}\\nverification_plan: true\\nrisk_level: low\\n`)",
      "",
    ].join("\n"),
  )
  await chmod(fakeClaude, 0o755)

  const cli = await execFile(
    "node",
    [
      fileURLToPath(new URL("../adapters/claude/bin/open-magi-claude.js", import.meta.url)),
      "run-council",
      "--project-root",
      projectRoot,
      "--prompt-path",
      promptPath,
      "--round",
      "1",
      "--pass",
      "1",
      "--plugin-dir",
      pluginDir,
      "--claude-bin",
      fakeClaude,
      "--timeout-ms",
      "2000",
    ],
    { cwd: fileURLToPath(new URL("../", import.meta.url)) },
  )
  const payload = JSON.parse(cli.stdout)

  assert.equal(payload.ok, true)
  assert.equal(payload.results.length, 3)
  assert.deepEqual(payload.results.map((entry) => entry.model), ["model-a", "model-b", "model-c"])
  assert.ok(payload.results.every((entry) => Number.isInteger(entry.startedAt)))
  assert.ok(Math.max(...payload.results.map((entry) => entry.startedAt)) < Math.min(...payload.results.map((entry) => entry.endedAt)))
  assert.equal(existsSync(join(projectRoot, ".open_magi", "magi-log", "round-001", "council-001", "report-casper.md")), true)

  await rm(projectRoot, { recursive: true, force: true })
  await rm(pluginDir, { recursive: true, force: true })
  await rm(binDir, { recursive: true, force: true })
})

test("setupCodexMagi preserves existing Codex agent files by default", async () => {
  const agentsDir = await mkdtemp(join(tmpdir(), "open-magi-codex-existing-"))
  await writeFile(join(agentsDir, "deliberator-casper.toml"), "model = \"user-edited\"\n")

  const result = await setupCodexMagi({ agentsDir })

  assert.equal(result.agentsDir, agentsDir)
  assert.deepEqual(result.skipped.map((file) => file.name), ["deliberator-casper.toml"])
  assert.deepEqual(result.written.map((file) => file.name), [
    "deliberator-melchior.toml",
    "deliberator-balthasar.toml",
  ])
  assert.match(await readFile(join(agentsDir, "deliberator-melchior.toml"), "utf8"), /model = "default-model"/)
  assert.match(await readFile(join(agentsDir, "deliberator-balthasar.toml"), "utf8"), /model = "default-model"/)
  assert.equal(await readFile(join(agentsDir, "deliberator-casper.toml"), "utf8"), "model = \"user-edited\"\n")

  await rm(agentsDir, { recursive: true, force: true })
})

test("writeCodexMcpConfig pins the MCP server cwd to the installed package root", async () => {
  const packageRoot = await mkdtemp(join(tmpdir(), "open-magi-codex-package-"))
  const result = await writeCodexMcpConfig({ packageRoot })
  const config = JSON.parse(await readFile(join(packageRoot, ".mcp.json"), "utf8"))

  assert.equal(result.path, join(packageRoot, ".mcp.json"))
  assert.deepEqual(config["open-magi"], {
    command: "node",
    args: ["bin/mcp-server.js"],
    cwd: packageRoot,
  })

  await rm(packageRoot, { recursive: true, force: true })
})

test("runCouncil launches three Codex subprocesses from agent TOML and writes provenance reports", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "open-magi-codex-runner-project-"))
  const agentsDir = await mkdtemp(join(tmpdir(), "open-magi-codex-runner-agents-"))
  const binDir = await mkdtemp(join(tmpdir(), "open-magi-codex-runner-bin-"))
  const promptPath = join(projectRoot, ".open_magi", "magi-log", "round-001", "council-001", "prompt.md")
  const fakeLog = join(projectRoot, "fake-codex-calls.jsonl")
  const fakeCodex = join(binDir, "codex")

  await mkdir(join(projectRoot, ".open_magi", "magi-log", "round-001", "council-001"), { recursive: true })
  await writeFile(promptPath, "# Council Prompt\n\nUse the required report format.\n")
  const agents = buildCodexAgentConfig({
    provider: "litellm",
    melchiorModel: "model-a",
    balthasarModel: "model-b",
    casperModel: "model-c",
    melchiorEffort: "high",
  })
  for (const [name, content] of Object.entries(agents)) {
    await writeFile(join(agentsDir, name), content)
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
      "  appendFileSync(process.env.OPEN_MAGI_FAKE_LOG, JSON.stringify({ args, stdin, stopBackstop: process.env.OPEN_MAGI_DISABLE_STOP_BACKSTOP }) + '\\n')",
      "  const outputIndex = args.indexOf('-o')",
      "  const output = outputIndex >= 0 ? args[outputIndex + 1] : args[args.indexOf('--output-last-message') + 1]",
      "  writeFileSync(output, 'stance: approve\\nblocking_objection: no\\nrecommended_plan: fake report\\nverification_plan: true\\nrisk_level: low\\n\\n## Summary\\nFake Codex subprocess report.\\n')",
      "})",
      "",
    ].join("\n"),
  )
  await chmod(fakeCodex, 0o755)

  const result = await runCouncil({
    projectRoot,
    promptPath,
    round: 1,
    pass: 1,
    agentsDir,
    codexBin: fakeCodex,
    timeoutMs: 2000,
    env: { OPEN_MAGI_FAKE_LOG: fakeLog },
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.results.map((entry) => entry.agent), [
    "deliberator-melchior",
    "deliberator-balthasar",
    "deliberator-casper",
  ])

  for (const [sage, model] of [
    ["melchior", "model-a"],
    ["balthasar", "model-b"],
    ["casper", "model-c"],
  ]) {
    const report = await readFile(
      join(projectRoot, ".open_magi", "magi-log", "round-001", "council-001", `report-${sage}.md`),
      "utf8",
    )
    assert.match(report, /report_source: codex_exec/)
    assert.match(report, new RegExp(`model: ${model}`))
    assert.match(report, /model_provider: litellm/)
    assert.match(report, /codex_exit_code: 0/)
    assert.match(report, /Fake Codex subprocess report/)
  }

  const calls = (await readFile(fakeLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line))
  assert.equal(calls.length, 3)
  assert.ok(calls.every((call) => call.args.includes("exec")))
  assert.ok(calls.every((call) => call.args.includes("--sandbox") && call.args.includes("read-only")))
  assert.ok(calls.every((call) => call.args.some((arg) => arg.includes('model_provider="litellm"'))))
  assert.ok(calls.every((call) => call.stopBackstop === "1"))
  assert.ok(calls.some((call) => call.args.includes("model-a")))
  assert.ok(calls.some((call) => call.args.includes("model-b")))
  assert.ok(calls.some((call) => call.args.includes("model-c")))
  assert.ok(calls.every((call) => call.stdin.includes("REPORT OUTPUT REQUIREMENTS")))

  await rm(projectRoot, { recursive: true, force: true })
  await rm(agentsDir, { recursive: true, force: true })
  await rm(binDir, { recursive: true, force: true })
})

test("runCouncil writes failure provenance reports when a Codex subprocess fails", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "open-magi-codex-runner-fail-project-"))
  const agentsDir = await mkdtemp(join(tmpdir(), "open-magi-codex-runner-fail-agents-"))
  const binDir = await mkdtemp(join(tmpdir(), "open-magi-codex-runner-fail-bin-"))
  const promptPath = join(projectRoot, ".open_magi", "magi-log", "round-001", "council-001", "prompt.md")
  const fakeCodex = join(binDir, "codex")

  await mkdir(join(projectRoot, ".open_magi", "magi-log", "round-001", "council-001"), { recursive: true })
  await writeFile(promptPath, "# Council Prompt\n\nUse the required report format.\n")
  const agents = buildCodexAgentConfig({
    provider: "litellm",
    melchiorModel: "model-a",
    balthasarModel: "model-b",
    casperModel: "model-c",
  })
  for (const [name, content] of Object.entries(agents)) {
    await writeFile(join(agentsDir, name), content)
  }
  await writeFile(
    fakeCodex,
    [
      "#!/usr/bin/env node",
      "import { writeFileSync } from 'node:fs'",
      "const args = process.argv.slice(2)",
      "const output = args[args.indexOf('-o') + 1]",
      "const model = args[args.indexOf('--model') + 1]",
      "process.stdin.resume()",
      "process.stdin.on('end', () => {",
      "  if (model === 'model-c') {",
      "    console.error('casper failed in fake codex')",
      "    process.exitCode = 7",
      "    return",
      "  }",
      "  writeFileSync(output, 'stance: approve\\nblocking_objection: no\\nrecommended_plan: fake report\\nverification_plan: true\\nrisk_level: low\\n')",
      "})",
      "",
    ].join("\n"),
  )
  await chmod(fakeCodex, 0o755)

  const result = await runCouncil({
    projectRoot,
    promptPath,
    round: 1,
    pass: 1,
    agentsDir,
    codexBin: fakeCodex,
    timeoutMs: 2000,
  })

  assert.equal(result.ok, false)
  assert.equal(result.halt, true)
  assert.equal(result.haltReason, "hard_error")
  assert.deepEqual(result.hardErrors.map((entry) => entry.sage), ["casper"])
  assert.equal(result.results.find((entry) => entry.sage === "casper").ok, false)
  assert.equal(result.results.find((entry) => entry.sage === "casper").failureType, "hard_error")
  assert.equal(result.results.find((entry) => entry.sage === "casper").exitCode, 7)

  const melchior = await readFile(
    join(projectRoot, ".open_magi", "magi-log", "round-001", "council-001", "report-melchior.md"),
    "utf8",
  )
  const balthasar = await readFile(
    join(projectRoot, ".open_magi", "magi-log", "round-001", "council-001", "report-balthasar.md"),
    "utf8",
  )
  const casper = await readFile(
    join(projectRoot, ".open_magi", "magi-log", "round-001", "council-001", "report-casper.md"),
    "utf8",
  )

  assert.match(melchior, /report_source: codex_exec/)
  assert.match(balthasar, /report_source: codex_exec/)
  assert.match(casper, /report_source: codex_exec_failed/)
  assert.match(casper, /status: hard_error/)
  assert.match(casper, /failure_type: hard_error/)
  assert.match(casper, /codex_exit_code: 7/)
  assert.match(casper, /casper failed in fake codex/)

  await rm(projectRoot, { recursive: true, force: true })
  await rm(agentsDir, { recursive: true, force: true })
  await rm(binDir, { recursive: true, force: true })
})

test("runCouncil survives a deliberator that exits before draining a large prompt", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "open-magi-epipe-project-"))
  const agentsDir = await mkdtemp(join(tmpdir(), "open-magi-epipe-agents-"))
  const binDir = await mkdtemp(join(tmpdir(), "open-magi-epipe-bin-"))
  const promptPath = join(projectRoot, ".open_magi", "magi-log", "round-001", "council-001", "prompt.md")
  const fakeCodex = join(binDir, "codex")

  await mkdir(dirname(promptPath), { recursive: true })
  await writeFile(promptPath, "P".repeat(2 * 1024 * 1024))
  for (const [sage, model] of [
    ["melchior", "model-a"],
    ["balthasar", "model-b"],
    ["casper", "model-c"],
  ]) {
    await writeFile(join(agentsDir, `deliberator-${sage}.toml`), `name = "deliberator-${sage}"\nmodel = "${model}"\n`)
  }
  await writeFile(fakeCodex, "#!/usr/bin/env node\nprocess.exit(1)\n")
  await chmod(fakeCodex, 0o755)

  const result = await runCouncil({
    projectRoot,
    promptPath,
    round: 1,
    pass: 1,
    agentsDir,
    codexBin: fakeCodex,
    timeoutMs: 5000,
  })

  assert.equal(result.ok, false)
  assert.equal(result.halt, true)
  assert.equal(result.haltReason, "hard_error")
  assert.equal(result.hardErrors.length, 3)
  assert.deepEqual(result.results.map((entry) => entry.ok), [false, false, false])
  assert.deepEqual(result.results.map((entry) => entry.failureType), ["hard_error", "hard_error", "hard_error"])
  for (const sage of ["melchior", "balthasar", "casper"]) {
    const report = await readFile(
      join(projectRoot, ".open_magi", "magi-log", "round-001", "council-001", `report-${sage}.md`),
      "utf8",
    )
    assert.match(report, /report_source: codex_exec_failed/)
    assert.match(report, /status: hard_error/)
    assert.match(report, /failure_type: hard_error/)
  }

  await rm(projectRoot, { recursive: true, force: true })
  await rm(agentsDir, { recursive: true, force: true })
  await rm(binDir, { recursive: true, force: true })
})

test("runCouncil classifies subprocess timeout separately from hard errors", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "open-magi-codex-timeout-project-"))
  const agentsDir = await mkdtemp(join(tmpdir(), "open-magi-codex-timeout-agents-"))
  const binDir = await mkdtemp(join(tmpdir(), "open-magi-codex-timeout-bin-"))
  const promptPath = join(projectRoot, ".open_magi", "magi-log", "round-001", "council-001", "prompt.md")
  const fakeCodex = join(binDir, "codex")

  await mkdir(dirname(promptPath), { recursive: true })
  await writeFile(promptPath, "# Council Prompt\n")
  for (const [sage, model] of [
    ["melchior", "model-a"],
    ["balthasar", "model-b"],
    ["casper", "model-c"],
  ]) {
    await writeFile(join(agentsDir, `deliberator-${sage}.toml`), `name = "deliberator-${sage}"\nmodel = "${model}"\n`)
  }
  await writeFile(
    fakeCodex,
    [
      "#!/usr/bin/env node",
      "setTimeout(() => {}, 10000)",
      "process.stdin.resume()",
      "",
    ].join("\n"),
  )
  await chmod(fakeCodex, 0o755)

  const result = await runCouncil({
    projectRoot,
    promptPath,
    round: 1,
    pass: 1,
    agentsDir,
    codexBin: fakeCodex,
    timeoutMs: 20,
  })

  assert.equal(result.ok, false)
  assert.equal(result.halt, false)
  assert.equal(result.haltReason, null)
  assert.deepEqual(result.results.map((entry) => entry.failureType), ["timeout", "timeout", "timeout"])
  for (const sage of ["melchior", "balthasar", "casper"]) {
    const report = await readFile(
      join(projectRoot, ".open_magi", "magi-log", "round-001", "council-001", `report-${sage}.md`),
      "utf8",
    )
    assert.match(report, /status: timeout/)
    assert.match(report, /failure_type: timeout/)
    assert.match(report, /codex_timed_out: true/)
  }

  await rm(projectRoot, { recursive: true, force: true })
  await rm(agentsDir, { recursive: true, force: true })
  await rm(binDir, { recursive: true, force: true })
})

test("runCouncil rejects unsupported Codex sandbox modes before spawning subprocesses", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "open-magi-sandbox-invalid-project-"))
  const agentsDir = await mkdtemp(join(tmpdir(), "open-magi-sandbox-invalid-agents-"))
  const promptPath = join(projectRoot, ".open_magi", "magi-log", "round-001", "council-001", "prompt.md")

  await mkdir(dirname(promptPath), { recursive: true })
  await writeFile(promptPath, "# Council Prompt\n")
  for (const sage of ["melchior", "balthasar", "casper"]) {
    await writeFile(
      join(agentsDir, `deliberator-${sage}.toml`),
      [
        `name = "deliberator-${sage}"`,
        `model = "model-${sage}"`,
        'sandbox_mode = "network-admin"',
        "",
      ].join("\n"),
    )
  }

  await assert.rejects(
    () => runCouncil({ projectRoot, promptPath, round: 1, pass: 1, agentsDir, codexBin: "codex" }),
    /unsupported sandbox_mode "network-admin"/,
  )

  await rm(projectRoot, { recursive: true, force: true })
  await rm(agentsDir, { recursive: true, force: true })
})

test("runCouncil requires explicit opt-in for danger-full-access sandbox mode", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "open-magi-sandbox-full-project-"))
  const agentsDir = await mkdtemp(join(tmpdir(), "open-magi-sandbox-full-agents-"))
  const binDir = await mkdtemp(join(tmpdir(), "open-magi-sandbox-full-bin-"))
  const promptPath = join(projectRoot, ".open_magi", "magi-log", "round-001", "council-001", "prompt.md")
  const fakeCodex = join(binDir, "codex")
  const fakeLog = join(projectRoot, "fake-codex.jsonl")

  await mkdir(dirname(promptPath), { recursive: true })
  await writeFile(promptPath, "# Council Prompt\n")
  for (const sage of ["melchior", "balthasar", "casper"]) {
    await writeFile(
      join(agentsDir, `deliberator-${sage}.toml`),
      [
        `name = "deliberator-${sage}"`,
        `model = "model-${sage}"`,
        'sandbox_mode = "danger-full-access"',
        "",
      ].join("\n"),
    )
  }

  await assert.rejects(
    () => runCouncil({ projectRoot, promptPath, round: 1, pass: 1, agentsDir, codexBin: fakeCodex }),
    /OPEN_MAGI_ALLOW_FULL_ACCESS=1/,
  )

  await writeFile(
    fakeCodex,
    [
      "#!/usr/bin/env node",
      "import { appendFileSync, writeFileSync } from 'node:fs'",
      "const args = process.argv.slice(2)",
      "process.stdin.resume()",
      "process.stdin.on('end', () => {",
      "  appendFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify({ args }) + '\\n')",
      "  writeFileSync(args[args.indexOf('-o') + 1], 'stance: approve\\nblocking_objection: no\\nrecommended_plan: ok\\nverification_plan: true\\nrisk_level: low\\n')",
      "})",
      "",
    ].join("\n"),
  )
  await chmod(fakeCodex, 0o755)

  const result = await runCouncil({
    projectRoot,
    promptPath,
    round: 1,
    pass: 1,
    agentsDir,
    codexBin: fakeCodex,
    timeoutMs: 2000,
    env: { OPEN_MAGI_ALLOW_FULL_ACCESS: "1", FAKE_CODEX_LOG: fakeLog },
  })
  const calls = (await readFile(fakeLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line))

  assert.equal(result.ok, true)
  assert.equal(calls.length, 3)
  assert.ok(calls.every((call) => call.args.includes("--sandbox") && call.args.includes("danger-full-access")))

  await rm(projectRoot, { recursive: true, force: true })
  await rm(agentsDir, { recursive: true, force: true })
  await rm(binDir, { recursive: true, force: true })
})

test("setupOpenMagi merges config and copies the magi skill", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "open-magi-setup-"))
  const configPath = join(configDir, "opencode.json")
  const staleReferenceDir = join(configDir, "skills", "magi", "references")
  await mkdir(staleReferenceDir, { recursive: true })
  await writeFile(join(staleReferenceDir, "setup.md"), "obsolete setup reference\n")

  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        "$schema": "https://opencode.ai/config.json",
        provider: {
          existing: {
            npm: "@ai-sdk/openai-compatible",
          },
        },
        plugin: ["existing-plugin"],
        agent: {
          existingAgent: {
            mode: "primary",
          },
        },
      },
      null,
      2,
    )}\n`,
  )

  const result = await setupOpenMagi({
    configDir,
    model: "deepseek-v4-flash",
    pluginSpec: "open-magi-opencode",
  })

  assert.equal(result.configPath, configPath)
  assert.equal(result.model, "deepseek-v4-flash")
  assert.equal(result.pluginSpec, "open-magi-opencode")
  assert.equal(result.dryRun, false)

  const cfg = JSON.parse(await readFile(configPath, "utf8"))
  assert.equal(cfg.provider.existing.npm, "@ai-sdk/openai-compatible")
  assert.equal(cfg.agent.existingAgent.mode, "primary")
  assert.equal(cfg.plugin.includes("existing-plugin"), true)
  assert.equal(cfg.plugin.includes("open-magi-opencode"), true)

  for (const name of ["deliberator-melchior", "deliberator-balthasar", "deliberator-casper"]) {
    assert.equal(cfg.agent[name].mode, "subagent")
    assert.equal(cfg.agent[name].model, "deepseek-v4-flash")
    assert.equal(cfg.agent[name].permission.edit, "deny")
    assert.equal(cfg.agent[name].permission.bash, "deny")
  }

  const skillPath = join(configDir, "skills", "magi", "SKILL.md")
  assert.equal(existsSync(skillPath), true)
  assert.match(await readFile(skillPath, "utf8"), /^---\nname: magi\n/m)
  assert.equal(existsSync(join(configDir, "skills", "magi", "prompts", "melchior.md")), true)
  assert.equal(existsSync(join(configDir, "skills", "magi", "references", "protocol.md")), true)
  assert.equal(existsSync(join(configDir, "skills", "magi", "references", "question-firewall.md")), true)
  assert.equal(existsSync(join(configDir, "skills", "magi", "references", "setup.md")), false)

  await rm(configDir, { recursive: true, force: true })
})

test("setupOpenMagi can write independent deliberator models", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "open-magi-setup-independent-"))

  const result = await setupOpenMagi({
    configDir,
    models: {
      melchior: "model-a",
      balthasar: "model-b",
      casper: "model-c",
    },
  })
  const cfg = JSON.parse(await readFile(result.configPath, "utf8"))

  assert.deepEqual(result.models, {
    melchior: "model-a",
    balthasar: "model-b",
    casper: "model-c",
  })
  assert.equal(cfg.agent["deliberator-melchior"].model, "model-a")
  assert.equal(cfg.agent["deliberator-balthasar"].model, "model-b")
  assert.equal(cfg.agent["deliberator-casper"].model, "model-c")

  await rm(configDir, { recursive: true, force: true })
})

test("setupOpenMagi dry-run returns merged config without writing files", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "open-magi-dry-run-"))

  const result = await setupOpenMagi({ configDir, model: "deepseek-v4-flash", dryRun: true })

  assert.equal(result.dryRun, true)
  assert.equal(result.model, "deepseek-v4-flash")
  assert.equal(result.pluginSpec, DEFAULT_PLUGIN_SPEC)
  assert.equal(result.config.plugin.includes(DEFAULT_PLUGIN_SPEC), true)
  assert.equal(existsSync(join(configDir, "opencode.json")), false)
  assert.equal(existsSync(join(configDir, "skills", "magi", "SKILL.md")), false)

  await rm(configDir, { recursive: true, force: true })
})

test("setupOpenMagi without models writes an editable template", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "open-magi-template-"))

  const result = await setupOpenMagi({ configDir })
  const cfg = JSON.parse(await readFile(result.configPath, "utf8"))

  assert.deepEqual(result.models, {
    melchior: DEFAULT_MODEL_SENTINEL,
    balthasar: DEFAULT_MODEL_SENTINEL,
    casper: DEFAULT_MODEL_SENTINEL,
  })
  assert.equal(cfg.agent["deliberator-melchior"].model, DEFAULT_MODEL_SENTINEL)
  assert.equal(cfg.agent["deliberator-balthasar"].model, DEFAULT_MODEL_SENTINEL)
  assert.equal(cfg.agent["deliberator-casper"].model, DEFAULT_MODEL_SENTINEL)
  assert.match(cfg.agent["deliberator-melchior"].prompt, /Evidence|Recommended Next Action|Confidence/)
  assert.equal(existsSync(join(configDir, "skills", "magi", "SKILL.md")), true)

  await rm(configDir, { recursive: true, force: true })
})

test("setupOpenMagi template refresh preserves existing real models", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "open-magi-template-preserve-"))
  const configPath = join(configDir, "opencode.json")
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        agent: {
          "deliberator-melchior": { model: "model-a" },
          "deliberator-balthasar": { model: "model-b" },
          "deliberator-casper": { model: "model-c" },
        },
      },
      null,
      2,
    )}\n`,
  )

  const result = await setupOpenMagi({ configDir })
  const cfg = JSON.parse(await readFile(result.configPath, "utf8"))

  assert.deepEqual(result.models, {
    melchior: "model-a",
    balthasar: "model-b",
    casper: "model-c",
  })
  assert.equal(cfg.agent["deliberator-melchior"].model, "model-a")
  assert.equal(cfg.agent["deliberator-balthasar"].model, "model-b")
  assert.equal(cfg.agent["deliberator-casper"].model, "model-c")
  assert.equal(cfg.agent["deliberator-melchior"].permission.edit, "deny")
  assert.equal(cfg.agent["deliberator-balthasar"].permission.bash, "deny")

  await rm(configDir, { recursive: true, force: true })
})

test("setupOpenMagi does not duplicate an existing local open_magi plugin entry", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "open-magi-existing-plugin-"))
  const configPath = join(configDir, "opencode.json")
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        plugin: ["/tmp/open_magi_repo"],
      },
      null,
      2,
    )}\n`,
  )

  await setupOpenMagi({ configDir, model: "deepseek-v4-flash" })

  const cfg = JSON.parse(await readFile(configPath, "utf8"))
  assert.deepEqual(cfg.plugin, ["/tmp/open_magi_repo"])
  assert.equal(cfg.agent["deliberator-melchior"].model, "deepseek-v4-flash")

  await rm(configDir, { recursive: true, force: true })
})
