export const MAGI_COMMAND = "/magi"
export const SKILL_COMMAND = "skill:magi"

const USE_MARKERS = [
  "use magi",
  "run magi",
  "use the magi",
  "run with magi",
  "run this with magi",
  "start magi",
  "start with magi",
  "through magi",
  "magi skill",
  "\u8acb\u4f7f\u7528 magi",
  "\u8acb\u4f7f\u7528\uff0cmagi",
  "\u7528 magi skill",
  "\u4f7f\u7528 magi",
]

const NEGATION_MARKERS = [
  "do not use magi",
  "don't use magi",
  "do not run",
  "don't run",
  "no magi",
  "without magi",
  "\u4e0d\u8981\u4f7f\u7528 magi",
  "\u4e0d\u7528 magi",
  "\u52ff\u7528 magi",
  "\u4e0d\u8981\u57f7\u884c magi",
]

const QUESTION_SUFFIXES = ["?", "\uff1f"]

export function isInteractiveHost(context) {
  return context?.mode === "tui"
}

function normalize(text) {
  return String(text ?? "").trim().toLowerCase()
}

function containsStandaloneMagi(text) {
  return /(^|[^a-z0-9])magi([^a-z0-9]|$)/.test(text)
}

function hasPositiveMarker(text) {
  return USE_MARKERS.some((marker) => text.includes(marker))
}

function hasGoverningNegation(text) {
  return NEGATION_MARKERS.some((marker) => text.includes(marker))
}

function isQuestionText(text) {
  return QUESTION_SUFFIXES.some((suffix) => text.endsWith(suffix))
}

const NON_INTERACTIVE_MESSAGE =
  "[magi] Non-interactive Pi sessions do not run Magi. Open an interactive Pi session and use /magi <goal>."

function magiIntent(rawText, source) {
  if (source === "extension") return null
  const normalized = normalize(rawText)
  if (normalized === MAGI_COMMAND || normalized.startsWith(`${MAGI_COMMAND} `)) {
    return { kind: "slash" }
  }
  if (!containsStandaloneMagi(normalized)) return null
  if (hasGoverningNegation(normalized)) return null
  if (isQuestionText(normalized)) return null
  if (!hasPositiveMarker(normalized)) return null
  return { kind: "natural" }
}

export function detectActivation(rawText, context) {
  const source = context?.source ?? "interactive"
  const intent = magiIntent(rawText, source)
  if (!intent) return { action: "continue" }
  if (!isInteractiveHost(context)) {
    return { action: "handled", message: NON_INTERACTIVE_MESSAGE }
  }
  if (intent.kind === "slash") {
    const raw = String(rawText ?? "").trimStart()
    const rest = raw === MAGI_COMMAND ? "" : raw.slice(MAGI_COMMAND.length + 1)
    return { action: "transform", text: buildSkillInvocation(rest) }
  }
  return { action: "transform", text: buildSkillInvocation(String(rawText ?? "").trim()) }
}

export function buildSkillInvocation(goal) {
  const trimmed = String(goal ?? "").trim()
  return trimmed ? `/${SKILL_COMMAND} ${trimmed}` : `/${SKILL_COMMAND}`
}

export function injectionOptions(isStreaming) {
  return isStreaming ? { expandPromptTemplates: true, deliverAs: "followUp" } : { expandPromptTemplates: true }
}
