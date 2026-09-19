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

// ---------- Task 7 additions ----------
import { readFileSync, writeFileSync, rmSync } from "node:fs"
import { createHash } from "node:crypto"
import { runPiCouncil } from "./pi-runner.js"

// ---------- filesystem-authoritative state ----------
// The filesystem is the single source of truth for deliberation state. The
// custom session entry only carries session OWNERSHIP metadata (sessionID /
// projectRoot). Every lifecycle access (council preflight, tool_call guard,
// agent_settled) reads the CURRENT on-disk state, never a stale snapshot.

export function readMagiState(projectRoot) {
  try {
    return JSON.parse(readFileSync(join(projectRoot, LOG_DIR, "state.json"), "utf8"))
  } catch {
    return null
  }
}

export function statePath(projectRoot) {
  return join(projectRoot, LOG_DIR, "state.json")
}

// Filesystem write used by the backstop; mirrors index.js writeState semantics.
export function writeMagiState(projectRoot, nextState) {
  writeFileSync(statePath(projectRoot), `${JSON.stringify(nextState, null, 2)}\n`)
}

export function expectedCouncilPromptPath(projectRoot, mode, round, pass) {
  const folder = mode === "recon" ? `recon-${pad3(pass)}` : mode === "review" ? "review-001" : `council-${pad3(pass)}`
  return join(projectRoot, LOG_DIR, `round-${pad3(round)}`, folder, "prompt.md")
}

export function validateCouncilInput(input) {
  const mode = input?.mode
  if (mode !== "recon" && mode !== "decision" && mode !== "review") {
    return { ok: false, message: "[magi] magi_council mode must be recon, decision, or review." }
  }
  const round = Number(input?.round)
  if (!Number.isInteger(round) || round < 1) {
    return { ok: false, message: "[magi] magi_council round must be a positive integer." }
  }
  if (mode === "review") {
    if (input?.pass !== undefined && input?.pass !== null) {
      return { ok: false, message: "[magi] review requests must omit pass." }
    }
  } else {
    const parsepass = Number(input?.pass)
    if (!Number.isInteger(parsepass) || parsepass < 1) {
      return { ok: false, message: `[magi] ${mode} requests require a positive integer pass.` }
    }
  }
  if (typeof input?.projectRoot !== "string" || !input.projectRoot) {
    return { ok: false, message: "[magi] magi_council requires the project root." }
  }
  if (typeof input?.promptPath !== "string" || !input.promptPath || input.promptPath.includes("..")) {
    return { ok: false, message: "[magi] magi_council promptPath must be a project-local path without traversal." }
  }
  const expected = expectedCouncilPromptPath(input.projectRoot, mode, round, mode === "review" ? undefined : Number(input.pass))
  const expectedResolved = resolve(expected)
  const actualResolved = resolve(input.projectRoot, input.promptPath)
  if (actualResolved !== expectedResolved) {
    return { ok: false, message: `[magi] magi_council promptPath must resolve to ${expectedResolved} for its mode/round/pass (got ${actualResolved}).` }
  }
  return {
    ok: true,
    normalized: {
      projectRoot: resolve(input.projectRoot),
      promptPath: actualResolved,
      round,
      pass: mode === "review" ? undefined : Number(input.pass),
      mode,
    },
  }
}

export function parseQuestionRequest(text) {
  const request = {}
  let continuationKey = null
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim()) continue
    const match = /^([a-z_]+):\s*(.*)$/.exec(line)
    if (match) {
      const key = match[1]
      request[key] = match[2]
      continuationKey = key
    } else if (continuationKey) {
      request[continuationKey] = `${request[continuationKey]} ${line.trim()}`.trim()
    }
  }
  if (request.classification) request.classification = request.classification.toLowerCase()
  if (request.phase) request.phase = request.phase.toLowerCase()
  return request
}

