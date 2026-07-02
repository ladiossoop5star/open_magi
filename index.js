import { access, appendFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { randomUUID } from "node:crypto"

const LOG_DIR = ".open_magi/magi-log"
const STATE_FILE = "state.json"
const CHECKLIST_FILE = "checklist.md"
const FINAL_REPORT_FILE = "final-report.md"
const ERROR_FILE = "plugin-error.log"
const QUESTION_REQUEST_FILE = "question-request.md"
const QUESTION_DENIED_FILE = "question-denied.md"
const STALE_LOCK_MS = 10 * 60 * 1000
const DEFAULT_DELIBERATOR_TIMEOUT_MS = 30 * 60 * 1000
const HARD_MAX_DELIBERATOR_TIMEOUT_MS = 60 * 60 * 1000
const DEFAULT_MAX_DELIBERATION_PASSES = 3
const MIN_DELIBERATION_PASSES = 3
const HARD_MAX_DELIBERATION_PASSES = 5
const NO_PROGRESS_LIMIT = 5
const STATE_QUEUES = new Map()
const PHASE_RANK = {
  goal_definition: 0,
  status_assessment: 1,
  research_task: 2,
  parallel_deliberation: 3,
  synthesis: 4,
  execution: 5,
  goal_check: 6,
  complete: 7,
}

const NO_PROCEDURAL_QUESTIONS_TEXT = [
  "Do not ask procedural questions.",
  "If the next action is defined by the Magi skill, checklist, state.json, phase contract, log layout, or report format, execute it and write the required artifact.",
  "Forbidden procedural questions include whether to write reports, which role each deliberator has, whether to launch all three deliberators, whether to use one shared prompt, where reports belong, or whether to move to the next phase.",
  "Before asking the user, apply the Before Asking User Gate. Only ask for Phase 1 goal ambiguity, impossible verification, execution blockers, destructive or unrelated risk, or ambiguous file ownership.",
].join("\n")

const CONTINUE_TEXT = `[magi] Continue the active deliberation loop.
Read \`.open_magi/magi-log/state.json\` and \`.open_magi/magi-log/checklist.md\`,
resume from \`currentRound\` and \`currentPhase\`, clear \`inFlight\`, then continue
the 6-phase protocol. Do not restart the goal.
${NO_PROCEDURAL_QUESTIONS_TEXT}`

function statePath(projectRoot) {
  return join(projectRoot, LOG_DIR, STATE_FILE)
}

function errorPath(projectRoot) {
  return join(projectRoot, LOG_DIR, ERROR_FILE)
}

function questionRequestPath(projectRoot) {
  return join(projectRoot, LOG_DIR, QUESTION_REQUEST_FILE)
}

function questionDeniedPath(projectRoot) {
  return join(projectRoot, LOG_DIR, QUESTION_DENIED_FILE)
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function corruptStateBackupRelativePath(nowIso) {
  return `${LOG_DIR}/${STATE_FILE}.corrupt-${nowIso.replace(/[-:]/g, "")}.bak`
}

function phaseAtLeast(phase, target) {
  return (PHASE_RANK[phase] ?? -1) >= PHASE_RANK[target]
}

function roundNumber(state) {
  const round = Number(state?.currentRound)
  return Number.isInteger(round) && round > 0 ? round : 1
}

function roundPrefix(round) {
  return `${LOG_DIR}/round-${String(round).padStart(3, "0")}`
}

function councilPrefix(round, pass) {
  return `${roundPrefix(round)}/council-${String(pass).padStart(3, "0")}`
}

function positiveInteger(value, fallback) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : fallback
}

function nonNegativeInteger(value, fallback) {
  const number = Number(value)
  return Number.isInteger(number) && number >= 0 ? number : fallback
}

function deliberationPassNumber(state) {
  return positiveInteger(state?.currentDeliberationPass, 1)
}

function maxDeliberationPasses(state) {
  return Math.min(
    Math.max(positiveInteger(state?.maxDeliberationPasses, DEFAULT_MAX_DELIBERATION_PASSES), MIN_DELIBERATION_PASSES),
    HARD_MAX_DELIBERATION_PASSES,
  )
}

function deliberatorTimeoutMs(state) {
  return Math.min(
    positiveInteger(state?.deliberatorTimeoutMs, DEFAULT_DELIBERATOR_TIMEOUT_MS),
    HARD_MAX_DELIBERATOR_TIMEOUT_MS,
  )
}

function deliberatorNameFromAgent(agent) {
  const match = typeof agent === "string" ? agent.match(/^deliberator-(melchior|balthasar|casper)$/) : null
  return match?.[1] || null
}

function usesCouncilPasses(state) {
  return Boolean(
    state &&
      (state.currentDeliberationPass !== undefined ||
        state.maxDeliberationPasses !== undefined ||
        state.deliberationStatus !== undefined),
  )
}

function councilReportArtifacts(round, pass) {
  const prefix = councilPrefix(round, pass)
  return [
    `${prefix}/prompt.md`,
    `${prefix}/report-melchior.md`,
    `${prefix}/report-balthasar.md`,
    `${prefix}/report-casper.md`,
  ]
}

function deliberatorReportArtifact(state, sage, entry = {}) {
  const round = positiveInteger(entry.round, roundNumber(state))
  if (usesCouncilPasses(state) || entry.pass !== undefined) {
    return `${councilPrefix(round, positiveInteger(entry.pass, deliberationPassNumber(state)))}/report-${sage}.md`
  }
  return `${roundPrefix(round)}/report-${sage}.md`
}

function completeCouncilPassArtifacts(round, pass) {
  return [...councilReportArtifacts(round, pass), `${councilPrefix(round, pass)}/synthesis.md`]
}

function completeRoundArtifacts(round) {
  const prefix = roundPrefix(round)
  return [
    `${prefix}/research-prompt.md`,
    `${prefix}/report-melchior.md`,
    `${prefix}/report-balthasar.md`,
    `${prefix}/report-casper.md`,
    `${prefix}/synthesis.md`,
    `${prefix}/verdict.md`,
    `${prefix}/verification.md`,
  ]
}

function completePreviousRoundArtifacts(round, state) {
  if (!usesCouncilPasses(state)) return completeRoundArtifacts(round)

  const prefix = roundPrefix(round)
  return [
    `${prefix}/research-prompt.md`,
    `${prefix}/verdict.md`,
    `${prefix}/verification.md`,
  ]
}

function currentCouncilRoundArtifacts(state) {
  const phase = state?.currentPhase
  const round = roundNumber(state)
  const pass = deliberationPassNumber(state)
  const prefix = roundPrefix(round)
  const finalizing = !state?.active && phase !== "blocked"
  const required = []

  if (phaseAtLeast(phase, "research_task") || finalizing) {
    required.push(`${prefix}/research-prompt.md`)
  }

  if (phaseAtLeast(phase, "research_task") || finalizing) {
    for (let previousPass = 1; previousPass < pass; previousPass += 1) {
      required.push(...completeCouncilPassArtifacts(round, previousPass))
    }

    if (pass > 1) {
      required.push(`${prefix}/direction-selection.md`)
    }
  }

  if (phaseAtLeast(phase, "parallel_deliberation") || finalizing) {
    required.push(...councilReportArtifacts(round, pass))
  }

  if (phaseAtLeast(phase, "synthesis") || finalizing) {
    required.push(`${councilPrefix(round, pass)}/synthesis.md`)
  }

  if (
    phaseAtLeast(phase, "execution") ||
    finalizing ||
    state?.deliberationStatus === "ready_for_verdict"
  ) {
    if (usesCouncilPasses(state)) {
      required.push(`${prefix}/direction-selection.md`)
    }
    required.push(`${prefix}/verdict.md`)
  }

  if (phaseAtLeast(phase, "execution") || finalizing) {
    required.push(`${prefix}/verification.md`)
  }

  if (phase === "complete" || finalizing) {
    required.push(`${LOG_DIR}/${FINAL_REPORT_FILE}`)
  }

  return required
}

function currentRoundArtifacts(state) {
  if (usesCouncilPasses(state)) return currentCouncilRoundArtifacts(state)

  const phase = state?.currentPhase
  const round = roundNumber(state)
  const prefix = roundPrefix(round)
  const finalizing = !state?.active && phase !== "blocked"
  const required = []

  if (phaseAtLeast(phase, "research_task") || finalizing) {
    required.push(`${prefix}/research-prompt.md`)
  }

  if (phaseAtLeast(phase, "parallel_deliberation") || finalizing) {
    required.push(
      `${prefix}/report-melchior.md`,
      `${prefix}/report-balthasar.md`,
      `${prefix}/report-casper.md`,
    )
  }

  if (phaseAtLeast(phase, "synthesis") || finalizing) {
    required.push(`${prefix}/synthesis.md`, `${prefix}/verdict.md`)
  }

  if (phaseAtLeast(phase, "execution") || finalizing) {
    required.push(`${prefix}/verification.md`)
  }

  if (phase === "complete" || finalizing) {
    required.push(`${LOG_DIR}/${FINAL_REPORT_FILE}`)
  }

  return required
}

function requiredArtifacts(state) {
  if (!state || state.currentPhase === "blocked") return []
  if (state.active && isTerminalPhase(state.currentPhase)) return []
  if (!state.active) return [`${LOG_DIR}/${FINAL_REPORT_FILE}`]

  const round = roundNumber(state)
  const required = new Set([`${LOG_DIR}/${CHECKLIST_FILE}`])

  for (let previous = 1; previous < round; previous += 1) {
    for (const artifact of completePreviousRoundArtifacts(previous, state)) {
      required.add(artifact)
    }
  }

  for (const artifact of currentRoundArtifacts(state)) {
    required.add(artifact)
  }

  return [...required]
}

async function fileExists(projectRoot, relativePath) {
  try {
    await access(join(projectRoot, relativePath))
    return true
  } catch (error) {
    return false
  }
}

async function findMissingArtifacts(projectRoot, state) {
  const missing = []
  for (const artifact of requiredArtifacts(state)) {
    if (!(await fileExists(projectRoot, artifact))) missing.push(artifact)
  }
  return missing
}

function artifactRepairError(missingArtifacts, nowIso) {
  const summary = missingArtifacts.slice(0, 8).join(", ")
  const extra = missingArtifacts.length > 8 ? `, ... +${missingArtifacts.length - 8} more` : ""
  return `artifact integrity repair required at ${nowIso}: missing ${summary}${extra}`
}

function artifactRepairText(missingArtifacts) {
  if (missingArtifacts.length === 0) return ""

  return [
    "",
    "",
    "[magi] Artifact integrity repair required before any phase transition.",
    "Create the checklist first if it is missing, then read it and repair every missing required artifact below:",
    ...missingArtifacts.map((artifact) => `- ${artifact}`),
    "Do not advance currentPhase or set active=false until every listed artifact exists.",
    "If a deliberator result is unavailable, write that report file with the failure evidence and blocking question instead of omitting it.",
  ].join("\n")
}

function needsRoundTransitionRepair(state) {
  return Boolean(state?.active && roundNumber(state) > 1 && state.currentPhase === "goal_definition")
}

function normalizeCouncilRoundEntry(state) {
  if (!usesCouncilPasses(state)) return state
  if (state?.currentPhase !== "status_assessment") return state
  if (roundNumber(state) <= 1) return state
  if (
    deliberationPassNumber(state) <= 1 &&
    (state.deliberationStatus ?? "not_started") === "not_started"
  ) {
    return state
  }
  return { ...state, currentDeliberationPass: 1, deliberationStatus: "not_started" }
}

function roundTransitionRepairError(state, nowIso) {
  return `round transition repair required at ${nowIso}: currentRound=${roundNumber(state)} cannot resume at goal_definition`
}

function roundTransitionRepairText(state) {
  if (!needsRoundTransitionRepair(state)) return ""

  const round = roundNumber(state)
  const prefix = roundPrefix(round)
  return [
    "",
    "",
    "[magi] Round transition repair required.",
    `currentRound is ${round}, so currentPhase must resume at status_assessment, not goal_definition.`,
    `Read the previous round's verification.md and state.history, then perform Phase 1 status assessment.`,
    `If the goal is still incomplete, do not continue extended single-agent debugging in Phase 2.`,
    `Write ${prefix}/research-prompt.md with the previous failure/diagnostic evidence, then launch all three deliberator subtasks before synthesis or another fix decision.`,
  ].join("\n")
}

function historyProgressMarker(entry) {
  const value = entry?.progress
  if (value === true || value === false) return value
  if (typeof value !== "string") return null

  const normalized = value.trim().toLowerCase()
  if (["true", "yes", "progress", "made_progress"].includes(normalized)) return true
  if (["false", "no", "none", "no_progress"].includes(normalized)) return false
  return null
}

function trailingNoProgressHistoryCount(history) {
  if (!Array.isArray(history) || history.length === 0) return null

  let count = 0
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const marker = historyProgressMarker(history[index])
    if (marker === false) {
      count += 1
      continue
    }
    if (marker === true) return count
    return null
  }
  return count
}

