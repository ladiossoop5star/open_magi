import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { mkdtemp } from "node:fs/promises"

import {
  CLAUDE_DEFAULT_MODEL_SENTINEL,
  defaultClaudePluginDir,
} from "./setup.js"

const DELIBERATORS = [
  { sage: "melchior", agent: "open-magi:deliberator-melchior", fileName: "deliberator-melchior.md" },
  { sage: "balthasar", agent: "open-magi:deliberator-balthasar", fileName: "deliberator-balthasar.md" },
  { sage: "casper", agent: "open-magi:deliberator-casper", fileName: "deliberator-casper.md" },
]

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000
const MAX_CAPTURE_CHARS = 20000

function padNumber(value) {
  return String(Number(value || 1)).padStart(3, "0")
}

function appendLimited(current, chunk) {
  const next = current + chunk
  if (next.length <= MAX_CAPTURE_CHARS) return next
  return next.slice(next.length - MAX_CAPTURE_CHARS)
}

function reportPath(projectRoot, round, pass, sage) {
  return join(projectRoot, ".open_magi", "magi-log", `round-${padNumber(round)}`, `council-${padNumber(pass)}`, `report-${sage}.md`)
}

function councilPromptPath(projectRoot, round, pass) {
  return join(projectRoot, ".open_magi", "magi-log", `round-${padNumber(round)}`, `council-${padNumber(pass)}`, "prompt.md")
}

function frontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  return { yaml: match?.[1] || "", body: match?.[2] || text }
}

