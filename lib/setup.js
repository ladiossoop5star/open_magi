import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

export const DEFAULT_PLUGIN_SPEC = "open-magi-opencode"
export const CONFIG_FILE = "opencode.json"
export const DEFAULT_MODEL_SENTINEL = "default-model"

const packageRoot = fileURLToPath(new URL("..", import.meta.url))
const bundledSkillDir = join(packageRoot, "skills", "magi")

const AGENT_PROMPT_FILES = {
  "deliberator-melchior": "melchior.md",
  "deliberator-balthasar": "balthasar.md",
  "deliberator-casper": "casper.md",
}

const DELIBERATOR_MODEL_KEYS = {
  "deliberator-melchior": "melchior",
  "deliberator-balthasar": "balthasar",
  "deliberator-casper": "casper",
}

const DELIBERATOR_AGENT_NAMES = Object.keys(DELIBERATOR_MODEL_KEYS)

function readBundledPrompt(fileName) {
  return readFileSync(join(bundledSkillDir, "prompts", fileName), "utf8")
}

function normalizeModel(value) {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function sameModel(models) {
  const values = Object.values(models)
  return values.every((model) => model === values[0]) ? values[0] : null
}

function hasModelOptions(options = {}) {
  return Boolean(
    normalizeModel(options.model) ||
      normalizeModel(options.melchiorModel) ||
      normalizeModel(options.balthasarModel) ||
      normalizeModel(options.casperModel) ||
      normalizeModel(options.models?.melchior) ||
      normalizeModel(options.models?.balthasar) ||
      normalizeModel(options.models?.casper),
  )
}

function resolveModels(options = {}, env = {}, fallbackModel) {
  const sharedModel = normalizeModel(options.model) || normalizeModel(env.OPEN_MAGI_MODEL)
  const explicitModels = options.models || {}
  const models = {
    melchior:
      normalizeModel(explicitModels.melchior) ||
      normalizeModel(options.melchiorModel) ||
      normalizeModel(env.OPEN_MAGI_MELCHIOR_MODEL) ||
      sharedModel ||
      fallbackModel,
    balthasar:
      normalizeModel(explicitModels.balthasar) ||
      normalizeModel(options.balthasarModel) ||
      normalizeModel(env.OPEN_MAGI_BALTHASAR_MODEL) ||
      sharedModel ||
      fallbackModel,
    casper:
      normalizeModel(explicitModels.casper) ||
      normalizeModel(options.casperModel) ||
      normalizeModel(env.OPEN_MAGI_CASPER_MODEL) ||
      sharedModel ||
      fallbackModel,
  }

  const missing = Object.entries(models)
    .filter(([, model]) => !model)
    .map(([name]) => name)

  if (missing.length > 0) {
    throw new Error(
      `model is required for ${missing.join(", ")}; pass --model, all --melchior-model/--balthasar-model/--casper-model flags, or OPEN_MAGI_MODEL`,
    )
  }

  return models
}

function requireModels(options = {}, env = {}) {
  return resolveModels(options, env)
}

function modelsFromConfig(config) {
  const agent = config?.agent || {}
  return Object.fromEntries(
    Object.entries(DELIBERATOR_MODEL_KEYS).map(([agentName, modelKey]) => [modelKey, agent[agentName]?.model]),
  )
}

function preserveExistingModels(existing, models) {
  const agent = existing?.agent || {}
  const result = { ...models }
  for (const agentName of DELIBERATOR_AGENT_NAMES) {
    const modelKey = DELIBERATOR_MODEL_KEYS[agentName]
    const existingModel = normalizeModel(agent[agentName]?.model)
    if (result[modelKey] === DEFAULT_MODEL_SENTINEL && existingModel) {
      result[modelKey] = existingModel
    }
  }
  return result
}

export function buildAgentConfig(modelOrOptions) {
  const options = typeof modelOrOptions === "string"
    ? { model: modelOrOptions }
    : modelOrOptions?.model || modelOrOptions?.models || modelOrOptions?.melchiorModel
      ? modelOrOptions
      : { models: modelOrOptions }
  const resolvedModels = requireModels(options)
  return Object.fromEntries(
    Object.entries(AGENT_PROMPT_FILES).map(([name, fileName]) => [
      name,
      {
        mode: "subagent",
        model: resolvedModels[DELIBERATOR_MODEL_KEYS[name]],
        prompt: readBundledPrompt(fileName),
        permission: {
          edit: "deny",
          bash: "deny",
        },
      },
    ]),
  )
}

export function defaultConfigDir(env = process.env, platform = process.platform) {
  if (env.OPENCODE_CONFIG_DIR) return env.OPENCODE_CONFIG_DIR
  if (env.OPEN_MAGI_CONFIG_DIR) return env.OPEN_MAGI_CONFIG_DIR
  if (platform === "win32" && env.APPDATA) return join(env.APPDATA, "opencode")
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, "opencode")
  return join(os.homedir(), ".config", "opencode")
}

async function readJsonIfExists(path) {
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(await readFile(path, "utf8"))
  } catch (error) {
    throw new Error(`Failed to parse ${path}: ${error.message}`)
  }
}

function pluginEntryMatches(entry, pluginSpec) {
  return (Array.isArray(entry) ? entry[0] : entry) === pluginSpec
}

function isOpenMagiPluginEntry(entry) {
  const spec = Array.isArray(entry) ? entry[0] : entry
  if (typeof spec !== "string") return false
  return spec === DEFAULT_PLUGIN_SPEC || /(?:^|[/@:-])(?:opencode-)?open[-_]magi(?:$|[/.#?:@_-])/i.test(spec)
}

export function mergeOpenCodeConfig(existing = {}, options = {}) {
  const models = preserveExistingModels(existing, requireModels(options))
  const pluginSpec = options.pluginSpec || DEFAULT_PLUGIN_SPEC
  const base = existing.$schema ? { ...existing } : { "$schema": "https://opencode.ai/config.json", ...existing }
  const plugin = Array.isArray(base.plugin) ? [...base.plugin] : []

  if (!plugin.some((entry) => pluginEntryMatches(entry, pluginSpec) || isOpenMagiPluginEntry(entry))) {
    plugin.push(pluginSpec)
  }

  return {
    ...base,
    agent: {
      ...(base.agent || {}),
      ...buildAgentConfig(models),
    },
    plugin,
  }
}

export async function setupOpenMagi(options = {}) {
  const configDir = options.configDir || defaultConfigDir()
  const allowDefaultModel = options.allowDefaultModel || !hasModelOptions(options)
  const models = resolveModels(options, process.env, allowDefaultModel ? DEFAULT_MODEL_SENTINEL : undefined)
  const pluginSpec = options.pluginSpec || DEFAULT_PLUGIN_SPEC
  const dryRun = Boolean(options.dryRun)
  const configPath = join(configDir, CONFIG_FILE)
  const skillDir = join(configDir, "skills", "magi")
  const existing = await readJsonIfExists(configPath)
  const config = mergeOpenCodeConfig(existing, { models, pluginSpec })
  const actualModels = modelsFromConfig(config)

  if (!dryRun) {
    await mkdir(dirname(configPath), { recursive: true })
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)
    await mkdir(dirname(skillDir), { recursive: true })
    await rm(skillDir, { recursive: true, force: true })
    await cp(bundledSkillDir, skillDir, { recursive: true, force: true })
  }

  return {
    configDir,
    configPath,
    skillDir,
    model: sameModel(actualModels),
    models: actualModels,
    pluginSpec,
    dryRun,
    config,
  }
}