function noProgressLimitError(count, nowIso) {
  return `no progress limit reached at ${nowIso}: consecutiveNoProgress=${count}`
}

async function enforceNoProgressLimit(directory, state, nowMs = Date.now()) {
  if (!state?.active || state.projectRoot !== directory) return { state, blocked: false }

  const stateCount = nonNegativeInteger(state.consecutiveNoProgress, 0)
  const historyCount = trailingNoProgressHistoryCount(state.history)
  const count = Math.max(stateCount, historyCount ?? 0)
  if (count < NO_PROGRESS_LIMIT && count === stateCount) return { state, blocked: false }

  const nowIso = new Date(nowMs).toISOString()
  const nextState =
    count >= NO_PROGRESS_LIMIT
      ? {
          ...state,
          active: false,
          currentPhase: "blocked",
          needsContinue: false,
          inFlight: false,
          inFlightSince: null,
          consecutiveNoProgress: count,
          lastError: noProgressLimitError(count, nowIso),
        }
      : {
          ...state,
          consecutiveNoProgress: count,
        }

  await writeState(directory, nextState)
  return { state: nextState, blocked: count >= NO_PROGRESS_LIMIT }
}

function parseQuestionRequest(text) {
  const request = { raw: text }
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!match) continue
    request[match[1].toLowerCase()] = match[2].trim()
  }
  if (request.classification) request.classification = request.classification.toLowerCase()
  if (request.phase) request.phase = request.phase.toLowerCase()
  return request
}

