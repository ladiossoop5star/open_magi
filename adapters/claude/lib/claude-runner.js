import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { execFile as execFileCallback, spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { dirname, join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { mkdtemp } from "node:fs/promises"
import { setTimeout as sleep } from "node:timers/promises"
import { promisify } from "node:util"

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
const TMUX_SOCKET_DEFAULT = "open-magi"
const execFile = promisify(execFileCallback)

function padNumber(value) {
  return String(Number(value || 1)).padStart(3, "0")
}

function appendLimited(current, chunk) {
  const next = current + chunk
  if (next.length <= MAX_CAPTURE_CHARS) return next
  return next.slice(next.length - MAX_CAPTURE_CHARS)
}

function councilPromptPath(projectRoot, round, pass) {
  return join(projectRoot, ".open_magi", "magi-log", `round-${padNumber(round)}`, `council-${padNumber(pass)}`, "prompt.md")
}

function reportPathForPrompt(promptPath, sage) {
  return join(dirname(promptPath), `report-${sage}.md`)
}

function frontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  return { yaml: match?.[1] || "", body: match?.[2] || text }
}

function readYamlScalar(yaml, key) {
  const match = yaml.match(new RegExp(`^${key}:\\s*(.+)\\s*$`, "m"))
  if (!match) return undefined
  const value = match[1].trim()
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1)
  }
  return value.replace(/\s+#.*$/, "").trim()
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

async function writeReport({ promptPath, agent, processResult }) {
  const path = reportPathForPrompt(promptPath, agent.sage)
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

function sageScript({ agent, promptFile, projectRoot, claudeBin, outFile, errFile, codeFile, env }) {
  const exports = Object.entries(env || {})
    .map(([key, value]) => `export ${key}=${shq(value)}`)
    .join("\n")
  return [
    "#!/bin/sh",
    `cd ${shq(projectRoot)}`,
    "export OPEN_MAGI_DISABLE_STOP_BACKSTOP=1",
    exports,
    `${shq(claudeBin)} --model ${shq(agent.model)} --allowedTools Read,Grep,Glob --disallowedTools Bash,Edit,Write,NotebookEdit --permission-mode bypassPermissions --no-session-persistence --output-format text -p "$(cat ${shq(promptFile)})" > ${shq(outFile)} 2> ${shq(errFile)}`,
    `echo $? > ${shq(codeFile)}`,
    "",
  ].filter((line) => line !== "").join("\n")
}

async function runTmuxCouncil({ agents, councilPrompt, projectRoot, claudeBin, timeoutMs, env, tmuxBin, socket, session }) {
  const tempDir = await mkdtemp(join(tmpdir(), "open-magi-tmux-claude-"))
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
      const outFile = join(tempDir, `${agent.sage}.out`)
      const errFile = join(tempDir, `${agent.sage}.err`)
      const codeFile = join(tempDir, `${agent.sage}.code`)
      await writeFile(promptFile, buildDeliberatorPrompt(agent, councilPrompt))
      await writeFile(
        scriptFile,
        sageScript({ agent, promptFile, projectRoot, claudeBin, outFile, errFile, codeFile, env: paneEnv }),
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
              await tmux(tmuxBin, ["-L", socket, "respawn-pane", "-k", "-t", paneId, `sh ${shq(scriptFile)}`])
              return paneId
            })()
          : await tmux(tmuxBin, ["-L", socket, "split-window", "-d", "-h", "-t", session, "-P", "-F", "#{pane_id}", `sh ${shq(scriptFile)}`])
      panes.push({ agent, paneId: paneOut.trim(), outFile, errFile, codeFile, settled: false, timedOut: false })
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
      pane.result = {
        ok: false,
        exitCode: null,
        timedOut: pane.timedOut,
        startedAt,
        endedAt: Date.now(),
        stdout: await readFile(pane.outFile, "utf8").catch(() => ""),
        stderr: await readFile(pane.errFile, "utf8").catch(() => ""),
      }
      const code = await readFile(pane.codeFile, "utf8").catch(() => "")
      const exitCode = Number.parseInt(code.trim(), 10)
      pane.result.exitCode = Number.isInteger(exitCode) ? exitCode : null
      pane.result.ok = pane.result.exitCode === 0 && !pane.timedOut
      pane.result.endedAt = Date.now()
      pane.result.durationMs = pane.result.endedAt - startedAt
    }
    await rm(tempDir, { recursive: true, force: true })
  }
}

export async function runClaudeCouncil(options = {}) {
  const projectRoot = options.projectRoot || process.cwd()
  const round = Number(options.round || 1)
  const pass = Number(options.pass || options.deliberationPass || 1)
  const promptPath = resolve(projectRoot, options.promptPath || councilPromptPath(projectRoot, round, pass))
  const pluginDir = options.pluginDir || defaultClaudePluginDir(options.env || process.env)
  const claudeBin = options.claudeBin || process.env.OPEN_MAGI_CLAUDE_BIN || "claude"
  const timeoutMs = Number(options.timeoutMs || process.env.OPEN_MAGI_DELIBERATOR_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
  const councilPrompt = await readFile(promptPath, "utf8")
  const env = { ...process.env, ...(options.env || {}) }
  const agents = await Promise.all(DELIBERATORS.map((definition) => readAgent(pluginDir, definition)))

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
        claudeBin,
        timeoutMs,
        env: options.env,
        tmuxBin,
        socket,
        session,
      })
    ).map((pane) => ({ ...pane.result, output: pane.result.stdout }))
  } else {
    processResults = await Promise.all(
      agents.map((agent) =>
        runClaudeProcess({
          agent,
          projectRoot,
          prompt: buildDeliberatorPrompt(agent, councilPrompt),
          claudeBin,
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
    executor,
    tmuxSession: executor === "tmux" ? session : null,
    results,
  }
}
