import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
// Deliberator timeout constants are owned here to break the controller<->runner
// ESM cycle. A cross-check test asserts they never drift from controller.js.
export const DEFAULT_DELIBERATOR_TIMEOUT_MS = 30 * 60 * 1000
export const HARD_MAX_DELIBERATOR_TIMEOUT_MS = 60 * 60 * 1000

export const DELIBERATORS = [
  { sage: "melchior" },
  { sage: "balthasar" },
  { sage: "casper" },
]

export const ISOLATION_ARGS = [
  "--mode", "json",
  "--print",
  "--no-session",
  "--no-extensions",
  "--no-skills",
  "--no-context-files",
  "--no-prompt-templates",
  "--no-themes",
  "--tools", "read,grep,find,ls",
  "--no-approve",
]

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"])
function normalizeThinking(level) {
  return THINKING_LEVELS.has(level) ? level : "medium"
}

export function resolvePiInvocation(options = {}) {
  const argv = options.processArgv ?? process.argv
  const execPath = options.processExecPath ?? process.execPath
  const existsImpl = options.existsImpl ?? existsSync
  const currentScript = argv[1]
  const isBunVirtualScript = typeof currentScript === "string" && currentScript.startsWith("/$bunfs/root/")
  if (options.forcePathFallback) return { command: "pi", args: [] }
  if (currentScript && !isBunVirtualScript && existsImpl(currentScript)) {
    return { command: execPath, args: [currentScript] }
  }
  const execName = String(execPath.split(/[\\/]/).pop() ?? "").toLowerCase()
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName)
  if (!isGenericRuntime) return { command: execPath, args: [] }
  return { command: "pi", args: [] }
}

export function buildChildArgs({ model, thinking }) {
  return [...ISOLATION_ARGS, "--model", String(model), "--thinking", normalizeThinking(thinking)]
}

export function parseJsonlStream(stdoutText) {
  const lines = String(stdoutText ?? "").split("\n").filter((line) => line.trim())
  let header = null
  let finalMessage = null
  let usage = null
  for (const line of lines) {
    let event
    try {
      event = JSON.parse(line)
    } catch {
      throw new Error("invalid_json")
    }
    if (event?.type === "session" && !header) header = event
    if (event?.type === "message_end" && event?.message?.role === "assistant") {
      finalMessage = event.message
      usage = event.message?.usage ?? usage
    }
  }
  if (!finalMessage) throw new Error("missing_final_response")
  const stopReason = finalMessage?.stopReason
  if (stopReason === "error" || stopReason === "aborted") {
    throw new Error(`assistant_stop_reason_${stopReason}`)
  }
  const text = Array.isArray(finalMessage?.content)
    ? finalMessage.content.filter((part) => part?.type === "text" && typeof part?.text === "string").map((part) => part.text).join("\n")
    : String(finalMessage?.text ?? "")
  if (!text.trim()) throw new Error("missing_final_response")
  return { header, finalMessage, usage, text }
}

const MAX_STREAM_BUFFER_CHARS = 20_000

function clampDeliberatorTimeout(timeoutMs) {
  const value = Number(timeoutMs)
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_DELIBERATOR_TIMEOUT_MS
  return Math.min(value, HARD_MAX_DELIBERATOR_TIMEOUT_MS)
}

