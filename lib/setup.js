import { cp, mkdir, readFile, writeFile } from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

export const DEFAULT_PLUGIN_SPEC = "open-magi-opencode"
export const CONFIG_FILE = "opencode.json"
export const MAGI_CONFIG_FILE = "magi.json"

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

function requireModels(options = {}, env = {}) {
  const sharedModel = normalizeModel(options.model) || normalizeModel(env.OPEN_MAGI_MODEL)
  const explicitModels = options.models || {}
  const models = {
    melchior:
      normalizeModel(explicitModels.melchior) ||
      normalizeModel(options.melchiorModel) ||
      normalizeModel(env.OPEN_MAGI_MELCHIOR_MODEL) ||
      sharedModel,
    balthasar:
      normalizeModel(explicitModels.balthasar) ||
      normalizeModel(options.balthasarModel) ||
      normalizeModel(env.OPEN_MAGI_BALTHASAR_MODEL) ||
      sharedModel,
    casper:
      normalizeModel(explicitModels.casper) ||
      normalizeModel(options.casperModel) ||
      normalizeModel(env.OPEN_MAGI_CASPER_MODEL) ||
      sharedModel,
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

function modelsFromMagiConfig(config = {}) {
  return {
    melchior: normalizeModel(config.deliberators?.melchior?.model),
    balthasar: normalizeModel(config.deliberators?.balthasar?.model),
    casper: normalizeModel(config.deliberators?.casper?.model),
  }
}

function magiConfigFromOptions(options) {
  return {
    schemaVersion: 1,
    adapter: "opencode",
    pluginSpec: options.pluginSpec,
    deliberators: {
      melchior: { model: options.models.melchior },
      balthasar: { model: options.models.balthasar },
      casper: { model: options.models.casper },
    },
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
  const models = requireModels(options)
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
  const magiConfigPath = join(configDir, MAGI_CONFIG_FILE)
  const savedMagiConfig = await readJsonIfExists(magiConfigPath)
  const savedOptions = {
    pluginSpec: savedMagiConfig.pluginSpec,
    models: modelsFromMagiConfig(savedMagiConfig),
  }
  const models = requireModels({
    ...savedOptions,
    ...options,
    models: {
      ...(savedOptions.models || {}),
      ...(options.models || {}),
    },
  }, process.env)
  const pluginSpec = options.pluginSpec || savedMagiConfig.pluginSpec || DEFAULT_PLUGIN_SPEC
  const dryRun = Boolean(options.dryRun)
  const configPath = join(configDir, CONFIG_FILE)
  const skillDir = join(configDir, "skills", "magi")
  const existing = await readJsonIfExists(configPath)
  const config = mergeOpenCodeConfig(existing, { models, pluginSpec })
  const magiConfig = magiConfigFromOptions({ models, pluginSpec })

  if (!dryRun) {
    await mkdir(dirname(configPath), { recursive: true })
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)
    await writeFile(magiConfigPath, `${JSON.stringify(magiConfig, null, 2)}\n`)
    await mkdir(dirname(skillDir), { recursive: true })
    await cp(bundledSkillDir, skillDir, { recursive: true, force: true })
  }

  return {
    configDir,
    configPath,
    magiConfigPath,
    skillDir,
    model: sameModel(models),
    models,
    pluginSpec,
    dryRun,
    config,
    magiConfig,
  }
}