const FIREWALL_ALLOWED_CLASSES = new Set(["execution_blocker", "impossible_verification", "destructive_or_unrelated_risk", "ambiguous_file_ownership"])

export function isQuestionAllowed(state, request) {
  const classification = request?.classification
  if (!classification) return false
  if (!FIREWALL_ALLOWED_CLASSES.has(classification)) return false
  if (classification === "debug_direction") {
    return roundNumberOf(state) === 1 && (state?.currentPhase ?? "") === "status_assessment"
  }
  if (classification === "goal_ambiguity") {
    return roundNumberOf(state) === 1 && ["goal_definition", "status_assessment"].includes(state?.currentPhase ?? "")
  }
  return true
}

export function questionSha256(question) {
  return createHash("sha256").update(String(question ?? "")).digest("hex")
}

export function isSensitiveHerdrRawCommand(request) {
  return String(request?.sensitive ?? "").toLowerCase() === "herdr_raw_command"
}

export function questionDeniedText(request) {
  const sensitive = isSensitiveHerdrRawCommand(request)
  const questionLine = sensitive ? "question: [redacted herdr raw command]" : `question: ${request.question}`
  const contextLines = sensitive
    ? [
        `commands_or_files_checked: [redacted ${String(request?.commands_or_files_checked ?? []).length} entries]`,
        `why_local_context_failed: [redacted]`,
        `default_action_if_denied: [redacted]`,
      ]
    : [
        `why_local_context_failed: ${request?.why_local_context_failed ?? "not provided"}`,
        `commands_or_files_checked: ${JSON.stringify(request?.commands_or_files_checked ?? [])}`,
        `default_action_if_denied: ${request?.default_action_if_denied ?? "not provided"}`,
      ]
  return [
    "[magi] The question firewall denied this user question.",
    `classification: ${request?.classification ?? "unknown"}`,
    `question_sha256: ${questionSha256(request?.question)}`,
    sensitive ? "sensitive: herdr_raw_command (question redacted)" : null,
    questionLine,
    ...contextLines,
    "",
    "Decision: denied by Magi question firewall. The main agent must self-answer from local context and continue.",
    "Do not ask the user.",
  ].filter((line) => line != null).join("\n")
}

function questionDeniedPath(projectRoot) {
  return join(projectRoot, LOG_DIR, "question-denied.md")
}

function writeQuestionDenied(projectRoot, request, nowIso) {
  writeFileSync(questionDeniedPath(projectRoot), [
    `denied_at: ${nowIso}`,
    questionDeniedText(request).replace(/^\[magi\] /, ""),
    "",
  ].join("\n"))
}

export function readQuestionRequest(projectRoot) {
  try {
    return parseQuestionRequest(readFileSync(join(projectRoot, LOG_DIR, "question-request.txt"), "utf8"))
  } catch (error) {
    if (error?.code === "ENOENT") return null
    return null
  }
}

export function isStaleLock(state, nowMs) {
  if (!state?.inFlight || !state?.inFlightSince) return false
  const lockMs = Number(Date.parse(state.inFlightSince))
  if (!Number.isFinite(lockMs)) return false
  return nowMs - lockMs > (positiveInteger(state.staleLockMs, DEFAULT_STALE_LOCK_MS))
}

export function isHerdrDeliberatorEntry(entry) {
  return entry?.transport === "herdr"
}

export function isHerdrOwnedTurn(state) {
  const since = state?.inFlightSince ? Number(Date.parse(state.inFlightSince)) : Number.POSITIVE_INFINITY
  return Object.values(state?.activeDeliberators ?? {}).some((entry) => (
    isHerdrDeliberatorEntry(entry) && (entry.status === "running" || Number(Date.parse(entry.completedAt ?? entry.timedOutAt ?? entry.hardErrorAt ?? "")) >= since)
  ))
}

