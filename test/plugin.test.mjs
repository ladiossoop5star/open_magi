import { runPluginTests } from "./plugin-suite.mjs"

await runPluginTests(() => import("../index.js"))
