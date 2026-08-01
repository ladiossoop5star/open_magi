#!/usr/bin/env node

// PostToolUse hook: remind the main agent of the Magi contract while a loop is
// active. Fires only when the loop signature (round/phase/mode/pass) changed
// since the last reminder, or when the heartbeat interval elapsed. Silent
// otherwise, and always silent when no loop is active.

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const HEARTBEAT_MS = 10 * 60 * 1000

if (process.env.OPEN_MAGI_DISABLE_STOP_BACKSTOP === "1") {
  process.exit(0)
}

let payload = ""
process.stdin.on("data", (chunk) => {
  payload += chunk
})

process.stdin.on("end", () => {
  let cwd = process.cwd()
  try {
    const parsed = JSON.parse(payload)
    if (typeof parsed?.cwd === "string" && parsed.cwd) cwd = parsed.cwd
  } catch {
    // Fall back to process.cwd() when the hook payload is unavailable.
  }

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

  const round = state.currentRound ?? "?"
  const phase = state.currentPhase ?? "unknown"
  const mode = state.currentCouncilMode === "recon" || state.currentCouncilMode === "review"
    ? state.currentCouncilMode
    : "decision"
  const pass = state.currentDeliberationPass ?? 1
  const signature = `${round}|${phase}|${mode}|${pass}`

  const cachePath = join(logDir, ".reminder-state.json")
  let cache = null
  try {
    cache = JSON.parse(readFileSync(cachePath, "utf8"))
  } catch {
    cache = null
  }

  const now = Date.now()
  const remindedAt = Number(cache?.remindedAt) || 0
  if (cache?.signature === signature && now - remindedAt < HEARTBEAT_MS) {
    process.exit(0)
  }

  try {
    writeFileSync(cachePath, `${JSON.stringify({ signature, remindedAt: now })}\n`)
  } catch {
    // A read-only log directory must not block the reminder.
  }

  const additionalContext = `[magi] round=${round} phase=${phase} mode=${mode} — follow the open_magi process.`

  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext,
      },
    })}\n`,
  )
  process.exit(0)
})