async function readQuestionRequest(projectRoot) {
  try {
    const text = await readFile(questionRequestPath(projectRoot), "utf8")
    return parseQuestionRequest(text)
  } catch (error) {
    if (error?.code === "ENOENT") return null
    await appendError(projectRoot, "Failed to read question request", error)
    return null
  }
}

async function removeQuestionRequest(projectRoot) {
  try {
    await unlink(questionRequestPath(projectRoot))
  } catch (error) {
    if (error?.code !== "ENOENT") await appendError(projectRoot, "Failed to remove question request", error)
  }
}

function questionPhase(state, request) {
  return request?.phase || state?.currentPhase || ""
}

function isQuestionAllowed(state, request) {
  const classification = request?.classification
  const phase = questionPhase(state, request)
  if (!classification) return false

  if (classification === "procedural") return false
  if (classification === "debug_direction") {
    return roundNumber(state) === 1 && phase === "status_assessment"
  }
  if (classification === "goal_ambiguity") {
    return roundNumber(state) === 1 && (phase === "goal_definition" || phase === "status_assessment")
  }

  return [
    "execution_blocker",
    "impossible_verification",
    "destructive_or_unrelated_risk",
    "ambiguous_file_ownership",
  ].includes(classification)
}

function questionDeniedError(request, nowIso) {
  return `question request denied at ${nowIso}: classification=${request?.classification || "missing"} phase=${request?.phase || "unknown"}`
}

function questionDeniedText(request) {
  if (!request) return ""

  return [
    "",
    "",
    "[magi] Question request denied.",
    `classification: ${request.classification || "missing"}`,
    `phase: ${request.phase || "unknown"}`,
    `question: ${request.question || "(not provided)"}`,
    "Do not ask the user.",
    "Find the answer from local context, existing artifacts, verification output, repository files, or deliberator reports.",
    request.default_action_if_denied
      ? `Execute this default action now: ${request.default_action_if_denied}`
      : "Choose the safest verifiable action allowed by the Magi contract and record it in the next artifact.",
    "Write the decision and evidence into the appropriate Magi artifact, then continue the loop.",
  ].join("\n")
}

async function writeQuestionDenied(projectRoot, request, nowIso) {
  const target = questionDeniedPath(projectRoot)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(
    target,
    [
      "# Question Denied",
      "",
      `denied_at: ${nowIso}`,
      `classification: ${request?.classification || "missing"}`,
      `phase: ${request?.phase || "unknown"}`,
      `question: ${request?.question || ""}`,
      `why_local_context_failed: ${request?.why_local_context_failed || ""}`,
      `commands_or_files_checked: ${request?.commands_or_files_checked || ""}`,
      `default_action_if_denied: ${request?.default_action_if_denied || ""}`,
      "",
      "Decision: denied by Magi question firewall. The main agent must self-answer from local context and continue.",
      "",
    ].join("\n"),
  )
}

