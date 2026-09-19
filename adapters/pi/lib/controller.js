import { existsSync } from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"

export const LOG_DIR = ".open_magi/magi-log"
export const DEFAULT_DELIBERATOR_TIMEOUT_MS = 30 * 60 * 1000
export const HARD_MAX_DELIBERATOR_TIMEOUT_MS = 60 * 60 * 1000
export const DEFAULT_STALE_LOCK_MS = 30 * 60 * 1000
export const DEFAULT_MAX_DELIBERATION_PASSES = 3
export const NO_PROGRESS_LIMIT = 5

export const PHASE_RANK = {
  goal_definition: 0, status_assessment: 1, research_task: 2, parallel_deliberation: 3,
  synthesis: 4, execution: 5, goal_check: 6, cleanup: 7, completion_review: 8, complete: 9,
}

export function phaseAtLeast(phase, target) {
  return (PHASE_RANK[phase] ?? -1) >= PHASE_RANK[target]
}

export function isTerminalPhase(phase) {
  return phase === "complete" || phase === "blocked"
}

export function positiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function pad3(value) {
  return String(Math.max(positiveInteger(value, 1), 1)).padStart(3, "0")
}

export function roundPrefix(round) {
  return `${LOG_DIR}/round-${pad3(round)}`
}

export function isHerdrActive(env = process.env) {
  return env.HERDR_ENV === "1"
}

export const TRANSPORT_MISMATCH_ERROR =
  "[magi] transport mismatch: HERDR_ENV=1 keeps the Herdr contract authoritative; the native Pi council cannot run."

export const READ_ONLY_TOOLS = ["read", "grep", "find", "ls"]
export const GUARDED_TOOLS = ["write", "edit", "bash", "powershell"]

const KNOWN_CLASSIFIED_BUILTINS = new Set([...READ_ONLY_TOOLS, ...GUARDED_TOOLS])

export function classifyGuardTools(toolInfos, activeToolNames) {
  const active = new Set(activeToolNames ?? [])
  const builtinsActive = (toolInfos ?? [])
    .filter((info) => info?.sourceInfo?.source === "builtin" && active.has(info.name))
    .map((info) => info.name)
  const unknown = builtinsActive.filter((name) => !KNOWN_CLASSIFIED_BUILTINS.has(name))
  return {
    builtinsActive,
    unknown,
    readOnly: builtinsActive.filter((name) => READ_ONLY_TOOLS.includes(name)),
    guarded: builtinsActive.filter((name) => GUARDED_TOOLS.includes(name)),
    blocked: unknown.length > 0,
  }
}

export function assertGuardableToolSet(toolInfos, activeToolNames) {
  const classified = classifyGuardTools(toolInfos, activeToolNames)
  if (!classified.blocked) return { ok: true }
  return { ok: false, message: guardDiagnostic(classified.unknown[0]) }
}

export function guardDiagnostic(unknownBuiltin) {
  return `[magi] unclassified active builtin tool "${unknownBuiltin}"; Magi activation fails closed. Disable the tool or extend the Magi guard before dispatch.`
}

export function deliberatorTimeoutMsOf(state) {
  return Math.min(positiveInteger(state?.deliberatorTimeoutMs, DEFAULT_DELIBERATOR_TIMEOUT_MS), HARD_MAX_DELIBERATOR_TIMEOUT_MS)
}

export function roundNumberOf(state) {
  return positiveInteger(state?.currentRound, 1)
}
export function reconPassNumberOf(state) {
  return positiveInteger(state?.currentReconPass, 1)
}
export function deliberationPassNumberOf(state) {
  return positiveInteger(state?.currentDeliberationPass, 1)
}
export function maxDeliberationPassesOf(state) {
  return Math.max(Math.min(positiveInteger(state?.maxDeliberationPasses, DEFAULT_MAX_DELIBERATION_PASSES), 5), 3)
}

const SED_INPLACE_PATTERN = /(?:^|[\s;&|])sed\s+(?:-[a-zA-Z]+\s+)*-i(?:\s|=)/
const POSIX_REDIRECT_PATTERN = /(?<![-\w])(?:\d{0,2}(?:>>|&>|>))\s*(?:"([^"]*)"|'([^']*)'|([^\s;&|]+))/g
const TEE_PATTERN = /(?:^|[\s;&|])tee\s+(?:-a\s+)?(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/g
const APPLY_PATCH_PATTERN = /(?:^|[\s;&|])apply_patch(?=[\s;&|]|$)/
const BUILD_TEST_PATTERN = /(?:^|[\s;&|])(?:npm|npx|pnpm|yarn|make|cmake|gradle|mvn|pytest|vitest|jest|cargo|go|node)\b/

const POWERSHELL_MUTATION_PATTERNS = [
  /(?:^|[\s;|])(set-content|add-content|out-file|new-item|copy-item|move-item|clear-content|set-itemproperty|remove-item)(?=[\s;|]|$)/i,
]
const POWERSHELL_DESTRUCTIVE_PATTERN = /(?:^|[\s;|])(remove-item|clear-content)(?=[\s;|]|$)/i
const POWERSHELL_REDIRECT_PATTERN = /(?<![-\w])(?:\d+)?(?:>>|>)\s*(?:"([^"]*)"|'([^']*)'|([^\s;&|]+))/g