export function runOnePiChild({ invocation, args, cwd, promptText, timeoutMs, signal, childEnv, onChild, spawnFn = spawn }) {
  // The record is settled ONLY by close/error: timeouts and aborts escalate
  // (SIGTERM -> <=5s -> SIGKILL) and then wait for the close event, so the
  // returned record truthfully reflects the reaped child and exit code.
  return new Promise((resolveRun) => {
    const record = {
      ok: false, piFailureType: null, error: null, exitCode: null,
      timedOut: false, timedOutAt: null, aborted: false,
      stdout: "", stderr: "", startedAtIso: new Date().toISOString(), endedAtIso: null, durationMs: 0,
    }
    // NOTE: ALL lifecycle variables are initialized BEFORE spawn: the sync-throw
    // path calls settle() which clears these; A TDZ here would crash the caller.
    let child = null
    let settled = false
    let escalated = false
    let timer = null
    let killTimer = null
    const startedAt = Date.now()
    const appendLimited = (current, chunk) => {
      const next = current === "" ? String(chunk) : current + String(chunk)
      return next.length > MAX_STREAM_BUFFER_CHARS ? next.slice(-MAX_STREAM_BUFFER_CHARS) : next
    }
    function settle(finalState = {}) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(killTimer)
      child?.stdout?.removeAllListeners?.("data")
      child?.stderr?.removeAllListeners?.("data")
      const finalRecord = {
        ...record,
        ...finalState,
        durationMs: Date.now() - startedAt,
        endedAtIso: new Date().toISOString(),
      }
      resolveRun(finalRecord)
    }
    try {
      child = spawnFn(invocation.command, [...invocation.args, ...args, promptText], {
        cwd,
        env: childEnv ? { ...process.env, ...childEnv } : undefined,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      })
      onChild?.(child)
    } catch (spawnError) {
      // Sync throw: a complete spawn_error record without touching unset vars.
      return settle({ ok: false, piFailureType: "spawn_error", error: String(spawnError?.message ?? spawnError) })
    }
    if (signal?.aborted) {
      // Abort signal already fired before the call: abort immediately, then reap.
      record.aborted = true
      escalate()
    }
    child.stdout?.on("data", (chunk) => { record.stdout = appendLimited(record.stdout, chunk) })
    child.stderr?.on("data", (chunk) => { record.stderr = appendLimited(record.stderr, chunk) })
    child.on("error", (error) => {
      settle({ ok: false, piFailureType: "spawn_error", error: String(error?.message ?? error?.code ?? error ?? "spawn failed"), exitCode: null })
    })
    child.on("close", (code) => {
      if (record.aborted) return settle({ ok: false, exitCode: code })
      if (record.timedOut) return settle({ ok: false, exitCode: code })
      // nonzero_exit gets its subtype later (envelope checks model errors);
      // keep piFailureType null so piEnvelopeFor can see bounded stderr.
      settle({ ok: code === 0, exitCode: code })
    })
    function escalate() {
      if (escalated) return
      escalated = true
      try { child.kill("SIGTERM") } catch { /* already gone */ }
      killTimer = setTimeout(() => { try { child.kill("SIGKILL") } catch { /* already gone */ } }, 5_000)
      if (typeof killTimer.unref === "function") killTimer.unref()
    }
    timer = setTimeout(() => {
      record.timedOut = true
      record.timedOutAt = new Date().toISOString()
      escalate()
    }, clampDeliberatorTimeout(timeoutMs))
    if (typeof timer.unref === "function") timer.unref()
    signal?.addEventListener("abort", () => {
      if (settled) return
      record.aborted = true
      escalate()
    }, { once: true })
  })
}

const MODEL_UNAVAILABLE_PATTERN = /invalid[ _]api[ _-]?key|api[ _-]?key (?:not |is )?(?:provided|missing|invalid)|unauthorized|\b401\b|\b403\b|no api key|not configured|model .* (?:not (?:found|available)|does not exist)|unknown model/i

export function piEnvelopeFor(processResult) {
  if (processResult.ok) return { status: "ok", failureType: "none", nativeType: null, stance: null, blocking: null, risk: null }
  if (processResult.timedOut) return { status: "timeout", failureType: "timeout", nativeType: "timeout", stance: "needs_evidence", blocking: "yes", risk: "medium" }
  if (processResult.piFailureType) {
    return { status: "hard_error", failureType: "hard_error", nativeType: processResult.piFailureType, stance: "needs_evidence", blocking: "yes", risk: "high" }
  }
  if (processResult.aborted) return { status: "hard_error", failureType: "hard_error", nativeType: "aborted", stance: "needs_evidence", blocking: "yes", risk: "high" }
  if (processResult.exitCode === 0) return { status: "hard_error", failureType: "hard_error", nativeType: "spawn_error", stance: "needs_evidence", blocking: "yes", risk: "high" }
  // Model/auth/provider failures are classified distinctly from generic exits so
  // gate magnitudes (retry vs abort) can differentiate: obvious model/auth errors
  // -> model_unavailable, otherwise -> nonzero_exit.
  const nativeType = MODEL_UNAVAILABLE_PATTERN.test(processResult.stderr ?? "") ? "model_unavailable" : "nonzero_exit"
  return { status: "hard_error", failureType: "hard_error", nativeType, stance: "needs_evidence", blocking: "yes", risk: "high" }
}

export function reportPathForPrompt(promptPath, sage) {
  return join(dirname(promptPath), `report-${sage}.md`)
}

export function reportBodyFor({ sage, model, processResult, stream, usage }) {
  const envelope = piEnvelopeFor(processResult)
  const success = envelope.status === "ok"
  const body = [`report_source: ${success ? "pi_json" : "pi_json_failed"}`, `status: ${envelope.status}`]
  if (!success) {
    body.push(`stance: ${envelope.stance}`, `blocking_objection: ${envelope.blocking}`, `risk_level: ${envelope.risk}`)
  }
  body.push(
    `failure_type: ${envelope.failureType}`,
    `agent: deliberator-${sage}`,
    `model: ${model}`,
    `pi_failure_subtype: ${envelope.nativeType ?? "none"}`,
    `pi_exit_code: ${processResult.exitCode ?? "null"}`,
    `pi_timed_out: ${processResult.timedOut ? "true" : "false"}`,
    `pi_started_at: ${processResult.startedAtIso}`,
    `pi_ended_at: ${processResult.endedAtIso}`,
    `pi_duration_ms: ${processResult.durationMs}`,
  )
  if (usage) body.push(`usage_input_tokens: ${usage.input ?? "unknown"}`, `usage_output_tokens: ${usage.output ?? "unknown"}`)
  body.push("---")
  if (success) body.push(String(stream?.text ?? "").trim(), "")
  else body.push(`pi_diag: ${envelope.nativeType}: ${boundedDiagnostics(processResult?.error ?? processResult?.stderr ?? "")}`, "")
  return body.join("\n")
}