function phaseActionText(state, missingArtifacts = []) {
  if (!state?.active || missingArtifacts.length > 0) return ""

  const round = roundNumber(state)
  const pass = deliberationPassNumber(state)
  const maxPasses = maxDeliberationPasses(state)
  const prefix = roundPrefix(round)
  const council = councilPrefix(round, pass)

  if (state.currentPhase === "status_assessment" && round > 1) {
    return [
      "",
      "",
      "[magi] Phase 1 fast path.",
      "This is not a new goal-definition round.",
      "Perform only a short acceptance-criteria check against the latest verification evidence.",
      `If the goal is still incomplete, immediately write ${prefix}/research-prompt.md and set currentPhase=research_task.`,
      "Do not do extended single-agent debugging, diagnostics, or direction selection before the next deliberator round.",
    ].join("\n")
  }

  if (state.currentPhase === "research_task") {
    if (usesCouncilPasses(state)) {
      const firstPass = pass === 1
      return [
        "",
        "",
        `[magi] Phase 2 -> Phase 3 council pass action. Council pass ${pass} of ${maxPasses}.`,
        firstPass
          ? `Use ${prefix}/research-prompt.md as an evidence packet. The main agent must not propose a fix before this proposal pass.`
          : `Use ${prefix}/direction-selection.md and prior council synthesis as source evidence for review pass ${pass}.`,
        `Write ${council}/prompt.md before launching deliberators.`,
        "Do not add extended single-agent analysis before launching deliberators.",
        "Immediately launch exactly these three subtasks with the same council prompt: deliberator-melchior, deliberator-balthasar, deliberator-casper.",
        `After results return, write ${council}/report-melchior.md, ${council}/report-balthasar.md, and ${council}/report-casper.md.`,
        firstPass
          ? "This is the proposal pass: each report must include stance: approve | oppose | needs_evidence, blocking_objection: yes | no, a direction proposal in recommended_plan, verification_plan, and risk_level."
          : "This is a review pass: each report must include stance: approve | oppose | needs_evidence, blocking_objection: yes | no, recommended_plan, verification_plan, risk_level.",
        "If a deliberator fails or times out, still write its report file with failure evidence instead of omitting it.",
        "Do not ask the user whether another council pass is needed. Apply the council stop rules in synthesis.",
      ].join("\n")
    }

    return [
      "",
      "",
      "[magi] Phase 2 -> Phase 3 immediate action.",
      `Use ${prefix}/research-prompt.md as the shared prompt.`,
      "Do not add more single-agent analysis before launching deliberators.",
      "Immediately launch exactly these three subtasks with that same prompt: deliberator-melchior, deliberator-balthasar, deliberator-casper.",
      `After results return, write ${prefix}/report-melchior.md, ${prefix}/report-balthasar.md, and ${prefix}/report-casper.md.`,
      "If a deliberator fails or times out, still write its report file with failure evidence instead of omitting it.",
      "Only after the three report files exist may you continue to synthesis or another fix decision.",
    ].join("\n")
  }

  if (state.currentPhase === "parallel_deliberation" && usesCouncilPasses(state)) {
    return [
      "",
      "",
      `[magi] Phase 3 council report gate. Council pass ${pass} of ${maxPasses}.`,
      `Required report files: ${council}/report-melchior.md, ${council}/report-balthasar.md, ${council}/report-casper.md.`,
      "Do not proceed until all three report files exist; failed deliberators still get a report file with failure evidence.",
      "Do not ask the user what role an agent should play or whether reports are needed.",
    ].join("\n")
  }

  if (state.currentPhase === "synthesis" && usesCouncilPasses(state)) {
    const firstPass = pass === 1
    return [
      "",
      "",
      `[magi] Phase 4 council synthesis gate. Council pass ${pass} of ${maxPasses}.`,
      firstPass
        ? `Write ${council}/synthesis.md comparing the three direction proposals, then write ${prefix}/direction-selection.md with the selected direction and rejected alternatives.`
        : `Write ${council}/synthesis.md with consensus, disagreements, blocking objections, and verification plan for the selected direction.`,
      firstPass
        ? "Pass 1 is not a veto pass. Do not write a verdict yet; select a direction, increment currentDeliberationPass, set deliberationStatus=direction_selected, set currentPhase=research_task, and run review pass 2."
        : "Pass 2 starts veto review: any oppose, needs_evidence, or blocking_objection=yes requires another council pass unless maxDeliberationPasses has been reached.",
      firstPass
        ? "The next action is always review pass 2, not execution."
        : "From Pass 2 onward, proceed to verdict only when at least 2/3 agents support the same executable plan, no new high-risk blocking objection exists, and a clear verification plan exists.",
      firstPass
        ? ""
        : "At maxDeliberationPasses, do not ask the user for direction. Choose the smallest reversible verifiable diagnostic or modification and write the verdict.",
      firstPass
        ? ""
        : "If another council pass is required, write unresolved items, increment currentDeliberationPass, set deliberationStatus=needs_more_deliberation, set currentPhase=research_task, and continue.",
      firstPass
        ? ""
        : `If ready, write ${prefix}/verdict.md and set deliberationStatus=ready_for_verdict.`,
      "Do not ask the user whether another council pass is needed.",
    ].join("\n")
  }

  return ""
}

function continuationLastError(state, decision, missingArtifacts, roundTransitionRepair, questionRequest, nowIso) {
  if (decision.questionDenied) return questionDeniedError(questionRequest, nowIso)
  if (decision.artifactRepair) return artifactRepairError(missingArtifacts, nowIso)
  if (roundTransitionRepair) return roundTransitionRepairError(state, nowIso)
  if (decision.recover) return `recovered active non-terminal loop with needsContinue=false at ${nowIso}`
  if (decision.stale) return `stale inFlight lock reawakened at ${nowIso}`
  return null
}

async function appendError(projectRoot, message, error) {
  const logPath = errorPath(projectRoot)
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? "")
  await mkdir(dirname(logPath), { recursive: true })
  await appendFile(logPath, `[${new Date().toISOString()}] ${message}${detail ? ` - ${detail}` : ""}\n`)
}

async function safeAppendError(projectRoot, message, error) {
  try {
    await appendError(projectRoot, message, error)
  } catch {
    // Hook error containment must not depend on the project directory being writable.
  }
}

async function readState(projectRoot) {
  try {
    return JSON.parse(await readFile(statePath(projectRoot), "utf8"))
  } catch (error) {
    if (error?.code === "ENOENT") return null
    await appendError(projectRoot, "Failed to read state", error)
    return null
  }
}

async function writeState(projectRoot, state) {
  const target = statePath(projectRoot)
  const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`
  await mkdir(dirname(target), { recursive: true })
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`)
  await rename(tmp, target)
}

function enqueueStateWork(directory, work) {
  const previous = STATE_QUEUES.get(directory) || Promise.resolve()
  const next = previous.then(work, work)
  const guarded = next.catch(async (error) => {
    await safeAppendError(directory, "Queued state operation failed", error)
  })
  STATE_QUEUES.set(directory, guarded)
  return guarded
}

async function backupCorruptState(projectRoot, nowIso) {
  let text
  try {
    text = await readFile(statePath(projectRoot), "utf8")
  } catch (error) {
    if (error?.code === "ENOENT") return null
    throw error
  }

  try {
    JSON.parse(text)
    return null
  } catch (error) {
    const relativePath = corruptStateBackupRelativePath(nowIso)
    const target = join(projectRoot, relativePath)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, text)
    return relativePath
  }
}

function stateRepairText(backupPath) {
  return [
    "[magi] State file repair required.",
    "The plugin could not parse `.open_magi/magi-log/state.json`.",
    backupPath ? `A copy of the corrupt file was saved at \`${backupPath}\`.` : "The state file was unavailable or unreadable.",
    "Rebuild `.open_magi/magi-log/state.json` from the latest round artifacts, checklist.md, verification.md, and final-report.md if present.",
    "Do not restart the goal if recoverable evidence exists. After rebuilding state.json, continue the Magi loop from the recovered phase.",
  ].join("\n")
}