function isUnder(child, parent) {
  const rel = relative(parent, child)
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}
function isMagiPath(cwd, target) {
  return isUnder(resolve(target), resolve(cwd, LOG_DIR))
}
function isProjectPath(cwd, target) {
  const resolved = resolve(target)
  return isUnder(resolved, resolve(cwd)) && !isMagiPath(cwd, resolved)
}
function isDocPath(target) {
  return /\.(md|txt)$/i.test(String(target ?? "").trim())
}

function allTargets(pattern, text) {
  const targets = []
  for (const match of String(text ?? "").matchAll(pattern)) {
    targets.push(String(match[1] ?? match[2] ?? match[3] ?? "").trim())
  }
  return targets
}

function heredocTag(line) {
  const match = line.match(/<<[-~]?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/)
  return match ? match[1] : null
}

function stripHeredocs(text) {
  const out = []
  let tag = null
  for (const line of String(text ?? "").split("\n")) {
    if (tag) {
      if (line.trim() === tag) tag = null
      continue
    }
    const open = heredocTag(line)
    if (open) {
      out.push(line.slice(0, line.indexOf("<<")))
      tag = open
      continue
    }
    out.push(line)
  }
  return out.join("\n")
}

function sanitizeShellText(command, shellFamily) {
  if (shellFamily === "powershell") return String(command ?? "")
  const stripped = stripHeredocs(command)
  return stripped.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""')
    .split("\n").map((line) => line.replace(/(^|\s)#.*$/, "$1")).join("\n")
}

function targetIsMutation(cwd, target) {
  return !isDocPath(target) && isProjectPath(cwd, resolve(cwd, target))
}

function isBuildTestTargetAllowed(cwd, target) {
  return isDocPath(target) || /\.log$/i.test(target) || isMagiPath(cwd, resolve(cwd, target))
}

export function shellMutationTargetsProject(cwd, command, shellFamily) {
  const family = shellFamily === "powershell" ? "powershell" : "bash"
  const text = String(command ?? "")
  if (family === "powershell") {
    const targets = allTargets(POWERSHELL_REDIRECT_PATTERN, text)
    const buildTest = BUILD_TEST_PATTERN.test(text)
    for (const target of targets) {
      if (buildTest && isBuildTestTargetAllowed(cwd, target)) continue
      if (targetIsMutation(cwd, target)) return true
    }
    for (const pattern of POWERSHELL_MUTATION_PATTERNS) {
      if (!pattern.test(text)) continue
      const destructive = POWERSHELL_DESTRUCTIVE_PATTERN.test(text)
      const paramTargets = [
        ...text.matchAll(/(?:-Path|-FilePath|-LiteralPath)\s+"?([^";|]+)"?/g),
        ...text.matchAll(/(?:Set-Content|Add-Content|Out-File|Remove-Item|New-Item|Copy-Item|Move-Item|Clear-Content|Set-ItemProperty)\s+"?([^";|\r\n]+)"?/g),
      ].map((match) => match[1])
      return paramTargets.some((target) => {
        const isMutation = targetIsMutation(cwd, target)
        // Destructive cmdlets mutate project targets regardless of the
        // build/test/doc allowlist; non-destructive cmdlets respect it.
        if (destructive && isProjectPath(cwd, resolve(cwd, target))) return true
        return isMutation && !isBuildTestTargetAllowed(cwd, target)
      })
    }
    return false
  }
  const stripped = sanitizeShellText(command, "bash")
  if (SED_INPLACE_PATTERN.test(stripped) || APPLY_PATCH_PATTERN.test(stripped)) return true
  const buildTest = BUILD_TEST_PATTERN.test(stripped)
  for (const target of allTargets(POSIX_REDIRECT_PATTERN, stripped)) {
    if (buildTest && isBuildTestTargetAllowed(cwd, target)) continue
    if (targetIsMutation(cwd, target)) return true
  }
  for (const target of allTargets(TEE_PATTERN, stripped)) {
    if (buildTest && isBuildTestTargetAllowed(cwd, target)) continue
    if (targetIsMutation(cwd, target)) return true
  }
  return false
}

