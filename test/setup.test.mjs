import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import test from "node:test"

import {
  DEFAULT_PLUGIN_SPEC,
  ensureOpenMagiConfigTemplate,
  buildAgentConfig,
  setupOpenMagi,
} from "../lib/setup.js"

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

test("buildAgentConfig uses bundled prompt files as the single source of truth", async () => {
  const agents = buildAgentConfig("deepseek-v4-flash")

  for (const name of ["melchior", "balthasar", "casper"]) {
    const agentName = `deliberator-${name}`
    const prompt = await readFile(new URL(`../skills/magi/prompts/${name}.md`, import.meta.url), "utf8")
    assert.equal(agents[agentName].prompt, prompt)
  }
})

test("setupOpenMagi merges config and copies the magi skill", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "open-magi-setup-"))
  const configPath = join(configDir, "opencode.json")
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

  const openMagiConfig = JSON.parse(await readFile(join(configDir, "open_magi.json"), "utf8"))
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

test("setupOpenMagi requires an explicit model instead of writing an invalid default", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "open-magi-model-required-"))

  await assert.rejects(
    () => setupOpenMagi({ configDir }),
    /model is required/i,
  )
  assert.equal(existsSync(join(configDir, "opencode.json")), false)

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
