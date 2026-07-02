import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"

import {
  DEFAULT_CODEX_MODEL_SENTINEL,
  defaultCodexAgentsDir,
} from "./setup.js"

const DELIBERATORS = [
  { sage: "melchior", agent: "deliberator-melchior", fileName: "deliberator-melchior.toml" },
  { sage: "balthasar", agent: "deliberator-balthasar", fileName: "deliberator-balthasar.toml" },
  { sage: "casper", agent: "deliberator-casper", fileName: "deliberator-casper.toml" },
]

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000
const MAX_CAPTURE_CHARS = 20000
const ALLOWED_SANDBOX_MODES = new Set(["read-only", "workspace-write", "danger-full-access"])

function padNumber(value) {
  return String(Number(value || 1)).padStart(3, "0")
}

function readTomlString(text, key) {
  const match = text.match(new RegExp(`^${key}\\s*=\\s*(".*")\\s*$`, "m"))
  if (!match) return undefined
  return JSON.parse(match[1])
}

function readTomlMultiline(text, key) {
  const match = text.match(new RegExp(`^${key}\\s*=\\s*"""\\n([\\s\\S]*?)\\n"""`, "m"))
  return match?.[1]
}

function appendLimited(current, chunk) {
  const next = current + chunk
  if (next.length <= MAX_CAPTURE_CHARS) return next
  return next.slice(next.length - MAX_CAPTURE_CHARS)
}

function codexConfigArg(key, value) {
  return `${key}=${JSON.stringify(String(value))}`
}

function reportPath(projectRoot, round, pass, sage) {
  return join(projectRoot, ".open_magi", "magi-log", `round-${padNumber(round)}`, `council-${padNumber(pass)}`, `report-${sage}.md`)
}

function councilPromptPath(projectRoot, round, pass) {
  return join(projectRoot, ".open_magi", "magi-log", `round-${padNumber(round)}`, `council-${padNumber(pass)}`, "prompt.md")
}

function readSandboxMode(text, path, env) {
  const sandboxMode = readTomlString(text, "sandbox_mode") || "read-only"
  if (!ALLOWED_SANDBOX_MODES.has(sandboxMode)) {
    throw new Error(`${path} has unsupported sandbox_mode "${sandboxMode}"; use read-only, workspace-write, or danger-full-access`)
  }
  if (sandboxMode === "danger-full-access" && env.OPEN_MAGI_ALLOW_FULL_ACCESS !== "1") {
    throw new Error(`${path} requests sandbox_mode "danger-full-access"; set OPEN_MAGI_ALLOW_FULL_ACCESS=1 to allow it`)
  }
  return sandboxMode
}

async function readAgent(agentsDir, definition, env = process.env) {
  const path = join(agentsDir, definition.fileName)
  const text = await readFile(path, "utf8")
  const model = readTomlString(text, "model")

  if (!model || model === DEFAULT_CODEX_MODEL_SENTINEL) {
    throw new Error(`${path} must set model to a real Codex model before Magi can launch ${definition.agent}`)
  }

  return {
    ...definition,
    path,
    model,
    provider: readTomlString(text, "model_provider"),
    reasoningEffort: readTomlString(text, "model_reasoning_effort"),
    sandboxMode: readSandboxMode(text, path, env),
    developerInstructions: readTomlMultiline(text, "developer_instructions") || "",
  }
}

