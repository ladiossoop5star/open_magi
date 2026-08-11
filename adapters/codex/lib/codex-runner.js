import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { execFile as execFileCallback, spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { dirname, join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { setTimeout as sleep } from "node:timers/promises"
import { promisify } from "node:util"

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
const TMUX_SOCKET_DEFAULT = "open-magi"
const execFile = promisify(execFileCallback)

function padNumber(value) {
  return String(Number(value || 1)).padStart(3, "0")
}

function readTomlString(text, key) {
  const match = text.match(new RegExp(`^${key}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*"|'[^']*')\\s*$`, "m"))
  if (!match) return undefined
  const raw = match[1]
  if (raw.startsWith("'")) return raw.slice(1, -1)
  try {
    return JSON.parse(raw)
  } catch {
    // TOML basic strings are not always valid JSON strings; fall back to the
    // raw inner content instead of crashing the runner.
    return raw.slice(1, -1)
  }
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

function councilPromptPath(projectRoot, round, pass) {
  return join(projectRoot, ".open_magi", "magi-log", `round-${padNumber(round)}`, `council-${padNumber(pass)}`, "prompt.md")
}

function reportPathForPrompt(promptPath, sage) {
  return join(dirname(promptPath), `report-${sage}.md`)
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
    profile: readTomlString(text, "profile"),
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
  if (agent.profile) args.push("--profile", agent.profile)
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

function codexFailureType(processResult) {
  if (processResult.ok) return null
  if (processResult.timedOut) return "timeout"
  return "hard_error"
}

async function writeReport({ promptPath, agent, processResult }) {
  const path = reportPathForPrompt(promptPath, agent.sage)
  await mkdir(dirname(path), { recursive: true })
  const source = processResult.ok ? "codex_exec" : "codex_exec_failed"
  const failureType = codexFailureType(processResult)
  const status = failureType || "ok"
  const body = [
    `report_source: ${source}`,
    `status: ${status}`,
    `failure_type: ${failureType || "none"}`,
    `agent: ${agent.agent}`,
    `model: ${agent.model}`,
    `model_provider: ${agent.provider || "inherit"}`,
    `codex_exit_code: ${processResult.exitCode ?? "null"}`,
    `codex_timed_out: ${processResult.timedOut ? "true" : "false"}`,
    `codex_failure_type: ${failureType || "none"}`,
    "---",
    processResult.output?.trim() || processResult.stderr?.trim() || processResult.error || "No output returned.",
    "",
  ].join("\n")
  await writeFile(path, body)
  return path
}

function tmuxAvailable(tmuxBin) {
  try {
    const result = spawnSync(tmuxBin, ["-V"], { stdio: "ignore" })
    return result.status === 0
  } catch {
    return false
  }
}

function resolveExecutor(options, tmuxBin) {
  const requested = options.executor || process.env.OPEN_MAGI_EXECUTOR || "auto"
  if (requested === "spawn") return "spawn"
  if (requested === "tmux") return "tmux"
  return tmuxAvailable(tmuxBin) ? "tmux" : "spawn"
}

function shq(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

async function tmux(tmuxBin, args, { allowFail = false } = {}) {
  try {
    const { stdout } = await execFile(tmuxBin, args)
    return String(stdout ?? "")
  } catch (error) {
    if (allowFail) return ""
    throw error
  }
}

function councilSessionName(projectRoot, round, pass, promptPath) {
  const hash = createHash("sha1").update(projectRoot).digest("hex").slice(0, 8)
  const mode = /recon-\d+/.test(promptPath || "") ? "recon" : /review-\d+/.test(promptPath || "") ? "review" : `p${pass}`
  return `magi-${hash}-r${round}-${mode}`
}

function sageScript({ agent, promptFile, projectRoot, codexBin, outputPath, outFile, errFile, codeFile, env }) {
  const exports = Object.entries(env || {})
    .map(([key, value]) => `export ${key}=${shq(value)}`)
    .join("\n")
  const configArgs = []
  if (agent.provider) configArgs.push("-c", codexConfigArg("model_provider", agent.provider))
  if (agent.reasoningEffort) configArgs.push("-c", codexConfigArg("model_reasoning_effort", agent.reasoningEffort))
  if (agent.profile) configArgs.push("--profile", agent.profile)
  const command = [
    shq(codexBin), "exec", "-C", shq(projectRoot), "--sandbox", shq(agent.sandboxMode || "read-only"),
    "--skip-git-repo-check", "--dangerously-bypass-hook-trust", "--ignore-rules", "--color", "never",
    "-o", shq(outputPath), "--model", shq(agent.model),
    ...configArgs.map((arg) => shq(arg)),
    "-",
  ].join(" ")
  return [
    "#!/bin/bash",
    `cd ${shq(projectRoot)}`,
    "export OPEN_MAGI_DISABLE_STOP_BACKSTOP=1",
    exports,
    "set -o pipefail",
    `${command} < ${shq(promptFile)} > >(tee ${shq(outFile)}) 2> >(tee ${shq(errFile)} >&2)`,
    "CODE=$?",
    "wait",
    `echo $CODE > ${shq(codeFile)}`,
    "",
  ].filter((line) => line !== "").join("\n")
}

async function runTmuxCouncil({ agents, councilPrompt, projectRoot, codexBin, timeoutMs, env, tmuxBin, socket, session }) {
  const tempDir = await mkdtemp(join(tmpdir(), "open-magi-tmux-codex-"))
  const startedAt = Date.now()
  const deadlineAt = startedAt + timeoutMs
  // tmux panes inherit the server environment, not the caller's, so export
  // the same fully merged environment the spawn path would receive.
  const paneEnv = { ...process.env, ...(env || {}) }
  const panes = []

  try {
    for (const [index, agent] of agents.entries()) {
      const promptFile = join(tempDir, `${agent.sage}.prompt.txt`)
      const scriptFile = join(tempDir, `${agent.sage}.sh`)
      const outputPath = join(tempDir, `${agent.sage}.codex.md`)
      const outFile = join(tempDir, `${agent.sage}.out`)
      const errFile = join(tempDir, `${agent.sage}.err`)
      const codeFile = join(tempDir, `${agent.sage}.code`)
      await writeFile(promptFile, buildDeliberatorPrompt(agent, councilPrompt))
      await writeFile(
        scriptFile,
        sageScript({ agent, promptFile, projectRoot, codexBin, outputPath, outFile, errFile, codeFile, env: paneEnv }),
      )

      const paneOut =
        index === 0
          ? await (async () => {
              const sentinelPane = await tmux(tmuxBin, ["-L", socket, "new-session", "-d", "-s", session, "-x", "220", "-y", "50", "-P", "-F", "#{pane_id}", "sleep 86400"])
              const paneId = sentinelPane.trim()
              // Set remain-on-exit while the sentinel keeps the session alive,
              // then swap in the real command; an instantly-exiting deliberator
              // must not kill the session before the other panes exist.
              await tmux(tmuxBin, ["-L", socket, "set-option", "-t", session, "remain-on-exit", "on"])
              await tmux(tmuxBin, ["-L", socket, "respawn-pane", "-k", "-t", paneId, `bash ${shq(scriptFile)}`])
              return paneId
            })()
          : await tmux(tmuxBin, ["-L", socket, "split-window", "-d", "-h", "-t", session, "-P", "-F", "#{pane_id}", `bash ${shq(scriptFile)}`])
      panes.push({ agent, paneId: paneOut.trim(), outputPath, outFile, errFile, codeFile, settled: false, timedOut: false })
    }

    await tmux(tmuxBin, ["-L", socket, "select-layout", "-t", session, "even-horizontal"], { allowFail: true })
    process.stderr.write(`[open-magi] watch live: tmux -L ${socket} attach -t ${session}\n`)

    while (panes.some((pane) => !pane.settled)) {
      const listing = await tmux(tmuxBin, ["-L", socket, "list-panes", "-t", session, "-F", "#{pane_id} #{pane_dead}"], { allowFail: true })
      const dead = new Set(
        listing
          .split("\n")
          .filter(Boolean)
          .filter((line) => line.endsWith(" 1"))
          .map((line) => line.split(" ")[0]),
      )
      const sessionGone = listing.trim() === ""
      const now = Date.now()

      for (const pane of panes) {
        if (pane.settled) continue
        if (!pane.timedOut && now >= deadlineAt && !dead.has(pane.paneId) && !sessionGone) {
          pane.timedOut = true
          await tmux(tmuxBin, ["-L", socket, "kill-pane", "-t", pane.paneId], { allowFail: true })
          // A killed pane disappears from list-panes instead of reporting
          // dead, so settle it here or the poll loop would wait forever.
          pane.settled = true
          continue
        }
        if (dead.has(pane.paneId) || sessionGone) {
          pane.settled = true
        }
      }
      if (panes.some((pane) => !pane.settled)) await sleep(500)
    }

    return panes.map((pane) => pane)
  } finally {
    await tmux(tmuxBin, ["-L", socket, "kill-session", "-t", session], { allowFail: true })
    for (const pane of panes) {
      const code = await readFile(pane.codeFile, "utf8").catch(() => "")
      const exitCode = Number.parseInt(code.trim(), 10)
      const stdout = await readFile(pane.outFile, "utf8").catch(() => "")
      const stderr = await readFile(pane.errFile, "utf8").catch(() => "")
      const output = await readFile(pane.outputPath, "utf8").catch(() => stdout)
      pane.result = {
        ok: false,
        exitCode: Number.isInteger(exitCode) ? exitCode : null,
        timedOut: pane.timedOut,
        startedAt,
        endedAt: Date.now(),
        stdout,
        stderr,
        output,
      }
      pane.result.ok = pane.result.exitCode === 0 && !pane.timedOut
      pane.result.durationMs = pane.result.endedAt - startedAt
    }
    await rm(tempDir, { recursive: true, force: true })
  }
}

export async function runCouncil(options = {}) {
  const projectRoot = options.projectRoot || process.cwd()
  const round = Number(options.round || 1)
  const pass = Number(options.pass || options.deliberationPass || 1)
  const promptPath = resolve(projectRoot, options.promptPath || councilPromptPath(projectRoot, round, pass))
  const agentsDir = options.agentsDir || defaultCodexAgentsDir(options.env || process.env)
  const codexBin = options.codexBin || process.env.OPEN_MAGI_CODEX_BIN || "codex"
  const timeoutMs = Number(options.timeoutMs || process.env.OPEN_MAGI_DELIBERATOR_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
  const councilPrompt = await readFile(promptPath, "utf8")
  const env = { ...process.env, ...(options.env || {}) }
  const agents = await Promise.all(DELIBERATORS.map((definition) => readAgent(agentsDir, definition, env)))

  const tmuxBin = options.tmuxBin || process.env.OPEN_MAGI_TMUX_BIN || "tmux"
  const executor = resolveExecutor(options, tmuxBin)
  const socket = options.tmuxSocket || process.env.OPEN_MAGI_TMUX_SOCKET || TMUX_SOCKET_DEFAULT
  const session = councilSessionName(projectRoot, round, pass, promptPath)

  let processResults
  if (executor === "tmux") {
    processResults = (
      await runTmuxCouncil({
        agents,
        councilPrompt,
        projectRoot,
        codexBin,
        timeoutMs,
        env: options.env,
        tmuxBin,
        socket,
        session,
      })
    ).map((pane) => pane.result)
  } else {
    processResults = await Promise.all(
      agents.map((agent) =>
        runCodexProcess({
          agent,
          projectRoot,
          prompt: buildDeliberatorPrompt(agent, councilPrompt),
          codexBin,
          timeoutMs,
          env: options.env,
        }),
      ),
    )
  }

  const results = await Promise.all(
    agents.map(async (agent, index) => {
      const processResult = processResults[index]
      const path = await writeReport({ promptPath, agent, processResult })
      return {
        agent: agent.agent,
        sage: agent.sage,
        model: agent.model,
        provider: agent.provider || null,
        ok: processResult.ok,
        failureType: codexFailureType(processResult),
        exitCode: processResult.exitCode,
        timedOut: processResult.timedOut,
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
    executor,
    tmuxSession: executor === "tmux" ? session : null,
    results,
  }
}
