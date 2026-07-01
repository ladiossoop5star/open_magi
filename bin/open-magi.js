#!/usr/bin/env node
import { parseArgs } from "node:util"
import { readFile } from "node:fs/promises"
import { setupOpenMagi } from "../lib/setup.js"

function printHelp() {
  console.log(`open-magi

Usage:
  open-magi setup --model provider/model [--config-dir path] [--plugin-spec spec] [--dry-run]
  open-magi --version

Options:
  --model        Required model for all three deliberator subagents.
  --config-dir   OpenCode config directory. Defaults to OPENCODE_CONFIG_DIR or ~/.config/opencode.
  --plugin-spec  Plugin spec to add to opencode.json. Defaults to open-magi-opencode.
  --dry-run      Print the merged config summary without writing files.
`)
}

async function packageVersion() {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
  return pkg.version
}

async function main(argv) {
  const command = argv[2]
  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp()
    return
  }
  if (command === "--version" || command === "-v") {
    console.log(await packageVersion())
    return
  }
  if (command !== "setup") {
    throw new Error(`Unknown command: ${command}`)
  }

  const { values } = parseArgs({
    args: argv.slice(3),
    options: {
      model: { type: "string" },
      "config-dir": { type: "string" },
      "plugin-spec": { type: "string" },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  })

  if (values.help) {
    printHelp()
    return
  }

  const result = await setupOpenMagi({
    model: values.model,
    configDir: values["config-dir"],
    pluginSpec: values["plugin-spec"],
    dryRun: values["dry-run"],
  })

  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun: result.dryRun,
        configPath: result.configPath,
        skillDir: result.skillDir,
        model: result.model,
        pluginSpec: result.pluginSpec,
      },
      null,
      2,
    ),
  )
}

main(process.argv).catch((error) => {
  console.error(`open-magi: ${error.message}`)
  process.exitCode = 1
})
