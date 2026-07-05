#!/usr/bin/env node
import { parseArgs } from "node:util"
import { readFile } from "node:fs/promises"
import { setupClaudeMagi } from "../lib/setup.js"
import { runClaudeCouncil } from "../lib/claude-runner.js"

function printHelp() {
  console.log(`open-magi-claude

Usage:
  open-magi-claude setup-claude
  open-magi-claude setup-claude --melchior-model model --balthasar-model model --casper-model model
  open-magi-claude setup-claude --plugin-dir ~/.claude/skills/open-magi --force
  open-magi-claude run-council --project-root path --prompt-path path --round N --pass N [--plugin-dir path] [--claude-bin path] [--timeout-ms ms]
  open-magi-claude --version

Options:
  --plugin-dir        Generated Claude skills-dir plugin directory. Defaults to CLAUDE_HOME/skills/open-magi or ~/.claude/skills/open-magi.
  --melchior-model   Concrete Claude model for open-magi:deliberator-melchior.
  --balthasar-model  Concrete Claude model for open-magi:deliberator-balthasar.
  --casper-model     Concrete Claude model for open-magi:deliberator-casper.
  --force            Overwrite existing generated files.
  --dry-run          Print the setup summary without writing files.
  --project-root     Project root for run-council.
  --prompt-path      Council prompt path for run-council.
  --round            Magi round number for run-council.
  --pass             Council pass number for run-council.
  --claude-bin       Claude executable for run-council. Defaults to OPEN_MAGI_CLAUDE_BIN or claude.
  --timeout-ms       Per-deliberator timeout for run-council.

Without model flags, setup writes editable templates with model: default-model.
Edit the three files under ~/.claude/skills/open-magi/agents/ before using Magi.
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
  if (command === "run-council") {
    const { values } = parseArgs({
      args: argv.slice(3),
      options: {
        "project-root": { type: "string" },
        "prompt-path": { type: "string" },
        round: { type: "string" },
        pass: { type: "string" },
        "plugin-dir": { type: "string" },
        "claude-bin": { type: "string" },
        "timeout-ms": { type: "string" },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: false,
    })
    if (values.help) {
      printHelp()
      return
    }
    for (const name of ["project-root", "prompt-path", "round", "pass"]) {
      if (!values[name]) throw new Error(`run-council requires --${name}`)
    }
    const result = await runClaudeCouncil({
      projectRoot: values["project-root"],
      promptPath: values["prompt-path"],
      round: Number(values.round),
      pass: Number(values.pass),
      pluginDir: values["plugin-dir"],
      claudeBin: values["claude-bin"],
      timeoutMs: values["timeout-ms"] ? Number(values["timeout-ms"]) : undefined,
    })
    console.log(JSON.stringify(result, null, 2))
    if (!result.ok) process.exitCode = 1
    return
  }

  if (command !== "setup-claude") {
    throw new Error(`Unknown command: ${command}`)
  }

  const { values } = parseArgs({
    args: argv.slice(3),
    options: {
      "plugin-dir": { type: "string" },
      "melchior-model": { type: "string" },
      "balthasar-model": { type: "string" },
      "casper-model": { type: "string" },
      force: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  })

  if (values.help) {
    printHelp()
    return
  }

  const result = await setupClaudeMagi({
    pluginDir: values["plugin-dir"],
    melchiorModel: values["melchior-model"],
    balthasarModel: values["balthasar-model"],
    casperModel: values["casper-model"],
    force: values.force,
    dryRun: values["dry-run"],
  })

  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun: result.dryRun,
        pluginDir: result.pluginDir,
        files: result.files.map((file) => file.path),
        written: result.written.map((file) => file.path),
        skipped: result.skipped.map((file) => file.path),
        reloadRequired: true,
      },
      null,
      2,
    ),
  )
}

main(process.argv).catch((error) => {
  console.error(`open-magi-claude: ${error.message}`)
  process.exitCode = 1
})
