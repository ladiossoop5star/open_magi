#!/usr/bin/env node
import { parseArgs } from "node:util"
import { readFile } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { createInterface } from "node:readline/promises"
import { stdin as input, stderr as promptOutput } from "node:process"
import { setupOpenMagi } from "../lib/setup.js"

function printHelp() {
  console.log(`open-magi

Usage:
  open-magi setup
  open-magi setup --model provider/model [--config-dir path] [--plugin-spec spec] [--dry-run]
  open-magi setup --melchior-model model --balthasar-model model --casper-model model [--config-dir path] [--plugin-spec spec] [--dry-run]
  open-magi --version

Options:
  --model             OpenCode model for all three deliberator subagents.
  --*-model           Per-deliberator OpenCode model override.
  --config-dir        OpenCode config directory. Defaults to OPENCODE_CONFIG_DIR or ~/.config/opencode.
  --plugin-spec       Plugin spec to add to opencode.json. Defaults to open-magi-opencode.
  --interactive       Prompt for OpenCode deliberator settings. This is the default when setup has no model options.
  --dry-run           Print the setup summary without writing files.
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
        promptOutput.write(prompt)
        if (index >= answers.length) {
          throw new Error(
            "interactive setup requires input; rerun setup with --model or all --melchior-model, --balthasar-model, and --casper-model flags",
          )
        }
        return answers[index++]
      },
      close: () => {},
    }
  }

  return createInterface({ input, output: promptOutput })
}

async function interactiveOpenCodeSetupOptions(values) {
  const rl = createQuestioner()

  try {
    const askRequired = async (label, current) => {
      if (current) return current
      while (true) {
        const answer = (await rl.question(`${label}: `)).trim()
        if (answer) return answer
        promptOutput.write(`${label} is required.\n`)
      }
    }

    let model = values.model
    let melchiorModel = values["melchior-model"]
    let balthasarModel = values["balthasar-model"]
    let casperModel = values["casper-model"]
    const hasAnyPerModel = Boolean(melchiorModel || balthasarModel || casperModel)
    const useSharedAnswer = model && !hasAnyPerModel
      ? "y"
      : (await rl.question("Use one model for all three deliberators? [Y/n]: ")).trim()

    if (/^(n|no)$/i.test(useSharedAnswer)) {
      melchiorModel = await askRequired("Melchior model", melchiorModel)
      balthasarModel = await askRequired("Balthasar model", balthasarModel)
      casperModel = await askRequired("Casper model", casperModel)
      model = undefined
    } else {
      model = await askRequired("Shared deliberator model", model)
      melchiorModel = undefined
      balthasarModel = undefined
      casperModel = undefined
    }

    const configTarget = values["config-dir"] || "the OpenCode config directory"
    const confirm = (await rl.question(`Write OpenCode Magi setup to ${configTarget}? [Y/n]: `)).trim()

    if (/^(n|no)$/i.test(confirm)) {
      return { cancelled: true }
    }

    return {
      configDir: values["config-dir"],
      pluginSpec: values["plugin-spec"],
      model,
      melchiorModel,
      balthasarModel,
      casperModel,
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
  if (command !== "setup") {
    throw new Error(`Unknown command: ${command}`)
  }

  const { values } = parseArgs({
    args: argv.slice(3),
    options: {
      model: { type: "string" },
      "melchior-model": { type: "string" },
      "balthasar-model": { type: "string" },
      "casper-model": { type: "string" },
      "config-dir": { type: "string" },
      "plugin-spec": { type: "string" },
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

  const hasModelOptions = Boolean(
    values.model || values["melchior-model"] || values["balthasar-model"] || values["casper-model"],
  )
  const options = values.interactive || !hasModelOptions
    ? await interactiveOpenCodeSetupOptions(values)
    : {
        model: values.model,
        melchiorModel: values["melchior-model"],
        balthasarModel: values["balthasar-model"],
        casperModel: values["casper-model"],
        configDir: values["config-dir"],
        pluginSpec: values["plugin-spec"],
        dryRun: values["dry-run"],
      }

  if (options.cancelled) {
    console.log(JSON.stringify({ ok: false, cancelled: true }, null, 2))
    return
  }

  const result = await setupOpenMagi(options)

  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun: result.dryRun,
        configPath: result.configPath,
        magiConfigPath: result.magiConfigPath,
        skillDir: result.skillDir,
        model: result.model,
        models: result.models,
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