async function sendStateRepairPrompt(client, directory, sessionID, backupPath) {
  if (!sessionID) return
  const session = client?.session
  const method = session?.promptAsync || session?.prompt
  if (!method) throw new Error("OpenCode client does not expose session.promptAsync or session.prompt")
  return method.call(session, {
    path: { id: sessionID },
    query: { directory },
    body: {
      agent: "build",
      parts: [{ type: "text", text: stateRepairText(backupPath) }],
    },
  })
}

async function handleCorruptState(client, directory, event, nowMs) {
  const nowIso = new Date(nowMs).toISOString()
  let backupPath = null
  try {
    backupPath = await backupCorruptState(directory, nowIso)
  } catch (error) {
    await appendError(directory, "Failed to back up corrupt state", error)
  }
  if (!backupPath) return false

  try {
    await sendStateRepairPrompt(client, directory, eventSessionID(event), backupPath)
  } catch (error) {
    await appendError(directory, "Failed to send state repair prompt", error)
  }
  return true
}

function isIdleEvent(event) {
  return (
    event?.type === "session.idle" ||
    (event?.type === "session.status" && event?.properties?.status?.type === "idle")
  )
}

function eventSessionID(event) {
  return event?.properties?.sessionID
}

function createdSessionInfo(event) {
  if (event?.type !== "session.created") return null
  return event?.properties?.info || event?.properties || null
}

function createdSessionID(info) {
  return info?.id || info?.sessionID
}

function createdSessionParentID(info) {
  return info?.parentID || info?.parentId
}

function isStaleLock(state, nowMs) {
  if (!state?.inFlight || !state.inFlightSince) return false
  const lockMs = Date.parse(state.inFlightSince)
  return Number.isFinite(lockMs) && nowMs - lockMs > STALE_LOCK_MS
}

function isTerminalPhase(phase) {
  return phase === "complete" || phase === "blocked"
}

function isDeliberatorAgent(agent) {
  return typeof agent === "string" && agent.startsWith("deliberator-")
}

function activeTimeoutEntries(state) {
  if (!state?.activeDeliberators || typeof state.activeDeliberators !== "object") return []
  return Object.entries(state.activeDeliberators).filter(([, entry]) => entry?.status === "timed_out")
}

function deliberatorTimeoutText(state) {
  const entries = activeTimeoutEntries(state)
  if (entries.length === 0) return ""

  return [
    "",
    "",
    "[magi] Deliberator timeout enforced.",
    "The OpenCode plugin aborted the timed-out deliberator child session(s) and wrote timeout report files when they were missing:",
    ...entries.map(([sage, entry]) => `- ${sage}: ${entry.reportPath || deliberatorReportArtifact(state, sage, entry)}`),
    "Treat each timeout report as stance: needs_evidence and blocking_objection: yes.",
    "Do not wait for timed-out deliberators. Do not ask the user for direction. Continue with the Council Pass Gate.",
  ].join("\n")
}

function bashTouchesStateFile(toolInput, directory) {
  if (toolInput?.tool !== "bash") return false
  const command = toolInput?.args?.command || toolInput?.args?.cmd
  if (typeof command !== "string") return false
  return [statePath(directory), `${LOG_DIR}/${STATE_FILE}`].some((target) => {
    const quotedTarget = `(?:"${escapeRegExp(target)}"|'${escapeRegExp(target)}'|${escapeRegExp(target)})`
    const writePatterns = [
      new RegExp(`(?:^|[\\s;&|])(?:>|>>|1>|2>|&>)\\s*${quotedTarget}(?=$|[\\s;&|])`),
      new RegExp(`(?:^|[\\s;&|])tee(?:\\s+-a)?\\s+${quotedTarget}(?=$|[\\s;&|])`),
      new RegExp(`(?:^|[\\s;&|])(?:cp|mv)\\s+\\S+\\s+${quotedTarget}(?=$|[\\s;&|])`),
    ]
    return writePatterns.some((pattern) => pattern.test(command))
  })
}

function isStateWriteTool(toolInput, directory) {
  if (bashTouchesStateFile(toolInput, directory)) return true
  if (!["write", "edit", "multi_edit"].includes(toolInput?.tool)) return false
  const filePath = toolInput?.args?.filePath
  if (typeof filePath !== "string") return false
  return resolve(directory, filePath) === statePath(directory)
}

function canRebindActiveSession(state, sessionID, agent, directory, nowMs = Date.now()) {
  if (!sessionID) return false
  if (!state?.active || state.projectRoot !== directory) return false
  if (!state.sessionID || state.sessionID === sessionID) return false
  if (isTerminalPhase(state.currentPhase)) return false
  if (isDeliberatorAgent(agent)) return false
  if (state.mainAgent && agent && state.mainAgent !== agent) return false
  if (state.inFlight && !isStaleLock(state, nowMs)) return false
  return true
}

async function rebindActiveSession(directory, state, sessionID, agent, reason) {
  const nowIso = new Date().toISOString()
  await writeState(directory, {
    ...state,
    sessionID,
    previousSessionID: state.sessionID,
    mainAgent: state.mainAgent || agent || "build",
    needsContinue: true,
    inFlight: false,
    inFlightSince: null,
    lastError: `rebound active loop from ${state.sessionID} to ${sessionID} at ${nowIso}: ${reason}`,
  })
}

function shouldContinue(state, event, directory, nowMs, missingArtifacts = [], questionDenied = false) {
  if (!isIdleEvent(event)) return { ok: false }
  if (!state?.active) return { ok: false }
  if (state.sessionID !== eventSessionID(event)) return { ok: false }
  if (state.projectRoot !== directory) return { ok: false }

  const artifactRepair = missingArtifacts.length > 0
  const recover = (!state.needsContinue && !isTerminalPhase(state.currentPhase)) || artifactRepair || questionDenied
  if (!state.needsContinue && !recover) return { ok: false }

  const stale = isStaleLock(state, nowMs)
  if (state.inFlight && !stale) return { ok: false }

  return { ok: true, stale, recover: recover && !artifactRepair && !questionDenied, artifactRepair, questionDenied }
}

