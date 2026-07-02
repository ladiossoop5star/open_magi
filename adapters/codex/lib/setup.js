import { mkdir, writeFile } from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

export const DEFAULT_CODEX_MODEL_SENTINEL = "default-model"

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

function codexModel(model) {
  if (typeof model !== "string") return DEFAULT_CODEX_MODEL_SENTINEL
  const trimmed = model.trim()
  return trimmed || DEFAULT_CODEX_MODEL_SENTINEL
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
      const model = codexModel(options[agent.modelKey])
      const provider = options[agent.providerKey] || options.provider
      const effort = options[agent.effortKey] || options.reasoningEffort
      const lines = [
        `name = ${tomlString(agent.name)}`,
        `description = ${tomlString(agent.description)}`,
      ]

      if (model === DEFAULT_CODEX_MODEL_SENTINEL) {
        lines.push("# Edit model before using Magi. Add a provider only when this model needs one.")
      }
      lines.push(`model = ${tomlString(model)}`)
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

export function buildCodexMcpConfig(root = packageRoot) {
  return {
    "open-magi": {
      command: "node",
      args: ["bin/mcp-server.js"],
      cwd: root,
    },
  }
}

export async function writeCodexMcpConfig(options = {}) {
  const root = options.packageRoot || packageRoot
  const path = options.path || join(root, ".mcp.json")
  const config = buildCodexMcpConfig(root)
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`)
  return { path, config }
}

function mergeDefined(...objects) {
  return Object.assign(
    {},
    ...objects.map((object) =>
      Object.fromEntries(Object.entries(object || {}).filter(([, value]) => value !== undefined && value !== "")),
    ),
  )
}

export async function setupCodexMagi(options = {}) {
  const resolvedOptions = mergeDefined(options)
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
  const agentFiles = Object.entries(agents).map(([name, content]) => ({
    name,
    path: join(agentsDir, name),
    content,
  }))
  const written = []
  const skipped = []

  if (!dryRun) {
    await mkdir(agentsDir, { recursive: true })
    for (const file of agentFiles) {
      if (!options.force && existsSync(file.path)) {
        skipped.push(file)
        continue
      }
      await writeFile(file.path, file.content)
      written.push(file)
    }
  }

  return {
    agentsDir,
    dryRun,
    agentFiles,
    written,
    skipped,
    agents,
  }
}
