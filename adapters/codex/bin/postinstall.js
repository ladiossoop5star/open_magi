#!/usr/bin/env node
import { fileURLToPath } from "node:url"

import { setupCodexMagi, writeCodexMcpConfig } from "../lib/setup.js"

if (process.env.OPEN_MAGI_SKIP_POSTINSTALL === "1") {
  process.exit(0)
}

const packageRoot = fileURLToPath(new URL("..", import.meta.url))

function shouldWriteMcpConfig() {
  if (process.env.OPEN_MAGI_WRITE_MCP_CONFIG === "1") return true
  return !packageRoot.includes("/adapters/codex")
}

try {
  const result = await setupCodexMagi()
  const mcp = shouldWriteMcpConfig() ? await writeCodexMcpConfig({ packageRoot }) : null
  console.error(
    [
      `[open-magi] Codex templates written to ${result.agentsDir}`,
      `[open-magi] Created ${result.written.length}; kept ${result.skipped.length} existing files.`,
      mcp ? `[open-magi] Codex MCP config written to ${mcp.path}` : "[open-magi] Codex MCP config unchanged in source checkout.",
      '[open-magi] Edit model = "default-model" in ~/.codex/agents/deliberator-*.toml before using Magi.',
    ].join("\n"),
  )
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[open-magi] Codex postinstall setup skipped: ${message}`)
}
