import { cp, mkdir, readFile, writeFile } from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

export const DEFAULT_PLUGIN_SPEC = "open-magi-opencode"
export const CONFIG_FILE = "opencode.json"
export const OPEN_MAGI_CONFIG_FILE = "open_magi.json"

const packageRoot = fileURLToPath(new URL("..", import.meta.url))
const bundledSkillDir = join(packageRoot, "skills", "magi")

const AGENT_PROMPT_FILES = {
  "deliberator-melchior": "melchior.md",
  "deliberator-balthasar": "balthasar.md",
  "deliberator-casper": "casper.md",
}

function readBundledPrompt(fileName) {
  return readFileSync(join(bundledSkillDir, "prompts", fileName), "utf8")
}

function requireModel(model) {
  if (!model || typeof model !== "string") {
    throw new Error("model is required; pass --model provider/model or set OPEN_MAGI_MODEL")
  }
  return model
}

export function buildAgentConfig(model) {
  const resolvedModel = requireModel(model)
  return Object.fromEntries(
    Object.entries(AGENT_PROMPT_FILES).map(([name, fileName]) => [
      name,
      {
        mode: "subagent",
        model: resolvedModel,
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
  const model = requireModel(options.model)
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
      ...buildAgentConfig(model),
    },
    plugin,
  }
}

export function openMagiConfigTemplate() {
  return {
    deliberators: {
      melchior: { runner: "opencode" },
      balthasar: { runner: "opencode" },
      casper: { runner: "opencode" },
    },
  }
}

export async function ensureOpenMagiConfigTemplate(configDir = defaultConfigDir()) {
  const configPath = join(configDir, OPEN_MAGI_CONFIG_FILE)
  if (existsSync(configPath)) {
    return { configPath, created: false }
  }

  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, `${JSON.stringify(openMagiConfigTemplate(), null, 2)}\n`)
  return { configPath, created: true }
}

export async function installMagiSkill(configDir = defaultConfigDir()) {
  const skillDir = join(configDir, "skills", "magi")
  await mkdir(dirname(skillDir), { recursive: true })
  await cp(bundledSkillDir, skillDir, { recursive: true, force: true })
  return { skillDir }
}

export async function setupOpenMagi(options = {}) {
  const configDir = options.configDir || defaultConfigDir()
  const model = requireModel(options.model || process.env.OPEN_MAGI_MODEL)
  const pluginSpec = options.pluginSpec || DEFAULT_PLUGIN_SPEC
  const dryRun = Boolean(options.dryRun)
  const configPath = join(configDir, CONFIG_FILE)
  const skillDir = join(configDir, "skills", "magi")
  const existing = await readJsonIfExists(configPath)
  const config = mergeOpenCodeConfig(existing, { model, pluginSpec })

  if (!dryRun) {
    await mkdir(dirname(configPath), { recursive: true })
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)
    await installMagiSkill(configDir)
    await ensureOpenMagiConfigTemplate(configDir)
  }

  return {
    configDir,
    configPath,
    skillDir,
    model,
    pluginSpec,
    dryRun,
    config,
  }
}
