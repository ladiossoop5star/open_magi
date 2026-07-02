#!/usr/bin/env node
import { defaultConfigDir, ensureOpenMagiConfigTemplate, installMagiSkill } from "../lib/setup.js"

async function main() {
  if (process.env.OPEN_MAGI_SKIP_POSTINSTALL === "1") return

  const configDir = defaultConfigDir()
  const skill = await installMagiSkill(configDir)
  const config = await ensureOpenMagiConfigTemplate(configDir)
  const action = config.created ? "created" : "exists"
  console.log(`open-magi: installed ${skill.skillDir}`)
  console.log(`open-magi: ${action} ${config.configPath}`)
}

main().catch((error) => {
  console.warn(`open-magi: postinstall skipped: ${error.message}`)
})