export function shouldContinue(state, event, directory, nowMs, missingArtifacts = [], questionDenied = false) {
  const sessionId = state?.sessionID
  if (!state?.active) return { ok: false }
  const isIdle = event?.event?.type === "session.idle" || (event?.event?.type === "session.status" && event?.event?.properties?.status?.type === "idle")
  if (!isIdle) return { ok: false }
  if (event?.sessionID !== undefined && event?.sessionID !== sessionId) return { ok: false }
  if (event?.directory !== undefined && resolve(event?.directory) !== resolve(directory)) return { ok: false }
  // Herdr owns this turn: report it positively but never hand it back to
  // extension injection (repo semantics: herdr-owned turns skip the main-agent
  // continuation path entirely).
  if (isHerdrOwnedTurn(state)) {
    return { ok: true, stale: false, recover: false, artifactRepair: missingArtifacts.length > 0, questionDenied }
  }
  const artifactRepair = missingArtifacts.length > 0
  if (state?.inFlight && isStaleLock(state, nowMs)) {
    return { ok: true, stale: true, recover: false, artifactRepair, questionDenied }
  }
  if (state?.inFlight) return { ok: false }
  const recover = !state?.needsContinue && !isTerminalPhase(state?.currentPhase)
  return { stale: false, ok: true, recover: recover && !artifactRepair && !questionDenied, artifactRepair, questionDenied }
}

// (NO_PROGRESS_LIMIT reuses the Task 5 export above)

export function noProgressLimitError(count, nowIso) {
  return `no progress limit reached at ${nowIso}: consecutiveNoProgress=${count}`
}

export function trailingNoProgressHistoryCount(history) {
  let count = 0
  const entries = [...(history ?? [])].reverse()
  for (const entry of entries) {
    if (entry?.progress === false) count += 1
    else break
  }
  return count
}

export function enforceNoProgressLimit(state, { writeState, nowIso }) {
  if (isHerdrOwnedTurn(state)) return state
  const count = Math.max(state?.consecutiveNoProgress ?? 0, trailingNoProgressHistoryCount(state?.history ?? []))
  if (count < NO_PROGRESS_LIMIT) return state
  return writeState(state, {
    ...state,
    active: false, currentPhase: "blocked", needsContinue: false,
    inFlight: false, inFlightSince: null, consecutiveNoProgress: count,
    lastError: noProgressLimitError(count, nowIso),
  })
}


export function usesCouncilModes(state) {
  return Boolean(state && (state.currentCouncilMode !== undefined || Number(state.schemaVersion) >= 2))
}

export function usesCouncilPasses(state) {
  return Boolean(state && (state.currentDeliberationPass !== undefined || state.maxDeliberationPasses !== undefined || state.deliberationStatus !== undefined))
}

// ---------- artifact contract (schemaVersion >= 2 path) ----------