function buildContinuePayload(state, directory, missingArtifacts = [], extraText = "") {
  return {
    path: { id: state.sessionID },
    query: { directory },
    body: {
      agent: state.mainAgent || "build",
      parts: [
        {
          type: "text",
          text: `${CONTINUE_TEXT}${extraText}${deliberatorTimeoutText(state)}${phaseActionText(state, missingArtifacts)}${artifactRepairText(missingArtifacts)}`,
        },
      ],
    },
  }
}

async function sendContinuePrompt(client, state, directory, missingArtifacts = [], extraText = "") {
  const session = client?.session
  const method = session?.promptAsync || session?.prompt
  if (!method) throw new Error("OpenCode client does not expose session.promptAsync or session.prompt")
  return method.call(session, buildContinuePayload(state, directory, missingArtifacts, extraText))
}

function buildCompactionContext(state) {
  return [
    "[magi active state]",
    `goal: ${state.goal}`,
    `currentRound: ${state.currentRound}`,
    `currentPhase: ${state.currentPhase}`,
    `needsContinue: ${state.needsContinue}`,
    `acceptanceCriteria: ${(state.acceptanceCriteria || []).join(" | ")}`,
    `verificationCommands: ${(state.verificationCommands || []).join(" | ")}`,
    "Resume from .open_magi/magi-log/state.json and checklist.md after compaction. Do not restart the goal.",
    NO_PROCEDURAL_QUESTIONS_TEXT,
  ].join("\n")
}

async function loadMatchingState(directory, sessionID) {
  const state = await readState(directory)
  if (!state?.active || state.sessionID !== sessionID || state.projectRoot !== directory) return null
  return state
}

function oneLine(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
}

function timeoutLastError(timedOut, nowIso) {
  const sages = timedOut.map((item) => item.sage).join(", ")
  return `deliberator timeout enforced at ${nowIso}: ${sages}`
}

function timeoutReportContent({ sage, entry, nowIso, abortError }) {
  const abortErrorText = oneLine(abortError) || "none"
  return [
    "# Deliberator Timeout Report",
    "",
    "status: timeout",
    "stance: needs_evidence",
    "blocking_objection: yes",
    "recommended_plan: none",
    "verification_plan: none",
    "risk_level: medium",
    `agent: ${entry.agent || `deliberator-${sage}`}`,
    `child_session: ${entry.sessionID || "unknown"}`,
    `deadline_at: ${entry.deadlineAt || "unknown"}`,
    `timed_out_at: ${nowIso}`,
    `abort_error: ${abortErrorText}`,
    "",
    "## Summary",
    `The ${sage} deliberator exceeded the configured timeout. The OpenCode plugin aborted the child session and generated this timeout report so the council can continue.`,
    "",
    "## Evidence",
    `- child_session: ${entry.sessionID || "unknown"}`,
    `- deadline_at: ${entry.deadlineAt || "unknown"}`,
    `- timed_out_at: ${nowIso}`,
    "",
    "## Risks",
    "- Missing deliberator evidence can hide a blocking objection.",
    "- Treat this timeout as a veto during early council passes.",
    "",
    "## Recommended Next Action",
    "- Continue the Magi Council Pass Gate with this report recorded as needs_evidence.",
    "",
    "## Confidence",
    "Medium: timeout enforcement is factual, but the missing deliberator analysis is unknown.",
    "",
    "## Blocking Questions",
    "- None",
    "",
  ].join("\n")
}

async function writeTimeoutReport(directory, state, sage, entry, nowIso, abortError) {
  const relativePath = deliberatorReportArtifact(state, sage, entry)
  if (await fileExists(directory, relativePath)) {
    return { relativePath, written: false }
  }

  const target = join(directory, relativePath)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, timeoutReportContent({ sage, entry, nowIso, abortError }))
  return { relativePath, written: true }
}

async function abortDeliberatorSession(client, entry, directory) {
  if (!entry?.sessionID) throw new Error("missing child session id")
  const abort = client?.session?.abort
  if (!abort) throw new Error("OpenCode client does not expose session.abort")
  return abort.call(client.session, {
    path: { id: entry.sessionID },
    query: { directory },
  })
}

function isCurrentDeliberatorEntry(state, entry) {
  const currentRound = roundNumber(state)
  const entryRound = positiveInteger(entry?.round, currentRound)
  if (entryRound !== currentRound) return false

  if (!usesCouncilPasses(state)) return true

  const currentPass = deliberationPassNumber(state)
  const entryPass = positiveInteger(entry?.pass, currentPass)
  return entryPass === currentPass
}

function supersededDeliberatorEntry(state, entry, nowIso) {
  return {
    ...entry,
    status: "superseded",
    supersededAt: nowIso,
    supersededByRound: roundNumber(state),
    supersededByPass: usesCouncilPasses(state) ? deliberationPassNumber(state) : null,
  }
}

async function enforceExpiredDeliberators(client, directory, state, nowMs = Date.now()) {
  if (!state?.active || state.projectRoot !== directory) return { state, timedOut: [] }
  if (!state.activeDeliberators || typeof state.activeDeliberators !== "object") {
    return { state, timedOut: [] }
  }

  const nowIso = new Date(nowMs).toISOString()
  const activeDeliberators = { ...state.activeDeliberators }
  const timeoutCounts = { ...(state.deliberatorTimeoutCounts || {}) }
  const timedOut = []
  const superseded = []

  for (const [sage, entry] of Object.entries(state.activeDeliberators)) {
    if (!entry || entry.status !== "running") continue

    const deadlineMs = Date.parse(entry.deadlineAt)
    if (!Number.isFinite(deadlineMs) || nowMs < deadlineMs) continue

    if (!isCurrentDeliberatorEntry(state, entry)) {
      activeDeliberators[sage] = supersededDeliberatorEntry(state, entry, nowIso)
      superseded.push({ sage, entry: activeDeliberators[sage] })
      continue
    }

    let abortError = null
    try {
      await abortDeliberatorSession(client, entry, directory)
    } catch (error) {
      abortError = error instanceof Error ? error.message : String(error)
      await appendError(directory, `Failed to abort timed-out deliberator ${sage}`, error)
    }

    let reportResult = { relativePath: deliberatorReportArtifact(state, sage, entry), written: false }
    let reportError = null
    try {
      reportResult = await writeTimeoutReport(directory, state, sage, entry, nowIso, abortError)
    } catch (error) {
      reportError = error instanceof Error ? error.message : String(error)
      await appendError(directory, `Failed to write timeout report for ${sage}`, error)
    }

    timeoutCounts[sage] = positiveInteger(timeoutCounts[sage], 0) + 1
    activeDeliberators[sage] = {
      ...entry,
      status: "timed_out",
      timedOutAt: nowIso,
      abortRequestedAt: nowIso,
      abortError,
      reportError,
      reportPath: reportResult.relativePath,
      reportWrittenAt: reportResult.written ? nowIso : entry.reportWrittenAt || null,
    }
    timedOut.push({ sage, entry: activeDeliberators[sage] })
  }

  if (timedOut.length === 0) {
    if (superseded.length === 0) return { state, timedOut }

    const nextState = {
      ...state,
      activeDeliberators,
    }
    await writeState(directory, nextState)
    return { state: nextState, timedOut, superseded }
  }

  const nextState = {
    ...state,
    currentPhase: state.currentPhase === "research_task" ? "parallel_deliberation" : state.currentPhase,
    needsContinue: true,
    inFlight: false,
    inFlightSince: null,
    activeDeliberators,
    deliberatorTimeoutCounts: timeoutCounts,
    lastError: timeoutLastError(timedOut, nowIso),
  }

  await writeState(directory, nextState)
  return { state: nextState, timedOut }
}

