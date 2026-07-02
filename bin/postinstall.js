#!/usr/bin/env node
import { setupOpenMagi } from "../lib/setup.js"

if (process.env.OPEN_MAGI_SKIP_POSTINSTALL === "1") {
  process.exit(0)
}

try {
  const result = await setupOpenMagi({ allowDefaultModel: true })
  console.error(
    [
      `[open-magi] OpenCode template written to ${result.configPath}`,
      `[open-magi] External runner template available at ${result.openMagiConfigPath}`,
      `[open-magi] Skill files written to ${result.skillDir}`,
      "[open-magi] Edit default-model fields in opencode.json, and optionally edit open_magi.json for external command runners, then restart OpenCode.",
    ].join("\n"),
  )
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[open-magi] postinstall setup skipped: ${message}`)
}
