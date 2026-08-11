#!/usr/bin/env node

// PostToolUse hook: remind the main agent of the Magi contract while a loop is
// active. Fires only when the loop signature (round/phase/mode/pass) changed
// since the last reminder, or when the heartbeat interval elapsed. Also emits
// a user-visible systemMessage with the tmux attach command when a council
// launch is detected, once per council session. Silent otherwise, and always
// silent when no loop is active.

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { join } from "node:path"

const HEARTBEAT_MS = 10 * 60 * 1000

if (process.env.OPEN_MAGI_DISABLE_STOP_BACKSTOP === "1") {
  process.exit(0)
}

function tmuxAvailable() {
  if (process.env.OPEN_MAGI_EXECUTOR === "spawn") return false
  try {
    return spawnSync(process.env.OPEN_MAGI_TMUX_BIN || "tmux", ["-V"], { stdio: "ignore" }).status === 0
  } catch {
    return false
  }
}

function councilSessionName(projectRoot, state) {
  const hash = createHash("sha1").update(String(projectRoot)).digest("hex").slice(0, 8)
  const round = Number(state?.currentRound) || 1
  const mode =
    state?.currentCouncilMode === "recon" || state?.currentCouncilMode === "review"
      ? state.currentCouncilMode
      : `p${Number(state?.currentDeliberationPass) || 1}`
  return `magi-${hash}-r${round}-${mode}`
}

let payload = ""
process.stdin.on("data", (chunk) => {
  payload += chunk
})

process.stdin.on("end", () => {
  let hook = {}
  try {
    hook = JSON.parse(payload)
  } catch {
    process.exit(0)
  }

  const cwd = typeof hook?.cwd === "string" && hook.cwd ? hook.cwd : process.cwd()
  const logDir = join(cwd, ".open_magi", "magi-log")
  const statePath = join(logDir, "state.json")
  if (!existsSync(statePath)) {
    process.exit(0)
  }

  let state
  try {
    state = JSON.parse(readFileSync(statePath, "utf8"))
  } catch {
    process.exit(0)
  }

  if (state?.active !== true) {
    process.exit(0)
  }

  const cachePath = join(logDir, ".reminder-state.json")
  let cache = null
  try {
    cache = JSON.parse(readFileSync(cachePath, "utf8"))
  } catch {
    cache = null
  }
  let cacheDirty = false

  let systemMessage = null
  const toolName = String(hook?.tool_name || hook?.toolName || hook?.tool || "")
  const toolInput = hook?.tool_input || hook?.toolInput || hook?.input || {}
  const command = typeof toolInput?.command === "string" ? toolInput.command : toolInput?.cmd

  if (
    /^(bash|shell|local_shell)$/i.test(toolName) &&
    typeof command === "string" &&
    /run-council/.test(command) &&
    /open-magi/.test(command) &&
    tmuxAvailable()
  ) {
    const socket = process.env.OPEN_MAGI_TMUX_SOCKET || "open-magi"
    const session = councilSessionName(state.projectRoot || cwd, state)
    if (cache?.lastCouncilSession !== session) {
      systemMessage = `[magi] Council running in tmux — watch live: tmux -L ${socket} attach -t ${session}`
      cache = { ...(cache || {}), lastCouncilSession: session }
      cacheDirty = true
    }
  }

  const round = state.currentRound ?? "?"
  const phase = state.currentPhase ?? "unknown"
  const mode = state.currentCouncilMode === "recon" || state.currentCouncilMode === "review"
    ? state.currentCouncilMode
    : "decision"
  const pass = state.currentDeliberationPass ?? 1
  const signature = `${round}|${phase}|${mode}|${pass}`

  const now = Date.now()
  const remindedAt = Number(cache?.remindedAt) || 0
  let additionalContext = null
  if (cache?.signature !== signature || now - remindedAt >= HEARTBEAT_MS) {
    additionalContext = `[magi] round=${round} phase=${phase} mode=${mode} — follow the open_magi process.`
    cache = { ...(cache || {}), signature, remindedAt: now }
    cacheDirty = true
  }

  if (cacheDirty) {
    try {
      writeFileSync(cachePath, `${JSON.stringify(cache)}\n`)
    } catch {
      // A read-only log directory must not block the hook.
    }
  }

  if (!systemMessage && !additionalContext) {
    process.exit(0)
  }

  const output = {}
  if (systemMessage) output.systemMessage = systemMessage
  if (additionalContext) {
    output.hookSpecificOutput = {
      hookEventName: "PostToolUse",
      additionalContext,
    }
  }
  process.stdout.write(`${JSON.stringify(output)}\n`)
  process.exit(0)
})