async function sweepExpiredDeliberators(client, directory, nowMs = Date.now()) {
  const state = await readState(directory)
  if (!state) return null
  return enforceExpiredDeliberators(client, directory, state, nowMs)
}

async function markDeliberatorCompleted(directory, event, nowMs, clearTimeoutForSession) {
  if (!isIdleEvent(event)) return null
  const childSessionID = eventSessionID(event)
  if (!childSessionID) return null

  const state = await readState(directory)
  if (!state?.activeDeliberators || typeof state.activeDeliberators !== "object") return null

  const match = Object.entries(state.activeDeliberators).find(
    ([, entry]) => entry?.sessionID === childSessionID && entry.status === "running",
  )
  if (!match) return null

  const [sage, entry] = match
  const nextState = {
    ...state,
    activeDeliberators: {
      ...state.activeDeliberators,
      [sage]: {
        ...entry,
        status: "completed",
        completedAt: new Date(nowMs).toISOString(),
      },
    },
  }

  clearTimeoutForSession?.(childSessionID)
  await writeState(directory, nextState)
  return nextState
}

async function recordDeliberatorSession(directory, event, nowMs, scheduleTimeout) {
  const info = createdSessionInfo(event)
  if (!info) return null

  const agent = info.agent
  const sage = deliberatorNameFromAgent(agent)
  if (!sage) return null

  const childSessionID = createdSessionID(info)
  const parentSessionID = createdSessionParentID(info)
  if (!childSessionID || !parentSessionID) return null

  const state = await readState(directory)
  if (!state?.active || state.projectRoot !== directory || state.sessionID !== parentSessionID) return null

  const startedAtMs = Number.isFinite(Date.parse(info.createdAt)) ? Date.parse(info.createdAt) : nowMs
  const startedAt = new Date(startedAtMs).toISOString()
  const deadlineAt = new Date(startedAtMs + deliberatorTimeoutMs(state)).toISOString()
  const entry = {
    agent,
    sessionID: childSessionID,
    parentSessionID,
    round: roundNumber(state),
    pass: usesCouncilPasses(state) ? deliberationPassNumber(state) : undefined,
    startedAt,
    deadlineAt,
    status: "running",
  }
  const nextState = {
    ...state,
    deliberatorTimeoutMs: state.deliberatorTimeoutMs || DEFAULT_DELIBERATOR_TIMEOUT_MS,
    activeDeliberators: {
      ...(state.activeDeliberators || {}),
      [sage]: entry,
    },
  }

  await writeState(directory, nextState)
  scheduleTimeout?.(entry)
  return nextState
}

async function clearInFlightOnMessage(directory, sessionID) {
  const state = await loadMatchingState(directory, sessionID)
  if (!state?.inFlight) return
  await writeState(directory, { ...state, inFlight: false, inFlightSince: null })
}

async function bindSessionOnMessage(directory, sessionID, agent) {
  if (!sessionID) return
  const state = await readState(directory)
  if (isDeliberatorAgent(agent)) return
  if (!state?.active || state.projectRoot !== directory) return
  if (state.mainAgent && agent && state.mainAgent !== agent) return
  if (state.sessionID && state.sessionID !== sessionID) {
    if (canRebindActiveSession(state, sessionID, agent, directory)) {
      await rebindActiveSession(directory, state, sessionID, agent, "new primary chat message")
    }
    return
  }
  if (state.sessionID) return
  await writeState(directory, {
    ...state,
    sessionID,
    mainAgent: state.mainAgent || agent || "build",
  })
}

async function bindSessionOnStateWrite(directory, toolInput) {
  const sessionID = toolInput?.sessionID
  if (!sessionID || !isStateWriteTool(toolInput, directory)) return
  const state = await readState(directory)
  if (!state?.active || state.projectRoot !== directory) return
  if (state.sessionID && state.sessionID !== sessionID) {
    return
  }
  if (state.sessionID) return
  await writeState(directory, {
    ...state,
    sessionID,
    mainAgent: state.mainAgent || "build",
  })
}

async function repairActiveRoundTransitionState(directory, toolInput) {
  const sessionID = toolInput?.sessionID
  if (!sessionID || !isStateWriteTool(toolInput, directory)) return

  const state = await readState(directory)
  if (!state?.active || state.projectRoot !== directory) return
  if (state.sessionID && state.sessionID !== sessionID) return
  if (!needsRoundTransitionRepair(state)) return

  const nowIso = new Date().toISOString()
  await writeState(directory, normalizeCouncilRoundEntry({
    ...state,
    currentPhase: "status_assessment",
    needsContinue: true,
    lastError: roundTransitionRepairError(state, nowIso),
  }))
}