function readYamlScalar(yaml, key) {
  const match = yaml.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m"))
  if (!match) return undefined
  return match[1].replace(/^["']|["']$/g, "").trim()
}

async function readAgent(pluginDir, definition) {
  const path = join(pluginDir, "agents", definition.fileName)
  const text = await readFile(path, "utf8")
  const { yaml, body } = frontmatter(text)
  const model = readYamlScalar(yaml, "model")

  if (!model || model === CLAUDE_DEFAULT_MODEL_SENTINEL) {
    throw new Error(`${path} must set model to a real Claude model before Magi can launch ${definition.agent}`)
  }

  return {
    ...definition,
    path,
    model,
    instructions: body.trim(),
  }
}

function buildDeliberatorPrompt(agent, councilPrompt) {
  return [
    `You are ${agent.agent}, an Open Magi deliberator.`,
    "",
    "DEVELOPER INSTRUCTIONS",
    agent.instructions,
    "",
    "COUNCIL PROMPT",
    councilPrompt.trim(),
    "",
    "REPORT OUTPUT REQUIREMENTS",
    "- Return only the requested Magi report content.",
    "- Do not modify files.",
    "- Do not run build, test, format, deploy, or device commands.",
    "- Do not ask procedural questions.",
    "- If information is missing, write the limitation under Evidence or Blocking Questions.",
    "",
  ].join("\n")
}

function claudeArgs(agent, prompt) {
  return [
    "--model",
    agent.model,
    "--allowedTools",
    "Read,Grep,Glob",
    "--disallowedTools",
    "Bash,Edit,Write,NotebookEdit",
    "--permission-mode",
    "bypassPermissions",
    "--no-session-persistence",
    "--output-format",
    "text",
    "-p",
    prompt,
  ]
}

async function runClaudeProcess({ agent, projectRoot, prompt, claudeBin, timeoutMs, env }) {
  const tempDir = await mkdtemp(join(tmpdir(), "open-magi-claude-report-"))

  return await new Promise((resolve) => {
    let stdout = ""
    let stderr = ""
    let timedOut = false
    let settled = false
    const args = claudeArgs(agent, prompt)
    const startedAt = Date.now()
    const child = spawn(claudeBin, args, {
      cwd: projectRoot,
      env: { ...process.env, ...env, OPEN_MAGI_DISABLE_STOP_BACKSTOP: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    })
    const killTimer = setTimeout(() => {
      timedOut = true
      child.kill("SIGTERM")
      setTimeout(() => child.kill("SIGKILL"), 2000).unref()
    }, timeoutMs)

    child.stdout.on("data", (chunk) => {
      stdout = appendLimited(stdout, chunk.toString())
    })
    child.stderr.on("data", (chunk) => {
      stderr = appendLimited(stderr, chunk.toString())
    })
    child.on("error", async (error) => {
      if (settled) return
      settled = true
      clearTimeout(killTimer)
      await rm(tempDir, { recursive: true, force: true })
      const endedAt = Date.now()
      resolve({
        ok: false,
        exitCode: null,
        timedOut,
        startedAt,
        endedAt,
        durationMs: endedAt - startedAt,
        stdout,
        stderr,
        error: error.message,
        output: "",
      })
    })
    child.on("close", async (exitCode) => {
      if (settled) return
      settled = true
      clearTimeout(killTimer)
      await rm(tempDir, { recursive: true, force: true })
      const endedAt = Date.now()
      resolve({
        ok: exitCode === 0 && !timedOut,
        exitCode,
        timedOut,
        startedAt,
        endedAt,
        durationMs: endedAt - startedAt,
        stdout,
        stderr,
        output: stdout,
      })
    })
  })
}

function claudeFailureType(processResult) {
  if (processResult.ok) return null
  if (processResult.timedOut) return "timeout"
  return "hard_error"
}

async function writeReport({ projectRoot, round, pass, agent, processResult }) {
  const path = reportPath(projectRoot, round, pass, agent.sage)
  await mkdir(dirname(path), { recursive: true })
  const source = processResult.ok ? "claude_headless" : "claude_headless_failed"
  const failureType = claudeFailureType(processResult)
  const status = failureType || "ok"
  const body = [
    `report_source: ${source}`,
    `status: ${status}`,
    `failure_type: ${failureType || "none"}`,
    `agent: ${agent.agent}`,
    `model: ${agent.model}`,
    `claude_exit_code: ${processResult.exitCode ?? "null"}`,
    `claude_timed_out: ${processResult.timedOut ? "true" : "false"}`,
    `claude_failure_type: ${failureType || "none"}`,
    `claude_started_at: ${processResult.startedAt}`,
    `claude_ended_at: ${processResult.endedAt}`,
    `claude_duration_ms: ${processResult.durationMs}`,
    "---",
    processResult.output?.trim() || processResult.stderr?.trim() || processResult.error || "No output returned.",
    "",
  ].join("\n")
  await writeFile(path, body)
  return path
}

export async function runClaudeCouncil(options = {}) {
  const projectRoot = options.projectRoot || process.cwd()
  const round = Number(options.round || 1)
  const pass = Number(options.pass || options.deliberationPass || 1)
  const promptPath = options.promptPath || councilPromptPath(projectRoot, round, pass)
  const pluginDir = options.pluginDir || defaultClaudePluginDir(options.env || process.env)
  const claudeBin = options.claudeBin || process.env.OPEN_MAGI_CLAUDE_BIN || "claude"
  const timeoutMs = Number(options.timeoutMs || process.env.OPEN_MAGI_DELIBERATOR_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
  const councilPrompt = await readFile(promptPath, "utf8")
  const env = { ...process.env, ...(options.env || {}) }
  const agents = await Promise.all(DELIBERATORS.map((definition) => readAgent(pluginDir, definition)))
  const results = await Promise.all(
    agents.map(async (agent) => {
      const prompt = buildDeliberatorPrompt(agent, councilPrompt)
      const processResult = await runClaudeProcess({
        agent,
        projectRoot,
        prompt,
        claudeBin,
        timeoutMs,
        env: options.env,
      })
      const path = await writeReport({ projectRoot, round, pass, agent, processResult })
      return {
        agent: agent.agent,
        sage: agent.sage,
        model: agent.model,
        ok: processResult.ok,
        failureType: claudeFailureType(processResult),
        exitCode: processResult.exitCode,
        timedOut: processResult.timedOut,
        startedAt: processResult.startedAt,
        endedAt: processResult.endedAt,
        durationMs: processResult.durationMs,
        reportPath: path,
        stderr: processResult.stderr,
        error: processResult.error,
      }
    }),
  )
  const hardErrors = results.filter((result) => result.failureType === "hard_error")

  return {
    ok: results.every((result) => result.ok),
    halt: hardErrors.length > 0,
    haltReason: hardErrors.length > 0 ? "hard_error" : null,
    hardErrors,
    projectRoot,
    promptPath,
    round,
    pass,
    results,
  }
}