export function currentCouncilRoundArtifacts(state) {
  const round = roundNumberOf(state)
  const phase = state?.currentPhase ?? ""
  const pass = deliberationPassNumberOf(state)
  const reconPass = reconPassNumberOf(state)
  const usesModes = usesCouncilModes(state)
  const prefix = roundPrefix(round)
  const list = []
  if (usesModes && phaseAtLeast(phase, "research_task")) {
    if (round === 1) {
      list.push(`${prefix}/recon-001/prompt.md`, `${prefix}/recon-001/report-melchior.md`, `${prefix}/recon-001/report-balthasar.md`, `${prefix}/recon-001/report-casper.md`)
    }
    let prior = round === 1 ? 2 : 1
    for (; prior < reconPass; prior++) {
      list.push(`${prefix}/recon-${pad3(prior)}/report-melchior.md`, `${prefix}/recon-${pad3(prior)}/report-balthasar.md`, `${prefix}/recon-${pad3(prior)}/report-casper.md`)
    }
  }
  if (!usesModes || !usesCouncilPasses(state)) return list
  if (phaseAtLeast(phase, "research_task")) list.push(`${prefix}/research-prompt.md`)
  for (let previousPass = 1; previousPass < pass; previousPass++) {
    list.push(`${prefix}/council-${pad3(previousPass)}/report-melchior.md`, `${prefix}/council-${pad3(previousPass)}/report-balthasar.md`, `${prefix}/council-${pad3(previousPass)}/report-casper.md`, `${prefix}/council-${pad3(previousPass)}/synthesis.md`)
  }
  if (pass > 1) list.push(`${prefix}/direction-selection.md`)
  if (phaseAtLeast(phase, "parallel_deliberation") && state?.deliberationStatus === "ready_for_verdict") {
    list.push(`${prefix}/council-${pad3(pass)}/report-melchior.md`, `${prefix}/council-${pad3(pass)}/report-balthasar.md`, `${prefix}/council-${pad3(pass)}/report-casper.md`)
  }
  if (phaseAtLeast(phase, "synthesis")) list.push(`${prefix}/council-${pad3(pass)}/synthesis.md`)
  if (phaseAtLeast(phase, "execution") || state?.deliberationStatus === "ready_for_verdict") {
    if (!phaseAtLeast(phase, "execution")) list.push(`${prefix}/direction-selection.md`)
    list.push(`${prefix}/verdict.md`)
  }
  if (phaseAtLeast(phase, "execution")) list.push(`${prefix}/verification.md`)
  if (usesModes && phaseAtLeast(phase, "completion_review")) list.push(`${prefix}/cleanup.md`)
  if (usesModes && phase === "completion_review") {
    list.push(`${prefix}/review-001/report-melchior.md`, `${prefix}/review-001/report-balthasar.md`, `${prefix}/review-001/report-casper.md`)
  }
  return list
}

export function verificationPathFor(state) {
  return `${LOG_DIR}/round-${pad3(roundNumberOf(state))}/verification.md`
}

export function collectMissingArtifacts(state, projectRoot, existsImpl = existsSync) {
  return currentCouncilRoundArtifacts(state)
    .map((relative) => join(projectRoot, relative))
    .filter((absolute) => !existsImpl(absolute))
    .map((absolute) => absolute.slice(String(projectRoot).length + 1))
}

const CONTINUE_RULES_TEXT = [
  "Do not ask procedural questions.",
  "If the next action is defined by the Magi skill, checklist, state.json, phase contract, log layout, or report format, execute it and write the required artifact.",
  "Before asking the user, apply the Before Asking User Gate. Only ask for Phase 1 goal ambiguity, impossible verification, execution blockers, destructive or unrelated risk, or ambiguous file ownership.",
].join("\n")

export const CONTINUE_TEXT_PI = [
  "[magi] Continue the active deliberation loop.",
  "Read \`.open_magi/magi-log/state.json\` and \`.open_magi/magi-log/checklist.md\`,",
  "resume from \`currentRound\` and \`currentPhase\`, clear \`inFlight\`, then continue",
  "the 6-phase protocol. Do not restart the goal.",
  CONTINUE_RULES_TEXT,
].join("\n")

export function buildContinuePayloadPi(state) {
  return {
    text: CONTINUE_TEXT_PI,
    metadata: {
      round: roundNumberOf(state),
      phase: state?.currentPhase ?? "",
      councilMode: state?.currentCouncilMode ?? "decision",
    },
  }
}

