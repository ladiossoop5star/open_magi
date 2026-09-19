import { join, dirname } from "node:path"
import { readFile, writeFile, rename, chmod, mkdir, rm } from "node:fs/promises"
import { homedir } from "node:os"

export const ROLE_NAMES = ["melchior", "balthasar", "casper"]
export const MODEL_CONFIG_VERSION = 1
export const MODEL_CONFIG_FILE = "open-magi.json"
export const PI_CONFIG_DIR_NAME = ".pi"

export function getPiAgentDir(env = process.env, home = homedir()) {
  const configured = String(env.PI_CODING_AGENT_DIR ?? "").trim()
  if (configured === "~") return home
  if (configured.startsWith("~/")) return join(home, configured.slice(2))
  if (configured) return configured
  return join(home, PI_CONFIG_DIR_NAME, "agent")
}

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"])

export function validateModelConfig(config) {
  if (config == null) return null
  if (typeof config !== "object" || Array.isArray(config)) {
    return "[magi] open-magi.json must be an object"
  }
  if (config.version !== MODEL_CONFIG_VERSION) {
    return `[magi] Unsupported open-magi.json version: ${JSON.stringify(config.version ?? null)}`
  }
  if (config.models == null || typeof config.models !== "object" || Array.isArray(config.models)) {
    return "[magi] open-magi.json must contain a models object"
  }
  for (const key of Object.keys(config)) {
    if (key !== "version" && key !== "models") return `[magi] Unknown top-level key in open-magi.json: ${key}`
  }
  const known = new Set(ROLE_NAMES)
  for (const key of Object.keys(config.models)) {
    if (!known.has(key)) return `[magi] Unknown role: ${key}`
    const value = config.models[key]
    if (typeof value !== "string" || !value.trim()) {
      return `[magi] Role must be a non-empty model selector: ${key}`
    }
  }
  return null
}

export function parseModelSelector(selector) {
  const value = String(selector ?? "").trim()
  const colon = value.lastIndexOf(":")
  if (colon > 0) {
    const maybe = value.slice(colon + 1)
    if (THINKING_LEVELS.has(maybe)) return { model: value.slice(0, colon), thinking: maybe }
  }
  return { model: value, thinking: null }
}

export function resolveRoleModels(mainModel, mainThinking, userConfig, projectConfig) {
  const result = {}
  const main = { model: mainModel, thinking: mainThinking ?? "medium" }
  for (const role of ROLE_NAMES) {
    let chosen = main
    const userSelector = parseModelSelector(userConfig?.models?.[role] ?? "")
    if (userSelector.model) chosen = userSelector
    const projectSelector = parseModelSelector(projectConfig?.models?.[role] ?? "")
    if (projectSelector.model) chosen = projectSelector
    result[role] = { model: chosen.model, thinking: chosen.thinking ?? main.thinking }
  }
  return result
}

export function createModelConfigApi({ getAgentDir = getPiAgentDir, CONFIG_DIR_NAME = PI_CONFIG_DIR_NAME, readFileImpl = readFile, writeFileImpl = writeFile, chmodImpl = chmod, renameImpl = rename, mkdirImpl = mkdir, rmImpl = rm } = {}) {
  const userModelConfigPath = () => join(getAgentDir(), MODEL_CONFIG_FILE)
  const projectModelConfigPath = (projectRoot) => join(projectRoot, CONFIG_DIR_NAME, MODEL_CONFIG_FILE)

  async function loadFile(path) {
    let text
    try {
      text = await readFileImpl(path, "utf8")
    } catch (error) {
      if (error?.code === "ENOENT") return null
      throw Object.assign(new Error(`[magi] Failed to read open-magi.json at ${path}: ${error?.message || error}`), { code: error?.code || "EACCES" })
    }
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      throw new Error(`[magi] Malformed JSON in open-magi.json at ${path}`)
    }
    const invalid = validateModelConfig(parsed)
    if (invalid) throw new Error(invalid)
    return parsed
  }

  async function loadModelConfig({ projectRoot, isProjectTrusted }) {
    let user
    try {
      user = await loadFile(userModelConfigPath())
    } catch (error) {
      return { ok: false, error: error.message }
    }
    if (!isProjectTrusted) {
      return { ok: true, user, project: null, projectRead: false }
    }
    // projectRead means "the file actually exists on disk and was read
    // successfully" — any absence records projectRead: false.
    const project = await loadFile(projectModelConfigPath(projectRoot))
    if (project === null) return { ok: true, user, project: null, projectRead: false }
    return { ok: true, user, project, projectRead: true }
  }

  async function writeModelConfig(targetPath, next, { scope = "project" } = {}) {
    const invalid = validateModelConfig(next)
    if (invalid) throw new Error(invalid)
    const parent = dirname(targetPath)
    // Unique sibling temp: concurrent writers never collide, cleanup is scoped,
    // and 0600 is applied to the temp BEFORE rename so no 0644 window exists.
    const tempFile = join(parent, `${MODEL_CONFIG_FILE}.${process.pid}.${Date.now()}.tmp`)
    try {
      await mkdirImpl(parent, { recursive: true })
      await writeFileImpl(tempFile, `${JSON.stringify(next, null, 2)}\n`, "utf8")
      if (scope === "user") await chmodImpl(tempFile, 0o600)
      await renameImpl(tempFile, targetPath)
    } catch (error) {
      try { await rmImpl(tempFile, { force: true }) } catch { /* already gone */ }
      throw new Error(`[magi] Failed to write ${scope} configuration at ${targetPath}: ${error?.message || error}`)
    }
  }

  return {
    CONFIG_DIR_NAME,
    userModelConfigPath,
    projectModelConfigPath,
    loadModelConfig,
    resolveRoleModels,
    writeModelConfig,
    parseModelSelector,
  }
}