async function repairClosedStateArtifacts(client, directory, toolInput) {
  const sessionID = toolInput?.sessionID
  if (!sessionID || !isStateWriteTool(toolInput, directory)) return

  const state = await readState(directory)
  if (!state || state.active || state.projectRoot !== directory || state.currentPhase === "blocked") return
  if (state.sessionID && state.sessionID !== sessionID) return

  const missingArtifacts = await findMissingArtifacts(directory, state)
  if (missingArtifacts.length === 0) return

  const nowIso = new Date().toISOString()
  const repairState = {
    ...state,
    active: true,
    sessionID: state.sessionID || sessionID,
    currentPhase: isTerminalPhase(state.currentPhase) ? "goal_check" : state.currentPhase || "goal_check",
    needsContinue: true,
    inFlight: true,
    inFlightSince: nowIso,
    lastPromptedRound: state.currentRound,
    lastPromptedAt: nowIso,
    lastError: artifactRepairError(missingArtifacts, nowIso),
  }

  await writeState(directory, repairState)

  try {
    await sendContinuePrompt(client, repairState, directory, missingArtifacts)
  } catch (error) {
    await appendError(directory, "Failed to send artifact repair prompt", error)
    await writeState(directory, {
      ...repairState,
      inFlight: false,
      inFlightSince: null,
      lastError: error instanceof Error ? error.message : String(error),
    })
  }
}

export const server = async (input) => {
  const directory = input.directory
  const timeoutHandles = new Map()

  const clearDeliberatorTimeout = (sessionID) => {
    const handle = timeoutHandles.get(sessionID)
    if (!handle) return
    clearTimeout(handle)
    timeoutHandles.delete(sessionID)
  }

  const scheduleDeliberatorTimeout = (entry) => {
    if (!entry?.sessionID || !entry.deadlineAt) return

    const deadlineMs = Date.parse(entry.deadlineAt)
    if (!Number.isFinite(deadlineMs)) return

    const existing = timeoutHandles.get(entry.sessionID)
    if (existing) clearTimeout(existing)

    const delayMs = Math.max(0, deadlineMs - Date.now())
    const handle = setTimeout(async () => {
      timeoutHandles.delete(entry.sessionID)
      try {
        await enqueueStateWork(directory, async () => {
          const state = await readState(directory)
          await enforceExpiredDeliberators(input.client, directory, state, Date.now())
        })
      } catch (error) {
        await appendError(directory, "Failed to enforce deliberator timeout", error)
      }
    }, delayMs)
    handle.unref?.()
    timeoutHandles.set(entry.sessionID, handle)
  }

  try {
    const state = await readState(directory)
    if (state?.active && state.projectRoot === directory && state.activeDeliberators) {
      for (const entry of Object.values(state.activeDeliberators)) {
        if (entry?.status === "running") scheduleDeliberatorTimeout(entry)
      }
    }
  } catch (error) {
    await safeAppendError(directory, "Failed to reschedule deliberator timeouts", error)
  }

  return {
    event: async ({ event }) => {
      return enqueueStateWork(directory, async () => {
        const now = Date.now()
        await recordDeliberatorSession(directory, event, now, scheduleDeliberatorTimeout)
        await markDeliberatorCompleted(directory, event, now, clearDeliberatorTimeout)
        let state = await readState(directory)
        if (!state) {
          await handleCorruptState(input.client, directory, event, now)
          return
        }

        const timeoutResult = await enforceExpiredDeliberators(input.client, directory, state, now)
        state = timeoutResult.state
        const noProgressResult = await enforceNoProgressLimit(directory, state, now)
        state = noProgressResult.state
        if (noProgressResult.blocked) return
        state = normalizeCouncilRoundEntry(state)

        const questionRequest = await readQuestionRequest(directory)
        if (questionRequest && isQuestionAllowed(state, questionRequest)) {
          await removeQuestionRequest(directory)
          return
        }

        const questionDenied = Boolean(questionRequest)
        const missingArtifacts = questionDenied ? [] : await findMissingArtifacts(directory, state)
        const decision = shouldContinue(state, event, directory, now, missingArtifacts, questionDenied)
        if (!decision.ok) {
          if (questionRequest) await removeQuestionRequest(directory)
          return
        }

        const nowIso = new Date(now).toISOString()
        const roundTransitionRepair = needsRoundTransitionRepair(state)
        const continueState = normalizeCouncilRoundEntry(
          roundTransitionRepair ? { ...state, currentPhase: "status_assessment" } : state,
        )
        const lockedState = {
          ...continueState,
          needsContinue: true,
          inFlight: true,
          inFlightSince: nowIso,
          lastPromptedRound: continueState.currentRound,
          lastPromptedAt: nowIso,
          lastError:
            continuationLastError(state, decision, missingArtifacts, roundTransitionRepair, questionRequest, nowIso) ||
            continueState.lastError ||
            null,
        }

        await writeState(directory, lockedState)
        if (decision.questionDenied) await writeQuestionDenied(directory, questionRequest, nowIso)
        if (questionRequest) await removeQuestionRequest(directory)

        try {
          await sendContinuePrompt(
            input.client,
            lockedState,
            directory,
            missingArtifacts,
            `${roundTransitionRepairText(state)}${questionDeniedText(decision.questionDenied ? questionRequest : null)}`,
          )
        } catch (error) {
          await appendError(directory, "Failed to send continue prompt", error)
          await writeState(directory, {
            ...lockedState,
            inFlight: false,
            inFlightSince: null,
            lastError: error instanceof Error ? error.message : String(error),
          })
        }
      })
    },

    "chat.message": async ({ sessionID, agent }) => {
      return enqueueStateWork(directory, async () => {
        await bindSessionOnMessage(directory, sessionID, agent)
        await clearInFlightOnMessage(directory, sessionID)
        await sweepExpiredDeliberators(input.client, directory)
      })
    },

    "tool.execute.after": async (toolInput) => {
      return enqueueStateWork(directory, async () => {
        await bindSessionOnStateWrite(directory, toolInput)
        await repairActiveRoundTransitionState(directory, toolInput)
        await repairClosedStateArtifacts(input.client, directory, toolInput)
        const state = await readState(directory)
        await enforceNoProgressLimit(directory, state)
        await sweepExpiredDeliberators(input.client, directory)
      })
    },

    "experimental.session.compacting": async ({ sessionID }, output) => {
      return enqueueStateWork(directory, async () => {
        await sweepExpiredDeliberators(input.client, directory)
        const state = await loadMatchingState(directory, sessionID)
        if (!state) return
        output.context = output.context || []
        output.context.push(buildCompactionContext(state))
      })
    },

    "experimental.compaction.autocontinue": async ({ sessionID }, output) => {
      return enqueueStateWork(directory, async () => {
        await sweepExpiredDeliberators(input.client, directory)
        const state = await loadMatchingState(directory, sessionID)
        if (!state) return
        output.enabled = true
      })
    },
  }
}

export const DeliberationPlugin = server
export default server