export async function evaluateSettledAction(state, deps = {}) {
  const { existsImpl = existsSync, readQuestionRequestImpl = null, directory, nowMs = Date.now(), missingArtifacts: injectedMissing = null, writeState = async (_state, next) => next } = deps
  if (!state?.active || isTerminalPhase(state?.currentPhase)) return { kind: "none" }
  // Question request takes priority over corrective repair: an explicit user
  // question gets surfaced (or denied) before the missing-artifact path.
  const questionRequest = readQuestionRequestImpl ? await readQuestionRequestImpl() : readQuestionRequest(directory ?? ".")
  if (questionRequest && !isQuestionAllowed(state, questionRequest)) {
    return { kind: "question_denied", request: questionRequest, text: questionDeniedText(questionRequest) }
  }
  if (questionRequest) return { kind: "question", request: questionRequest }
  // A stale inFlight lock stays silent (the pass is presumed dead on the disk).
  if (state?.inFlight && isStaleLock(state, nowMs)) return { kind: "none" }
  const missing = injectedMissing ?? collectMissingArtifacts(state, directory ?? ".", existsImpl)
  if (missing.length > 0) {
    return { kind: "corrective", text: `[magi] missing required artifacts: ${missing.join(", ")}`, payload: buildContinuePayloadPi(state) }
  }
  // F13: false completion checks need the FINAL REPORT/REVIEW COUNCIL/review
  // approval artifacts, not just the verdict; (the missing artifacts list above
  // ALREADY includes review-001 reports + cleanup.md during completion_review).
  // Add the specific adherence checks: when a verdict exists, verify at least
  // one EXECUTION VERIFICATION trail (verification.md) and squash commit —
  // completing the false-completion repair check.
  if ((state?.currentPhase === "goal_check" || state?.currentPhase === "cleanup") && !existsImpl(join(directory ?? ".", verificationPathFor(state)))) {
    return { kind: "corrective", text: "[magi] phase reached goal_check/cleanup but verification.md is missing; produce the verification trail first.", payload: buildContinuePayloadPi(state) }
  }
  // Pi semantics: the council runner maintains inFlight itself, so the settled
  // injection keys off the loop's needsContinue/terminal/herdr state, not the
  // runner-owned inFlight. A stale lock still stays silent.
  if (state?.inFlight && isStaleLock(state, nowMs)) return { kind: "none" }
  return { kind: "continue", payload: buildContinuePayloadPi(state) }
}

// ---------- controller ----------

