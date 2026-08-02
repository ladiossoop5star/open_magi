#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs"
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

if (!existsSync(statePath)) {
  process.exit(0)
}

if (existsSync(finalReportPath)) {
  let closedState = null
  try {
    closedState = JSON.parse(readFileSync(statePath, "utf8"))
  } catch {
    process.exit(0)
  }

  const usesCouncilModes =
    closedState?.currentCouncilMode !== undefined || Number(closedState?.schemaVersion) >= 2

  if (closedState?.active !== true && usesCouncilModes && closedState?.currentPhase === "complete") {
    const round = Number(closedState?.currentRound)
    const roundName = `round-${String(Number.isInteger(round) && round > 0 ? round : 1).padStart(3, "0")}`
    let reviewVerdict = null
    try {
      reviewVerdict = readFileSync(join(logDir, roundName, "review-verdict.md"), "utf8")
    } catch {
      reviewVerdict = null
    }

    const approved = reviewVerdict !== null && /^\s*outcome\s*:\s*approved\s*$/im.test(reviewVerdict)
    const adherenceConfirmed =
      reviewVerdict !== null && /^\s*verdict_adherence_confirmed\s*:\s*yes\s*$/im.test(reviewVerdict)

    let finalReport = null
    try {
      finalReport = readFileSync(finalReportPath, "utf8")
    } catch {
      finalReport = null
    }
    const squashRecorded =
      finalReport !== null && /^\s*squash_commit\s*:\s*\S+\s*$/im.test(finalReport)

    if (!approved || !adherenceConfirmed || !squashRecorded) {
      emitContinuation(
        [
          "<MAGI_STOP_BACKSTOP>",
          "Magi completion review did not approve the actual diff.",
          `statePath: ${statePath}`,
          `finalReportPath: ${finalReportPath}`,
          `currentRound: ${closedState.currentRound ?? "unknown"}`,
          `currentPhase: ${closedState.currentPhase ?? "unknown"}`,
          approved ? "" : `missing: ${roundName}/review-verdict.md with outcome: approved`,
          adherenceConfirmed ? "" : `missing: verdict_adherence_confirmed: yes in ${roundName}/review-verdict.md`,
          squashRecorded ? "" : "missing: squash_commit in final-report.md",
          "A schemaVersion 2 Magi loop may close only when review-verdict.md records outcome: approved and verdict_adherence_confirmed: yes from the adversarial review council, and final-report.md records squash_commit after the loop's commits were squashed and verification re-run.",
          "If the review objected, restore active=true and needsContinue=true, then start the next round with the objections as evidence. Do not finalize on the main agent's own judgment.",
          "</MAGI_STOP_BACKSTOP>",
        ]
          .filter((line) => line !== "")
          .join("\n"),
      )
    }
  }
  process.exit(0)
}

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

if (state?.active !== true) {
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
