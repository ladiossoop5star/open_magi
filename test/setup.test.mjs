import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import test from "node:test"

import {
  DEFAULT_MODEL_SENTINEL,
  DEFAULT_PLUGIN_SPEC,
  buildAgentConfig,
  ensureOpenMagiConfigTemplate,
  setupOpenMagi,
} from "../lib/setup.js"
import {
  buildCodexAgentConfig,
  defaultCodexSetupConfigPath,
  setupCodexMagi,
} from "../adapters/codex/lib/setup.js"

const localOnlyModel = ["qw", "en"].join("")

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

test("setupCodexMagi writes Codex custom agent files and requires explicit sage models", async () => {
  const agentsDir = await mkdtemp(join(tmpdir(), "open-magi-codex-agents-"))

  await assert.rejects(
    () => setupCodexMagi({ agentsDir, provider: "litellm", melchiorModel: "model-a" }),
    /balthasar.*model is required/i,
  )

  const result = await setupCodexMagi({
    agentsDir,
    configPath: join(agentsDir, "open-magi-codex.json"),
    provider: "litellm",
    melchiorModel: "model-a",
    balthasarModel: "model-b",
    casperModel: "model-c",
  })

  assert.equal(result.agentsDir, agentsDir)
  assert.equal(result.configPath, join(agentsDir, "open-magi-codex.json"))
  assert.equal(result.dryRun, false)
  assert.deepEqual(result.agentFiles.map((file) => file.name), [
    "deliberator-melchior.toml",
    "deliberator-balthasar.toml",
    "deliberator-casper.toml",
  ])

  const melchior = await readFile(join(agentsDir, "deliberator-melchior.toml"), "utf8")
  const balthasar = await readFile(join(agentsDir, "deliberator-balthasar.toml"), "utf8")
  const casper = await readFile(join(agentsDir, "deliberator-casper.toml"), "utf8")
  const config = JSON.parse(await readFile(result.configPath, "utf8"))

  assert.match(melchior, /model = "model-a"/)
  assert.match(balthasar, /model = "model-b"/)
  assert.match(casper, /model = "model-c"/)
  assert.equal(config.schemaVersion, 1)
  assert.equal(config.provider, "litellm")
  assert.equal(config.deliberators.melchior.model, "model-a")
  assert.equal(config.deliberators.balthasar.model, "model-b")
  assert.equal(config.deliberators.casper.model, "model-c")

  await rm(agentsDir, { recursive: true, force: true })
})

test("setupCodexMagi can regenerate custom agents from the single config file", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "open-magi-codex-config-"))
  const agentsDir = join(configDir, "agents")
  const configPath = join(configDir, "codex.json")
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        agentsDir,
        provider: "litellm",
        deliberators: {
          melchior: { model: "model-a" },
          balthasar: { model: "model-b" },
          casper: { model: "model-c" },
        },
      },
      null,
      2,
    )}\n`,
  )

  const result = await setupCodexMagi({ configPath })

  assert.equal(result.configPath, configPath)
  assert.equal(result.agentsDir, agentsDir)
  assert.match(await readFile(join(agentsDir, "deliberator-melchior.toml"), "utf8"), /model = "model-a"/)
  assert.match(await readFile(join(agentsDir, "deliberator-balthasar.toml"), "utf8"), /model = "model-b"/)
  assert.match(await readFile(join(agentsDir, "deliberator-casper.toml"), "utf8"), /model = "model-c"/)

  await rm(configDir, { recursive: true, force: true })
})

test("defaultCodexSetupConfigPath points at one user-editable Open Magi config file", () => {
  assert.match(defaultCodexSetupConfigPath({ CODEX_HOME: "/tmp/example-codex" }), /\/tmp\/example-codex\/open_magi\/codex\.json$/)
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
  assert.equal(result.openMagiConfigPath, join(configDir, "open_magi.json"))
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

  const openMagiConfig = JSON.parse(await readFile(result.openMagiConfigPath, "utf8"))
  assert.deepEqual(openMagiConfig.deliberators, {
    melchior: { runner: "opencode" },
    balthasar: { runner: "opencode" },
    casper: { runner: "opencode" },
  })

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

  const openMagiConfig = JSON.parse(await readFile(result.openMagiConfigPath, "utf8"))
  assert.deepEqual(openMagiConfig.deliberators, {
    melchior: { runner: "opencode" },
    balthasar: { runner: "opencode" },
    casper: { runner: "opencode" },
  })

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
  assert.equal(existsSync(join(configDir, "open_magi.json")), false)
  assert.equal(existsSync(join(configDir, "skills", "magi", "SKILL.md")), false)

  await rm(configDir, { recursive: true, force: true })
})

test("ensureOpenMagiConfigTemplate writes a non-overwriting external runner template", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "open-magi-template-"))

  const created = await ensureOpenMagiConfigTemplate(configDir)
  assert.equal(created.created, true)
  assert.equal(created.configPath, join(configDir, "open_magi.json"))
  const template = JSON.parse(await readFile(created.configPath, "utf8"))
  assert.deepEqual(template.deliberators, {
    melchior: { runner: "opencode" },
    balthasar: { runner: "opencode" },
    casper: { runner: "opencode" },
  })

  await writeFile(created.configPath, `${JSON.stringify({ deliberators: { melchior: { runner: "command", command: "echo hi" } } }, null, 2)}\n`)
  const skipped = await ensureOpenMagiConfigTemplate(configDir)
  assert.equal(skipped.created, false)
  const preserved = JSON.parse(await readFile(created.configPath, "utf8"))
  assert.equal(preserved.deliberators.melchior.runner, "command")
  assert.equal(preserved.deliberators.melchior.command, "echo hi")

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
  assert.equal(existsSync(result.openMagiConfigPath), true)

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
  assert.equal(existsSync(result.openMagiConfigPath), true)

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