export function createNativeController({ pi, modelConfig }) {
  const controller = {
    modelConfig,
    // Session-LOCAL metadata only (never persisted into state.json).
    session: null,
    // Instance-scoped child registry (Set). Two controllers never share it.
    childRegistry: new Set(),
    // Capture uses the correct Pi 0.85.1 API surface (pi.getThinkingLevel()
    // when available, ctx.model.id for the model - both sourced from types.d.ts).
    async restore(ctx, { mainModel, thinkingLevel } = {}) {
      // Filesystem is authoritative: only session OWNERSHIP metadata lives in
      // the custom entry; this method refreshes deliberation state from disk.
      controller.state = readMagiState(ctx?.cwd ?? ".")
      controller.session = {
        mainModel: mainModel ?? ctx?.model?.id ?? null,
        mainThinking: thinkingLevel ?? ctx?.thinkingLevel ?? null,
        sessionID: ctx?.sessionManager?.getSessionId?.(),
        projectRoot: ctx?.cwd ?? null,
      }
      if (!controller.state?.active) return null // no filesystem state: do NOT start a loop
      pi?.appendEntry?.("open-magi-controller", {
        sessionID: controller.session.sessionID,
        projectRoot: controller.session.projectRoot,
      })
      return controller.state
    },
    enforceToolGuard(event, ctx) {
      const state = readMagiState(ctx?.cwd ?? ".")
      if (!state?.active) return { block: false }
      if (ctx?.mode !== "tui") return { block: false }
      const guardProbe =
        typeof pi?.getAllTools === "function" && typeof pi?.getActiveTools === "function"
          ? assertGuardableToolSet(pi.getAllTools(), pi.getActiveTools())
          : { ok: true } // minimal fakes/host contexts without tool enumeration cannot drift
      if (!guardProbe.ok) return { block: true, reason: guardProbe.message }
      const decision = enforcePhaseGuard({ state, projectRoot: ctx.cwd, toolName: event.toolName, toolInput: event.input })
      return decision.block ? { block: true, reason: decision.reason } : { block: false }
    },
    async settled(ctx) {
      const state = readMagiState(ctx?.cwd ?? ".")
      if (!state?.active || isHerdrOwnedTurn(state)) return undefined
      // No-progress check runs BEFORE any continue is sent: if the limit is
      // reached the blocked state lands in state.json via writeMagiState and
      // NOTHING is injected into the main agent's stream.
      const afterNoProgress = enforceNoProgressLimit(state, {
        writeState: (stateSnapshot, next) => {
          writeMagiState(stateSnapshot?.projectRoot ?? ctx.cwd ?? ".", next)
          return next
        },
        nowIso: new Date().toISOString(),
      })
      if (!afterNoProgress.active) return undefined
      const missing = collectMissingArtifacts(afterNoProgress, ctx?.cwd ?? ".")
      const outcome = await evaluateSettledAction(afterNoProgress, {
        existsImpl: existsSync,
        readQuestionRequestImpl: () => readQuestionRequest(ctx?.cwd ?? "."),
        directory: ctx?.cwd,
        missingArtifacts: missing,
      })
      if (outcome.kind === "none") return
      if (outcome.kind === "question_denied") {
        writeQuestionDenied(ctx?.cwd ?? ".", outcome.request, new Date().toISOString())
        pi?.appendEntry?.("open-magi-question-denied", { request: outcome.request })
        return
      }
      if (outcome.kind === "question") {
        // Display the TRUE question (request.question) through the interactive UI,
        // send the answer back to the main agent via pi.sendUserMessage, and
        // delete the question-request artifact so the next settled() will not
        // re-ask. Cancel semantics: answer === undefined keeps the artifact and
        // sends nothing.
        const artifact = join(ctx.cwd ?? ".", LOG_DIR, "question-request.txt")
        const answer = await ctx?.ui?.input?.(`[magi] ${outcome.request.question}`, "")
        if (answer === undefined) return undefined // cancelled: nothing written or sent
        try { rmSync(artifact) } catch { /* already gone */ }
        await pi?.sendUserMessage?.(`[magi] question answered by the user: ${answer}`)
        return
      }
      await pi?.sendUserMessage?.(outcome.kind === "corrective" ? `${outcome.text}\n${CONTINUE_TEXT_PI}` : CONTINUE_TEXT_PI)
    },
    async council(request) {
      if (isHerdrActive()) throw new Error(TRANSPORT_MISMATCH_ERROR)
      return consumeCouncilRequest(controller, request)
    },
    shutdown({ killAfterMs = 5_000 } = {}) {
      // SIGTERM -> wait close (killAfterMs cap) -> SIGKILL -> A CLOSE-CAPABLE
      // CHILD IS REAPED ONLY BY ITS close EVENT, never by a timer: killed=true
      // means a signal was SENT, never that reaping happened. The bounded
      // fallback exists ONLY for a non-Node stub that genuinely has no usable
      // once/on/close interface (detected at registration time).
      const pending = [...controller.childRegistry]
      if (pending.length === 0) return Promise.resolve()
      return Promise.all(pending.map((child) => new Promise((resolve) => {
        let killTimer = null
        let fallbackTimer = null
        const reaped = () => {
          controller.childRegistry.delete(child)
          clearTimeout(killTimer)
          clearTimeout(fallbackTimer)
          resolve()
        }
        const canEmitClose = typeof child.once === "function" && typeof child.emit === "function"
        if (child.exitCode !== null) { reaped(); return } // close already happened
        // The SIGKILL escalation timer is intentionally NOT unref-ed: bounded
        // escalation must still fire even for cancellations in short-lived
        // runs (unref would let the event loop drain before SIGKILL fires).
        const killTimerLocal = setTimeout(() => {
          try { child.kill("SIGKILL") } catch { /* already gone */ }
        }, killAfterMs)
        killTimer = killTimerLocal
        // Attach the reaper BEFORE sending the signal: a fake child (or a fast
        // real one) may emit close synchronously inside kill().
        // SIGTERM -> wait close (killAfterMs cap for SIGNALS ONLY) -> SIGKILL :
        // a close-capable child is REAPED ONLY BY ITS close EVENT, never by a
        // timer (killed=true means a signal was SENT, never that reaping
        // happened). The bounded fallback exists ONLY for a non-Node stub that
        // genuinely has no usable once/on/close interface.
        if (typeof child.once === "function") {
          child.once("close", reaped)
          child.once("error", reaped)
        }
        try { child.kill("SIGTERM") } catch { /* already closed */ }
        if (!canEmitClose) {
          // Adversarial stub without any event interface: the bounded wait is
          // the only possible exit. Keep the shutdown promise awaited (not unref-ed).
          const fallbackTimerLocal = setTimeout(() => { reaped() }, killAfterMs + 250)
          fallbackTimer = fallbackTimerLocal
        }
      })))
    },
    // Runner seam: the per-child onChild pointer feeds registerChild; a close
    // or error listener keeps registry membership aligned with live children.
    registerChild(child) {
      controller.childRegistry.add(child)
      const drop = () => { controller.childRegistry.delete(child) }
      child.once?.("close", drop)
      child.once?.("error", drop)
      return child
    },
  }
  return controller
}

