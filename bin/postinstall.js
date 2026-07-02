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
      `[open-magi] Skill files written to ${result.skillDir}`,
      "[open-magi] Edit the three deliberator model fields if they still use default-model, then restart OpenCode.",
    ].join("\n"),
  )
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[open-magi] postinstall setup skipped: ${message}`)
}
