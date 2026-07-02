import { mkdir, readFile, writeFile } from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

export const CODEX_AGENT_FILE_NAMES = [
  "deliberator-melchior.toml",
  "deliberator-balthasar.toml",
  "deliberator-casper.toml",
]

const packageRoot = fileURLToPath(new URL("..", import.meta.url))
const bundledSkillDir = join(packageRoot, "skills", "magi")

const CODEX_AGENT_DEFINITIONS = [
  {
    name: "deliberator-melchior",
    fileName: "deliberator-melchior.toml",
    promptFile: "melchior.md",
    modelKey: "melchiorModel",
    providerKey: "melchiorProvider",
    effortKey: "melchiorEffort",
    nickname: "Melchior",
    description: "Magi deliberator focused on feasibility, implementation risk, edge cases, cost, and verification strategy.",
  },
  {
    name: "deliberator-balthasar",
    fileName: "deliberator-balthasar.toml",
    promptFile: "balthasar.md",
    modelKey: "balthasarModel",
    providerKey: "balthasarProvider",
    effortKey: "balthasarEffort",
    nickname: "Balthasar",
    description: "Magi deliberator focused on architecture, boundaries, maintainability, long-term evolution, and design tradeoffs.",
  },
  {
    name: "deliberator-casper",
    fileName: "deliberator-casper.toml",
    promptFile: "casper.md",
    modelKey: "casperModel",
    providerKey: "casperProvider",
    effortKey: "casperEffort",
    nickname: "Casper",
    description: "Magi deliberator focused on root-cause analysis, failure paths, counterexamples, and verification gaps.",
  },
]

function readBundledPrompt(fileName) {
  return readFileSync(join(bundledSkillDir, "prompts", fileName), "utf8")
}

function requireCodexModel(label, model) {
  if (!model || typeof model !== "string") {
    throw new Error(`${label} model is required; pass --${label}-model`)
  }
  return model
}

function tomlString(value) {
  return JSON.stringify(String(value))
}

function tomlStringArray(values) {
  return `[${values.map((value) => tomlString(value)).join(", ")}]`
}

function tomlMultilineString(value) {
  const normalized = String(value).replace(/\r\n/g, "\n").replace(/"""/g, '\\"""')
  return `"""\n${normalized}\n"""`
}

export function buildCodexAgentConfig(options = {}) {
  return Object.fromEntries(
    CODEX_AGENT_DEFINITIONS.map((agent) => {
      const model = requireCodexModel(agent.name.replace("deliberator-", ""), options[agent.modelKey])
      const provider = options[agent.providerKey] || options.provider
      const effort = options[agent.effortKey] || options.reasoningEffort
      const lines = [
        `name = ${tomlString(agent.name)}`,
        `description = ${tomlString(agent.description)}`,
        `model = ${tomlString(model)}`,
      ]

      if (provider) lines.push(`model_provider = ${tomlString(provider)}`)
      if (effort) lines.push(`model_reasoning_effort = ${tomlString(effort)}`)

      lines.push(`sandbox_mode = "read-only"`)
      lines.push(`nickname_candidates = ${tomlStringArray([agent.nickname])}`)
      lines.push(`developer_instructions = ${tomlMultilineString(readBundledPrompt(agent.promptFile))}`)

      return [agent.fileName, `${lines.join("\n")}\n`]
    }),
  )
}

export function defaultCodexAgentsDir(env = process.env) {
  if (env.CODEX_AGENTS_DIR) return env.CODEX_AGENTS_DIR
  if (env.CODEX_HOME) return join(env.CODEX_HOME, "agents")
  return join(os.homedir(), ".codex", "agents")
}

export function defaultCodexSetupConfigPath(env = process.env) {
  if (env.OPEN_MAGI_CODEX_CONFIG) return env.OPEN_MAGI_CODEX_CONFIG
  if (env.CODEX_HOME) return join(env.CODEX_HOME, "open_magi", "codex.json")
  return join(os.homedir(), ".codex", "open_magi", "codex.json")
}

function mergeDefined(...objects) {
  return Object.assign(
    {},
    ...objects.map((object) =>
      Object.fromEntries(Object.entries(object || {}).filter(([, value]) => value !== undefined && value !== "")),
    ),
  )
}

function codexSetupOptionsFromConfig(config = {}) {
  return mergeDefined(
    {
      agentsDir: config.agentsDir,
      provider: config.provider,
      reasoningEffort: config.reasoningEffort,
    },
    {
      melchiorModel: config.deliberators?.melchior?.model,
      balthasarModel: config.deliberators?.balthasar?.model,
      casperModel: config.deliberators?.casper?.model,
      melchiorProvider: config.deliberators?.melchior?.provider,
      balthasarProvider: config.deliberators?.balthasar?.provider,
      casperProvider: config.deliberators?.casper?.provider,
      melchiorEffort: config.deliberators?.melchior?.reasoningEffort,
      balthasarEffort: config.deliberators?.balthasar?.reasoningEffort,
      casperEffort: config.deliberators?.casper?.reasoningEffort,
    },
  )
}

function codexSetupConfigFromOptions(options) {
  return JSON.parse(
    JSON.stringify({
      schemaVersion: 1,
      agentsDir: options.agentsDir,
      provider: options.provider,
      reasoningEffort: options.reasoningEffort,
      deliberators: {
        melchior: {
          model: options.melchiorModel,
          provider: options.melchiorProvider,
          reasoningEffort: options.melchiorEffort,
        },
        balthasar: {
          model: options.balthasarModel,
          provider: options.balthasarProvider,
          reasoningEffort: options.balthasarEffort,
        },
        casper: {
          model: options.casperModel,
          provider: options.casperProvider,
          reasoningEffort: options.casperEffort,
        },
      },
    }),
  )
}

async function readJsonIfExists(path) {
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(await readFile(path, "utf8"))
  } catch (error) {
    throw new Error(`Failed to parse ${path}: ${error.message}`)
  }
}

export async function setupCodexMagi(options = {}) {
  const configPath = options.configPath || defaultCodexSetupConfigPath()
  const savedConfig = await readJsonIfExists(configPath)
  const savedOptions = codexSetupOptionsFromConfig(savedConfig)
  const explicitOptions = mergeDefined(options)
  const resolvedOptions = mergeDefined(savedOptions, explicitOptions)
  if (options.clearProvider) {
    delete resolvedOptions.provider
    delete resolvedOptions.melchiorProvider
    delete resolvedOptions.balthasarProvider
    delete resolvedOptions.casperProvider
  }
  const agentsDir = resolvedOptions.agentsDir || defaultCodexAgentsDir()
  const dryRun = Boolean(options.dryRun)
  const setupOptions = { ...resolvedOptions, agentsDir }
  const agents = buildCodexAgentConfig(setupOptions)
  const config = codexSetupConfigFromOptions(setupOptions)
  const agentFiles = Object.entries(agents).map(([name, content]) => ({
    name,
    path: join(agentsDir, name),
    content,
  }))

  if (!dryRun) {
    await mkdir(agentsDir, { recursive: true })
    await Promise.all(agentFiles.map((file) => writeFile(file.path, file.content)))
    await mkdir(dirname(configPath), { recursive: true })
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)
  }

  return {
    agentsDir,
    configPath,
    dryRun,
    agentFiles,
    agents,
    config,
  }
}