export async function consumeCouncilRequest(controller, request) {
  const { projectRoot, promptPath, round, pass, mode, isProjectTrusted, signal, runner, spawnLike } = request
  if (isHerdrActive()) throw new Error(TRANSPORT_MISMATCH_ERROR)
  const config = await controller.modelConfig.loadModelConfig({ projectRoot, isProjectTrusted: Boolean(isProjectTrusted) })
  if (!config.ok) return { ok: false, error: config.error }
  // Filesystem authority: read state fresh at dispatch time.
  const state = readMagiState(String(projectRoot))
  if (!state?.active) return { ok: false, error: "[magi] No active Magi loop in this project; open /skill:magi <goal> first." }
  // A state file without an explicit projectRoot (or one absent altogether)
  // still belongs to the CURRENT project: the residency check applies only when
  // the on-disk state names a different root.
  const stateRoot = state?.projectRoot ? resolve(String(state.projectRoot)) : resolve(String(projectRoot))
  if (state?.projectRoot && stateRoot !== resolve(String(projectRoot))) {
    return { ok: false, error: "[magi] magi_council runs only in the session that owns the Magi loop." }
  }
  const modeMatches = state.currentCouncilMode === mode
  const roundMatches = roundNumberOf(state) === Number(round)
  const passMatches = mode === "review"
    ? true
    : mode === "recon" ? reconPassNumberOf(state) === Number(pass)
    : deliberationPassNumberOf(state) === Number(pass)
  if (!modeMatches || !roundMatches || !passMatches) {
    return { ok: false, error: "[magi] magi_council request is stale for the active round/pass; regenerate the prompt." }
  }
  if (!controller.session?.mainModel) {
    return { ok: false, error: "[magi] main session model is not set; select a model before dispatching Magi." }
  }
  const run = await (runner ?? runPiCouncil)({
    projectRoot, promptPath, round, pass, mode,
    roleModels: controller.modelConfig.resolveRoleModels(controller.session.mainModel, controller.session.mainThinking ?? null, config.user, config.project),
    timeoutMs: deliberatorTimeoutMsOf(state),
    signal,
    childTracker: { add: (child) => controller.registerChild(child) },
    spawnLike,
  })
  // Post-dispatch failures (timeout / hard_error) already produced the three
  // standard role reports — return them to the gates; only PRE-DISPATCH
  // failures (config / state / path / transport / guard) may throw or reject.
  return { ok: run.ok, halt: run.halt, haltReason: run.haltReason, hardErrors: run.hardErrors, results: run.results, failureType: run.results[0]?.failureType ?? null }
}