function buildDeliberatorPrompt(agent, councilPrompt) {
  return [
    `You are ${agent.agent}, an Open Magi deliberator.`,
    "",
    "DEVELOPER INSTRUCTIONS",
    agent.developerInstructions.trim(),
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

function codexArgs(agent, projectRoot, outputPath) {
  const args = [
    "exec",
    "-C",
    projectRoot,
    "--sandbox",
    agent.sandboxMode || "read-only",
    "--skip-git-repo-check",
    "--dangerously-bypass-hook-trust",
    "--ignore-rules",
    "--color",
    "never",
    "-o",
    outputPath,
    "--model",
    agent.model,
  ]

  if (agent.provider) args.push("-c", codexConfigArg("model_provider", agent.provider))
  if (agent.reasoningEffort) args.push("-c", codexConfigArg("model_reasoning_effort", agent.reasoningEffort))
  args.push("-")
  return args
}

async function runCodexProcess({ agent, projectRoot, prompt, codexBin, timeoutMs, env }) {
  const tempDir = await mkdtemp(join(tmpdir(), "open-magi-codex-report-"))
  const outputPath = join(tempDir, `${agent.agent}.md`)
  const args = codexArgs(agent, projectRoot, outputPath)

  return await new Promise((resolve) => {
    let stdout = ""
    let stderr = ""
    let timedOut = false
    let settled = false
    const child = spawn(codexBin, args, {
      cwd: projectRoot,
      env: { ...process.env, ...env, OPEN_MAGI_DISABLE_STOP_BACKSTOP: "1" },
      stdio: ["pipe", "pipe", "pipe"],
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
      resolve({ ok: false, exitCode: null, timedOut, stdout, stderr, error: error.message, output: "" })
    })
    child.on("close", async (exitCode) => {
      if (settled) return
      settled = true
      clearTimeout(killTimer)
      let output = ""
      try {
        output = await readFile(outputPath, "utf8")
      } catch {
        output = stdout
      }
      await rm(tempDir, { recursive: true, force: true })
      resolve({ ok: exitCode === 0 && !timedOut, exitCode, timedOut, stdout, stderr, output })
    })
    // A fast-failing deliberator can exit before draining stdin. Ignoring EPIPE
    // preserves per-deliberator isolation; the close/error handlers settle the result.
    child.stdin.on("error", () => {})
    try {
      child.stdin.end(prompt)
    } catch {
      // stdin was already closed; close/error handler still records failure.
    }
  })
}

async function writeReport({ projectRoot, round, pass, agent, processResult }) {
  const path = reportPath(projectRoot, round, pass, agent.sage)
  await mkdir(dirname(path), { recursive: true })
  const source = processResult.ok ? "codex_exec" : "codex_exec_failed"
  const body = [
    `report_source: ${source}`,
    `agent: ${agent.agent}`,
    `model: ${agent.model}`,
    `model_provider: ${agent.provider || "inherit"}`,
    `codex_exit_code: ${processResult.exitCode ?? "null"}`,
    `codex_timed_out: ${processResult.timedOut ? "true" : "false"}`,
    "---",
    processResult.output?.trim() || processResult.stderr?.trim() || processResult.error || "No output returned.",
    "",
  ].join("\n")
  await writeFile(path, body)
  return path
}

export async function runCouncil(options = {}) {
  const projectRoot = options.projectRoot || process.cwd()
  const round = Number(options.round || 1)
  const pass = Number(options.pass || options.deliberationPass || 1)
  const promptPath = options.promptPath || councilPromptPath(projectRoot, round, pass)
  const agentsDir = options.agentsDir || defaultCodexAgentsDir(options.env || process.env)
  const codexBin = options.codexBin || process.env.OPEN_MAGI_CODEX_BIN || "codex"
  const timeoutMs = Number(options.timeoutMs || process.env.OPEN_MAGI_DELIBERATOR_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
  const councilPrompt = await readFile(promptPath, "utf8")
  const env = { ...process.env, ...(options.env || {}) }
  const agents = await Promise.all(DELIBERATORS.map((definition) => readAgent(agentsDir, definition, env)))
  const results = await Promise.all(
    agents.map(async (agent) => {
      const prompt = buildDeliberatorPrompt(agent, councilPrompt)
      const processResult = await runCodexProcess({
        agent,
        projectRoot,
        prompt,
        codexBin,
        timeoutMs,
        env: options.env,
      })
      const path = await writeReport({ projectRoot, round, pass, agent, processResult })
      return {
        agent: agent.agent,
        sage: agent.sage,
        model: agent.model,
        provider: agent.provider || null,
        ok: processResult.ok,
        exitCode: processResult.exitCode,
        timedOut: processResult.timedOut,
        reportPath: path,
        stderr: processResult.stderr,
        error: processResult.error,
      }
    }),
  )

  return {
    ok: results.every((result) => result.ok),
    projectRoot,
    promptPath,
    round,
    pass,
    results,
  }
}
