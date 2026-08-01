#!/usr/bin/env node

// PreToolUse hook: while a Magi loop is active, deny project code mutations
// and build/test commands outside the execution phase. Writes under
// .open_magi/ are always allowed. Inactive loops are never touched.

import { existsSync, readFileSync } from "node:fs"
import { isAbsolute, join, resolve, sep } from "node:path"

if (process.env.OPEN_MAGI_DISABLE_STOP_BACKSTOP === "1") {
  process.exit(0)
}

const FILE_TOOL_PATTERN = /^(write|edit|multi_edit|notebookedit|apply_patch)$/i
const SHELL_TOOL_PATTERN = /^(bash|shell|local_shell)$/i
const BUILD_TEST_PATTERN =
  /(?:^|[\s;&|])(?:make|ninja|cargo\s+(?:build|test)|npm\s+(?:test|run|build|ci)|pnpm\s+(?:test|run|build)|yarn\s+(?:test|build)|pytest|go\s+(?:test|build|vet)|mvn|gradle|tox)(?=[\s;&|]|$)/
const SED_INPLACE_PATTERN = /(?:^|[\s;&|])sed\s+(?:-[a-zA-Z]+\s+)*-i(?:\s|=)/
const APPLY_PATCH_PATTERN = /(?:^|[\s;&|])apply_patch(?=[\s;&|]|$)/

function allow() {
  process.exit(0)
}

function deny(reason) {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    })}\n`,
  )
  process.exit(0)
}

function resolveTarget(cwd, target) {
  if (typeof target !== "string" || !target) return null
  return isAbsolute(target) ? resolve(target) : resolve(cwd, target)
}

function isUnder(child, parent) {
  const relative = child.slice(parent.length)
  return child.startsWith(parent) && (relative === "" || relative.startsWith(sep))
}

function isMagiPath(cwd, target) {
  const resolved = resolveTarget(cwd, target)
  return resolved !== null && isUnder(resolved, join(cwd, ".open_magi"))
}

function isProjectPath(cwd, target) {
  const resolved = resolveTarget(cwd, target)
  return resolved !== null && isUnder(resolved, resolve(cwd)) && !isMagiPath(cwd, resolved)
}

function shellMutationTargetsProject(cwd, command) {
  if (SED_INPLACE_PATTERN.test(command)) return true
  if (APPLY_PATCH_PATTERN.test(command)) return true

  const redirectPattern = /(?:>|>>)\s*(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/g
  for (const match of command.matchAll(redirectPattern)) {
    const target = match[1] || match[2] || match[3]
    if (isProjectPath(cwd, target)) return true
  }

  const teePattern = /(?:^|[\s;&|])tee\s+(?:-a\s+)?(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/g
  for (const match of command.matchAll(teePattern)) {
    const target = match[1] || match[2] || match[3]
    if (isProjectPath(cwd, target)) return true
  }

  return false
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
    allow()
  }

  const cwd = typeof hook?.cwd === "string" && hook.cwd ? hook.cwd : process.cwd()
  const logDir = join(cwd, ".open_magi", "magi-log")
  const statePath = join(logDir, "state.json")
  if (!existsSync(statePath)) allow()

  let state
  try {
    state = JSON.parse(readFileSync(statePath, "utf8"))
  } catch {
    allow()
  }
  if (state?.active !== true) allow()

  const toolName = String(hook?.tool_name || hook?.toolName || hook?.tool || "")
  const toolInput = hook?.tool_input || hook?.toolInput || hook?.input || {}
  const filePath = toolInput?.file_path ?? toolInput?.filePath ?? toolInput?.path
  const command = typeof toolInput?.command === "string" ? toolInput.command : toolInput?.cmd

  let mutation = false
  let buildTest = false

  if (FILE_TOOL_PATTERN.test(toolName)) {
    // apply_patch may carry the patch body instead of a file path; treat it as
    // a project mutation unless every mentioned path is under .open_magi/.
    const patchText = typeof toolInput?.patch === "string" ? toolInput.patch : toolInput?.input
    if (typeof filePath === "string" && filePath) {
      mutation = isProjectPath(cwd, filePath)
    } else if (typeof patchText === "string" && patchText) {
      const mentioned = patchText.match(/[^\s:]+\.(?:md|json|txt|js|ts|c|h|py|toml|yaml|yml)/g) || []
      mutation = mentioned.length === 0 || mentioned.some((path) => isProjectPath(cwd, path))
    } else {
      mutation = true
    }
  } else if (SHELL_TOOL_PATTERN.test(toolName) && typeof command === "string") {
    mutation = shellMutationTargetsProject(cwd, command)
    buildTest = BUILD_TEST_PATTERN.test(command)
  }

  if (!mutation && !buildTest) allow()

  const round = state.currentRound ?? 1
  const phase = state.currentPhase ?? "unknown"
  const roundName = `round-${String(Number.isInteger(Number(round)) && Number(round) > 0 ? Number(round) : 1).padStart(3, "0")}`
  const what = buildTest && !mutation ? "build/test commands" : "code changes"

  if (phase !== "execution") {
    deny(
      `[magi] Magi loop active (round=${round} phase=${phase}). ${what} are only allowed in the execution phase after verdict.md. Follow the open_magi process: write the required artifacts for the current phase instead.`,
    )
  }

  const verdictPath = join(logDir, roundName, "verdict.md")
  if (!existsSync(verdictPath)) {
    deny(
      `[magi] phase=execution but ${roundName}/verdict.md is missing. Produce the verdict through the council process before editing code.`,
    )
  }

  allow()
})