// The optional path prefix lets the pattern match absolute `/proj/.open_magi/...` and relative `.open_magi/...` targets.
const DECISION_ARTIFACT_PATTERN = /(?:^|[\s;&|'"=])(?:[A-Za-z]:[\\/])?(?:[A-Za-z0-9_.@\/-]*\/)?\.open_magi\/magi-log\/round-(\d{3})\/(?:council-\d{3}\/prompt\.md|verdict\.md)/

export function enforcePhaseGuard({ state, projectRoot, toolName, toolInput, existsImpl = existsSync }) {
  if (!state?.active) return { block: false }
  const cwd = projectRoot
  const fileTools = new Set(["write", "edit", "apply_patch"])
  const shellTools = new Set(["bash", "powershell"])
  const filePath = toolInput?.file_path ?? toolInput?.filePath ?? toolInput?.path
  const patchText = toolInput?.patch ?? toolInput?.content ?? (typeof toolInput?.input === "string" ? toolInput.input : null)
  const command = toolInput?.command ?? toolInput?.cmd ?? null
  const family = toolName === "powershell" ? "powershell" : "bash"

  const targets = []
  if (fileTools.has(toolName)) {
    if (filePath) targets.push(filePath)
    if (typeof patchText === "string") {
      for (const match of patchText.matchAll(/\.open_magi\/magi-log\/[^\s;&|'"]+/g)) targets.push(match[0])
    }
  }
  if (shellTools.has(toolName) && typeof command === "string") {
    const redirectPattern = family === "powershell" ? POWERSHELL_REDIRECT_PATTERN : POSIX_REDIRECT_PATTERN
    for (const target of allTargets(redirectPattern, sanitizeShellText(command, family))) targets.push(target)
    for (const target of allTargets(TEE_PATTERN, sanitizeShellText(command, family))) targets.push(target)
    for (const match of command.matchAll(/\.open_magi\/magi-log\/[^\s;&|'"]+/g)) targets.push(match[0])
  }

  for (const target of targets) {
    const match = DECISION_ARTIFACT_PATTERN.exec(target)
    if (!match) continue
    const round = Number(match[1])
    const mode = state.currentCouncilMode === "recon" || state.currentCouncilMode === "review" ? state.currentCouncilMode : "decision"
    if (round !== roundNumberOf(state)) continue
    if (mode === "review") {
      return {
        block: true,
        reason: "[magi] A review pass is in flight; wait for the review council before writing decision artifacts or the verdict.",
      }
    }
    const pass = mode === "recon" ? reconPassNumberOf(state) : deliberationPassNumberOf(state)
    const folder = mode === "recon" ? `recon-${pad3(pass)}` : `council-${pad3(pass)}`
    const promptPath = join(cwd, LOG_DIR, `round-${pad3(round)}`, folder, "prompt.md")
    if (!existsImpl(promptPath)) continue
    const pending = [ "melchior", "balthasar", "casper" ].filter((sage) =>
      !existsImpl(join(cwd, LOG_DIR, `round-${pad3(round)}`, folder, `report-${sage}.md`)))
    if (pending.length > 0) {
      return {
        block: true,
        reason: `[magi] ${mode} pass ${pass} is in flight (waiting on ${pending.join(", ")}). Complete or supersede the pass before writing decision artifacts or the verdict.`,
      }
    }
  }

  let mutation = false
  if (fileTools.has(toolName)) {
    if (filePath) mutation = targetIsMutation(cwd, filePath)
    else if (typeof patchText === "string") mutation = mentionedProjectPaths(patchText, cwd).length > 0
    else mutation = true
  } else if (shellTools.has(toolName) && typeof command === "string") {
    mutation = shellMutationTargetsProject(cwd, command, family)
  }
  if (!mutation) return { block: false }

  const phase = state?.currentPhase
  if (phase !== "execution") {
    return {
      block: true,
      reason: `[magi] Magi loop active (round=${roundNumberOf(state)} phase=${phase}). Code changes are only allowed in the execution phase after verdict.md. Follow the open_magi process: write the required artifacts for the current phase instead.`,
    }
  }
  const verdictPath = join(cwd, LOG_DIR, `round-${pad3(roundNumberOf(state))}`, "verdict.md")
  if (!existsImpl(verdictPath)) {
    return {
      block: true,
      reason: `[magi] phase=execution but ${verdictPath} is missing. Produce the verdict through the council process before editing code.`,
    }
  }
  return { block: false }
}

function mentionedProjectPaths(text, cwd) {
  if (typeof text !== "string" || !text) return []
  return [...text.matchAll(/[^\s:'"]+\.(?:md|json|txt|js|ts|c|h|py|toml|yaml|yml)\b/g)]
    .map((match) => match[0])
    .filter((target) => targetIsMutation(cwd, target))
}
