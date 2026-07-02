#!/usr/bin/env node
import { parseArgs } from "node:util"
import { readFile } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { createInterface } from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import { setupCodexMagi } from "../lib/setup.js"
import { runCouncil } from "../lib/codex-runner.js"

function printHelp() {
  console.log(`open-magi

Usage:
  open-magi setup-codex
  open-magi setup-codex --interactive [--agents-dir path]
  open-magi setup-codex --melchior-model model --balthasar-model model --casper-model model [--provider provider] [--agents-dir path] [--dry-run]
  open-magi run-council --project-root path --prompt-path path --round N --pass N [--timeout-ms ms]
  open-magi --version

Options:
  --agents-dir        Codex custom agents directory. Defaults to CODEX_HOME/agents or ~/.codex/agents.
  --provider          Codex model_provider to apply to all three deliberators.
  --*-provider        Per-deliberator Codex model_provider override.
  --*-effort          Per-deliberator model_reasoning_effort override.
  --interactive       Prompt for Codex deliberator settings. Without this flag, setup-codex writes editable templates.
  --dry-run           Print the setup summary without writing files.
  --project-root      Project root for run-council.
  --prompt-path       Council prompt path for run-council.
  --round             Magi round number for run-council.
  --pass              Council pass number for run-council.
  --timeout-ms        Per-deliberator timeout for run-council.
`)
}

async function packageVersion() {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
  return pkg.version
}

function createQuestioner() {
  if (!input.isTTY) {
    const rawInput = readFileSync(0, "utf8")
    const answers = rawInput ? rawInput.split(/\r?\n/) : []
    let index = 0
    return {
      question: async (prompt) => {
        output.write(prompt)
        if (index >= answers.length) {
          throw new Error(
            "interactive setup requires input; in Codex ask the user for provider and model names, then run setup-codex with explicit --melchior-model, --balthasar-model, --casper-model, and optional --provider",
          )
        }
        return answers[index++]
      },
      close: () => {},
    }
  }

  return createInterface({ input, output })
}

async function interactiveCodexSetupOptions(values) {
  const rl = createQuestioner()

  try {
    const askOptional = async (label, current, fallbackLabel = "inherit") => {
      if (current) return current
      const answer = (await rl.question(`${label} [${fallbackLabel}]: `)).trim()
      return answer || undefined
    }
    const askRequired = async (label, current) => {
      if (current) return current
      while (true) {
        const answer = (await rl.question(`${label}: `)).trim()
        if (answer) return answer
        console.log(`${label} is required.`)
      }
    }

    let provider = values.provider
    let clearProvider = false
    if (!provider) {
      const customProvider = (await rl.question("Use a specific model provider? [y/N]: ")).trim()
      if (/^(y|yes)$/i.test(customProvider)) {
        provider = await askRequired("Provider", values.provider)
      } else {
        clearProvider = true
      }
    }
    const melchiorModel = await askRequired("Melchior model", values["melchior-model"])
    const balthasarModel = await askRequired("Balthasar model", values["balthasar-model"])
    const casperModel = await askRequired("Casper model", values["casper-model"])
    const reasoningEffort = await askOptional("Common reasoning effort", values["reasoning-effort"])
    const agentsDir = values["agents-dir"]
    const confirm = (await rl.question(`Write Codex custom agents${agentsDir ? ` to ${agentsDir}` : ""}? [Y/n]: `)).trim()

    if (/^(n|no)$/i.test(confirm)) {
      return { cancelled: true }
    }

    return {
      agentsDir,
      provider,
      clearProvider,
      melchiorModel,
      balthasarModel,
      casperModel,
      melchiorProvider: values["melchior-provider"],
      balthasarProvider: values["balthasar-provider"],
      casperProvider: values["casper-provider"],
      melchiorEffort: values["melchior-effort"],
      balthasarEffort: values["balthasar-effort"],
      casperEffort: values["casper-effort"],
      reasoningEffort,
      dryRun: values["dry-run"],
    }
  } finally {
    rl.close()
  }
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
        "timeout-ms": { type: "string" },
        "agents-dir": { type: "string" },
        "codex-bin": { type: "string" },
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
    const result = await runCouncil({
      projectRoot: values["project-root"],
      promptPath: values["prompt-path"],
      round: Number(values.round),
      pass: Number(values.pass),
      timeoutMs: values["timeout-ms"] ? Number(values["timeout-ms"]) : undefined,
      agentsDir: values["agents-dir"],
      codexBin: values["codex-bin"],
    })
    console.log(JSON.stringify(result, null, 2))
    if (!result.ok) process.exitCode = 1
    return
  }

  if (command !== "setup-codex") {
    throw new Error(`Unknown command: ${command}`)
  }

  const setupArgs = argv.slice(3)
  const { values } = parseArgs({
    args: setupArgs,
    options: {
      "agents-dir": { type: "string" },
      provider: { type: "string" },
      "melchior-model": { type: "string" },
      "balthasar-model": { type: "string" },
      "casper-model": { type: "string" },
      "melchior-provider": { type: "string" },
      "balthasar-provider": { type: "string" },
      "casper-provider": { type: "string" },
      "melchior-effort": { type: "string" },
      "balthasar-effort": { type: "string" },
      "casper-effort": { type: "string" },
      "reasoning-effort": { type: "string" },
      interactive: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  })

  if (values.help) {
    printHelp()
    return
  }

  const options = values.interactive
    ? await interactiveCodexSetupOptions(values)
    : {
        agentsDir: values["agents-dir"],
        provider: values.provider,
        melchiorModel: values["melchior-model"],
        balthasarModel: values["balthasar-model"],
        casperModel: values["casper-model"],
        melchiorProvider: values["melchior-provider"],
        balthasarProvider: values["balthasar-provider"],
        casperProvider: values["casper-provider"],
        melchiorEffort: values["melchior-effort"],
        balthasarEffort: values["balthasar-effort"],
        casperEffort: values["casper-effort"],
        reasoningEffort: values["reasoning-effort"],
        dryRun: values["dry-run"],
      }

  if (options.cancelled) {
    console.log(JSON.stringify({ ok: false, cancelled: true }, null, 2))
    return
  }

  const result = await setupCodexMagi(options)

  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun: result.dryRun,
        agentsDir: result.agentsDir,
        agentFiles: result.agentFiles.map((file) => file.path),
        written: result.written.map((file) => file.path),
        skipped: result.skipped.map((file) => file.path),
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
