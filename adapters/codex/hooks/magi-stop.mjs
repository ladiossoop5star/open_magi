#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const logDir = join(process.cwd(), ".open_magi", "magi-log")
const statePath = join(logDir, "state.json")
const finalReportPath = join(logDir, "final-report.md")

if (process.env.OPEN_MAGI_DISABLE_STOP_BACKSTOP === "1") {
  process.exit(0)
}

function emitContinuation(text) {
  process.stdout.write(`${JSON.stringify({ decision: "block", reason: text })}\n`)
}

function asList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()) : []
}

function positiveInteger(value) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

function roundName(round) {
  return `round-${String(round).padStart(3, "0")}`
}

function artifactExists(relativePath) {
  return existsSync(join(logDir, relativePath))
}

function existingRoundNumbers() {
  try {
    return readdirSync(logDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^round-\d{3}$/.test(entry.name))
      .map((entry) => positiveInteger(entry.name.slice("round-".length)))
      .filter((round) => round !== null)
  } catch {
    return []
  }
}

function existingCouncilNames(round) {
  const roundDir = join(logDir, roundName(round))
  try {
    return readdirSync(roundDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^council-\d{3}$/.test(entry.name))
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

function roundsToValidate(state) {
  const rounds = new Set()
  const currentRound = positiveInteger(state?.currentRound)

  if (currentRound !== null && currentRound > 1) {
    for (let round = 1; round <= currentRound; round += 1) {
      rounds.add(round)
    }
  }

  for (const entry of Array.isArray(state?.history) ? state.history : []) {
    const round = positiveInteger(entry?.round)
    if (round !== null) rounds.add(round)
  }

  for (const round of existingRoundNumbers()) {
    rounds.add(round)
  }

  if (currentRound === 1 && rounds.size === 0) {
    return []
  }

  return [...rounds].sort((a, b) => a - b)
}

function missingCompletionArtifacts(state) {
  const missing = []

  for (const round of roundsToValidate(state)) {
    const prefix = roundName(round)
    const councils = existingCouncilNames(round)
    const councilNames = councils.length > 0 ? councils : ["council-001"]
    const required = [
      `${prefix}/research-prompt.md`,
      `${prefix}/direction-selection.md`,
      `${prefix}/verdict.md`,
      `${prefix}/verification.md`,
    ]

    for (const council of councilNames) {
      required.push(
        `${prefix}/${council}/prompt.md`,
        `${prefix}/${council}/report-melchior.md`,
        `${prefix}/${council}/report-balthasar.md`,
        `${prefix}/${council}/report-casper.md`,
        `${prefix}/${council}/synthesis.md`,
      )
    }

    for (const relativePath of required) {
      if (!artifactExists(relativePath)) {
        missing.push(relativePath)
      }
    }
  }

  return missing
}

function emitMissingArtifactContinuation(state, missing) {
  const shown = missing.slice(0, 40)
  const lines = [
    "<MAGI_STOP_BACKSTOP>",
    "Magi final report exists but required round artifacts are missing.",
    `statePath: ${statePath}`,
    `finalReportPath: ${finalReportPath}`,
    `currentRound: ${state.currentRound ?? "unknown"}`,
    `currentPhase: ${state.currentPhase ?? "unknown"}`,
    `missingArtifactCount: ${missing.length}`,
    "missingArtifacts:",
  ]

  for (const relativePath of shown) {
    lines.push(`- ${relativePath}`)
  }

  if (missing.length > shown.length) {
    lines.push(`- ... ${missing.length - shown.length} more omitted`)
  }

  lines.push(
    "Repair the Magi log before stopping: reconstruct missing artifacts from actual session output if the work is truly complete, or restore active=true and needsContinue=true at the earliest missing phase.",
    "Do not rewrite history to pretend skipped rounds followed Magi. If a round was skipped, record that violation in the repaired artifact and resume the next proper council pass.",
    "</MAGI_STOP_BACKSTOP>",
  )

  emitContinuation(lines.join("\n"))
}

if (!existsSync(statePath)) {
  process.exit(0)
}

const finalReportExists = existsSync(finalReportPath)

let state
try {
  state = JSON.parse(readFileSync(statePath, "utf8"))
} catch (error) {
  emitContinuation(
    [
      "<MAGI_STOP_BACKSTOP>",
      "Magi state appears corrupt.",
      `statePath: ${statePath}`,
      `error: ${error.message}`,
      "Read the Magi troubleshooting reference, repair state.json from .open_magi/magi-log history, then continue the Magi loop without asking procedural questions.",
      "</MAGI_STOP_BACKSTOP>",
    ].join("\n"),
  )
  process.exit(0)
}

if (finalReportExists && state?.active === false && state?.currentPhase === "complete") {
  const missing = missingCompletionArtifacts(state)
  if (missing.length > 0) {
    emitMissingArtifactContinuation(state, missing)
  }
  process.exit(0)
}

if (finalReportExists) {
  process.exit(0)
}

if (state?.active !== true) {
  if (state?.currentPhase === "complete") {
    const verificationCommands = asList(state.verificationCommands)
    const lines = [
      "<MAGI_STOP_BACKSTOP>",
      "Magi loop was marked complete but final-report.md is missing. This is an invalid terminal state.",
      `statePath: ${statePath}`,
      `currentRound: ${state.currentRound ?? "unknown"}`,
      `currentPhase: ${state.currentPhase ?? "unknown"}`,
      `needsContinue: ${state.needsContinue ?? "unknown"}`,
      `goal: ${state.goal ?? "unknown"}`,
    ]

    if (verificationCommands.length > 0) {
      lines.push("verificationCommands:")
      for (const command of verificationCommands) {
        lines.push(`- ${command}`)
      }
    }

    lines.push(
      "Required next action: read the Magi skill and required references, inspect .open_magi/magi-log/checklist.md, and inspect the latest verification evidence.",
      "If the goal is already complete, write final-report.md before stopping and keep active=false with currentPhase=complete.",
      "If the goal is not complete, restore active=true, set needsContinue=true, move to the appropriate next phase or round, and continue without asking for direction.",
      "Do not ask procedural questions. If a user question seems necessary, follow the Magi question firewall first.",
      "</MAGI_STOP_BACKSTOP>",
    )

    emitContinuation(lines.join("\n"))
  }
  process.exit(0)
}

const verificationCommands = asList(state.verificationCommands)
const lines = [
  "<MAGI_STOP_BACKSTOP>",
  "Magi loop is still active. Continue the Magi loop instead of stopping silently.",
  `statePath: ${statePath}`,
  `currentRound: ${state.currentRound ?? "unknown"}`,
  `currentPhase: ${state.currentPhase ?? "unknown"}`,
  `needsContinue: ${state.needsContinue ?? "unknown"}`,
  `goal: ${state.goal ?? "unknown"}`,
]

if (verificationCommands.length > 0) {
  lines.push("verificationCommands:")
  for (const command of verificationCommands) {
    lines.push(`- ${command}`)
  }
}

lines.push(
  "Required next action: read the Magi skill and required references, inspect .open_magi/magi-log/checklist.md, repair any missing current-round artifacts, and continue until verification passes and final-report.md exists.",
  "Do not ask procedural questions. If a user question seems necessary, follow the Magi question firewall first.",
  "</MAGI_STOP_BACKSTOP>",
)

emitContinuation(lines.join("\n"))
