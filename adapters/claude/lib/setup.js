import { chmod, mkdir, writeFile } from "node:fs/promises"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

export const CLAUDE_DEFAULT_MODEL_SENTINEL = "default-model"

const packageRoot = fileURLToPath(new URL("..", import.meta.url))
const agentDefinitions = [
  {
    sage: "melchior",
    fileName: "deliberator-melchior.md",
    modelKey: "melchiorModel",
  },
  {
    sage: "balthasar",
    fileName: "deliberator-balthasar.md",
    modelKey: "balthasarModel",
  },
  {
    sage: "casper",
    fileName: "deliberator-casper.md",
    modelKey: "casperModel",
  },
]

function normalizeModel(model) {
  if (typeof model !== "string") return CLAUDE_DEFAULT_MODEL_SENTINEL
  const trimmed = model.trim()
  return trimmed || CLAUDE_DEFAULT_MODEL_SENTINEL
}

function frontmatterModel(model) {
  const normalized = normalizeModel(model)
  if (/[\r\n]/.test(normalized)) {
    throw new Error("Claude model names must be a single line")
  }
  return normalized
}

function readText(relativePath) {
  return readFileSync(join(packageRoot, relativePath), "utf8")
}

function addGeneratedModelNote(agentText, model) {
  if (model !== CLAUDE_DEFAULT_MODEL_SENTINEL) return agentText
  return agentText.replace(
    "---\n\nRole:",
    "---\n\nSetup note: Edit model before using Magi. Replace `default-model` with a real Claude model name.\n\nRole:",
  )
}

function buildAgentFile(agent, options) {
  const model = frontmatterModel(options[agent.modelKey])
  const template = readText(join("agents", agent.fileName))
  const withModel = template.replace(/^model:.*$/m, `model: ${model}`)

  return addGeneratedModelNote(withModel, model)
}

function walkFilesSync(root, prefix = "") {
  const entries = readdirSync(join(root, prefix), { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const rel = join(prefix, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkFilesSync(root, rel))
    } else if (entry.isFile()) {
      files.push(rel)
    }
  }

  return files
}

function addFilesFromDirectory(files, sourceRoot, outputPrefix) {
  for (const rel of walkFilesSync(sourceRoot)) {
    files[join(outputPrefix, rel)] = readFileSync(join(sourceRoot, rel), "utf8")
  }
}

export function buildClaudePluginFiles(options = {}) {
  const files = {
    ".claude-plugin/plugin.json": readText(".claude-plugin/plugin.json"),
    "hooks/hooks.json": readText("hooks/hooks.json"),
    "hooks/magi-stop": readText("hooks/magi-stop"),
  }

  for (const agent of agentDefinitions) {
    files[join("agents", agent.fileName)] = buildAgentFile(agent, options)
  }

  addFilesFromDirectory(files, join(packageRoot, "bin"), "bin")
  addFilesFromDirectory(files, join(packageRoot, "lib"), "lib")
  addFilesFromDirectory(files, join(packageRoot, "skills"), "skills")

  return files
}

export function defaultClaudePluginDir(env = process.env) {
  if (env.CLAUDE_PLUGIN_DIR) return env.CLAUDE_PLUGIN_DIR
  if (env.CLAUDE_SKILLS_DIR) return join(env.CLAUDE_SKILLS_DIR, "open-magi")
  if (env.CLAUDE_HOME) return join(env.CLAUDE_HOME, "skills", "open-magi")
  return join(os.homedir(), ".claude", "skills", "open-magi")
}

async function writeGeneratedFiles(pluginDir, files, options) {
  const written = []
  const skipped = []

  await mkdir(pluginDir, { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    const path = join(pluginDir, name)
    if (!options.force && existsSync(path)) {
      skipped.push({ name, path, content })
      continue
    }
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content)
    if (name === "hooks/magi-stop" || name === "bin/open-magi-claude.js") await chmod(path, 0o755)
    written.push({ name, path, content })
  }

  return { written, skipped }
}

export async function setupClaudeMagi(options = {}) {
  const pluginDir = options.pluginDir || defaultClaudePluginDir()
  const dryRun = Boolean(options.dryRun)
  const filesByName = buildClaudePluginFiles(options)
  const files = Object.entries(filesByName).map(([name, content]) => ({
    name,
    path: join(pluginDir, name),
    content,
  }))
  let written = []
  let skipped = []

  if (!dryRun) {
    const result = await writeGeneratedFiles(pluginDir, filesByName, options)
    written = result.written
    skipped = result.skipped
  }

  return {
    pluginDir,
    dryRun,
    files,
    written,
    skipped,
  }
}

export function relativeToPackageRoot(path) {
  return relative(packageRoot, path)
}