function boundedDiagnostics(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 512)
}

export async function writeReport({ promptPath, sage, model, processResult }) {
  let stream = null
  let usage = null
  if (processResult.ok) {
    try {
      stream = parseJsonlStream(processResult.stdout)
      usage = stream.usage
    } catch (parseError) {
      processResult = { ...processResult, ok: false, piFailureType: parseError.message, error: `parse: ${parseError.message}` }
      stream = null
      usage = null
    }
  }
  const reportPath = reportPathForPrompt(promptPath, sage)
  await mkdir(dirname(reportPath), { recursive: true })
  const tempFile = join(dirname(reportPath), `report-${sage}.tmp`)
  try {
    await writeFile(tempFile, reportBodyFor({ sage, model, processResult, stream, usage }), "utf8")
    await rename(tempFile, reportPath)
  } catch (writeError) {
    try { await rm(tempFile, { force: true }) } catch { /* already gone */ }
    throw writeError
  }
  const envelope = piEnvelopeFor(processResult)
  return {
    reportPath,
    sage, ok: envelope.status === "ok",
    failureType: envelope.status === "ok" ? null : envelope.failureType,
    piFailureType: envelope.nativeType,
    exitCode: processResult.exitCode,
    timedOut: processResult.timedOut,
    stderr: processResult.stderr,
    error: processResult.error,
  }
}

export async function runPiCouncil(options) {
  const { projectRoot, promptPath, mode, round, pass, roleModels, timeoutMs, signal, childEnv, childTracker, rolePromptRoot, spawnLike = spawn } = options
  const timeout = clampDeliberatorTimeout(timeoutMs)
  const councilPrompt = (await readFile(promptPath, "utf8")).trim()
  const invocation = options.runnerBin
    ? { command: options.runnerBin, args: options.runnerBinArgs ?? [] }
    : resolvePiInvocation()
  const roles = {
    melchior: "practical feasibility and edge cases",
    balthasar: "architecture, maintainability, and long-term design",
    casper: "debugging, root causes, and failure paths",
  }
  const childPromises = DELIBERATORS.map(async ({ sage }) => {
    // Bundled prompts resolve relative to THIS module (install position agnostic):
    // adapters/pi/lib/pi-runner.js -> adapters/pi/skills/magi/prompts/<sage>.md
    const rolePromptPath = rolePromptRoot
      ? join(rolePromptRoot, `${sage}.md`)
      : new URL(`../../skills/magi/prompts/${sage}.md`, import.meta.url)
    const rolePrompt = (await readFile(rolePromptPath, "utf8")).trim()
    const promptText = [
      `You are deliberator-${sage}, an Open Magi deliberator (${roles[sage]}).`,
      "",
      "ROLE PROMPT",
      rolePrompt,
      "",
      "COUNCIL PROMPT",
      councilPrompt,
      "",
      "REPORT OUTPUT REQUIREMENTS",
      "- Return only the requested Magi report content.",
      "- Do not modify files.",
      "- Do not run build, test, format, deploy, or device commands.",
      "- Do not ask procedural questions.",
      "- If information is missing, write the limitation under Evidence or Blocking Questions.",
      "",
    ].join("\n")
    const processResult = await runOnePiChild({
      invocation,
      args: buildChildArgs(roleModels[sage]),
      cwd: projectRoot,
      promptText,
      timeoutMs: timeout,
      signal,
      childEnv,
      onChild: (child) => {
        // The child registry seam accepts both array-shaped (push) and
        // Set/controller-registry-shaped ({ add }) consumers.
        if (typeof childTracker?.add === "function") childTracker.add(child)
        else childTracker?.push?.(child)
      },
      spawnFn: spawnLike,
    })
    return writeReport({ promptPath, sage, model: roleModels[sage].model, processResult })
  })
  const results = await Promise.all(childPromises)
  return {
    ok: results.every((result) => result.ok),
    halt: results.some((result) => result.failureType === "hard_error"),
    haltReason: results.some((result) => result.failureType === "hard_error") ? "hard_error" : null,
    hardErrors: results.filter((result) => result.failureType === "hard_error"),
    projectRoot,
    promptPath,
    round,
    pass,
    mode,
    executor: "spawn",
    results,
  }
}
