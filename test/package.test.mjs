import assert from "node:assert/strict"
import { execFile as execFileCallback } from "node:child_process"
import { access, readFile, readdir } from "node:fs/promises"
import { constants } from "node:fs"
import { join, relative } from "node:path"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"
import test from "node:test"

const repoRoot = fileURLToPath(new URL("../", import.meta.url))
const hanPattern = /\p{Script=Han}/u
const execFile = promisify(execFileCallback)
const chars = (...codes) => String.fromCodePoint(...codes)
const oldExampleModel = ["deepseek", "-spark3/deepseek", "-spark3"].join("")
const localOnlyModel = ["qw", "en"].join("")
const localStatusWarning = ["unavailable", "or", "restarting"].join(" ")
const requiredMagiReferences = [
  "checklist-template.md",
  "deliberation.md",
  "execution-and-verification.md",
  "protocol.md",
  "question-firewall.md",
  "troubleshooting.md",
]

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue
    if (/\.sw[pon]$/i.test(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path)))
    } else if (entry.isFile()) {
      files.push(path)
    }
  }
  return files
}

async function readMagiReferences() {
  const entries = await Promise.all(
    requiredMagiReferences.map(async (name) => {
      const text = await readFile(new URL(`../skills/magi/references/${name}`, import.meta.url), "utf8")
      return [name, text]
    }),
  )
  return Object.fromEntries(entries)
}

async function listTrackedFiles() {
  const { stdout } = await execFile("git", ["ls-files"], { cwd: repoRoot })
  return stdout.trim().split("\n").filter(Boolean)
}

test("package metadata exposes OpenCode plugin, setup CLI, and injected plugin tests", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))

  assert.equal(pkg.name, "open-magi-opencode")
  assert.equal(pkg.type, "module")
  assert.equal(pkg.repository.url, "git+https://github.com/ladiossoop5star/open_magi.git")
  assert.equal(pkg.main, "./index.js")
  assert.equal(pkg.exports["."], "./index.js")
  assert.equal(pkg.exports["./setup"], "./lib/setup.js")
  assert.equal(pkg.bin["open-magi"], "bin/open-magi.js")
  assert.equal(pkg.files.includes("README.zh-TW.md"), true)
  assert.equal(pkg.scripts.test, "node --test test/package.test.mjs test/plugin.test.mjs test/setup.test.mjs")
  const suitePath = new URL("./plugin-suite.mjs", import.meta.url)
  const suite = await readFile(suitePath, "utf8")
  const wrapper = await readFile(new URL("./plugin.test.mjs", import.meta.url), "utf8")
  const suiteModule = await import(suitePath.href)

  assert.equal(typeof suiteModule.runPluginTests, "function")
  assert.match(suite, /export\s+async\s+function\s+runPluginTests/)
  assert.doesNotMatch(suite, /\.\.\/index\.js/)
  assert.match(wrapper, /runPluginTests/)
  assert.match(wrapper, /\.\.\/index\.js/)
  assert.doesNotMatch(wrapper, /test\("idle event/)
})

test("English README documents install and avoids local-only model warnings", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8")

  assert.match(readme, /\[Traditional Chinese\]\(README\.zh-TW\.md\)/)
  assert.match(readme, /Until the npm package is published, install directly from this public GitHub/)
  assert.match(readme, /opencode plugin open-magi-opencode -g/)
  assert.match(readme, /open-magi setup|npx open-magi-opencode setup/)
  assert.match(readme, /Ask an AI agent to install it/)
  assert.match(readme, /Please install the public OpenCode plugin `open-magi-opencode`/)
  assert.match(readme, /deliberator-melchior/)
  assert.match(readme, /deepseek-v4-flash/)
  assert.match(readme, /\.open_magi\/magi-log/)
  assert.match(readme, /Development Hygiene/)
  assert.match(readme, /Small changes, documentation edits, and routine debugging may be committed\s+directly on `main`/)
  assert.match(readme, /Use a feature branch for risky or large changes/)
  assert.doesNotMatch(readme, new RegExp(oldExampleModel))
  assert.doesNotMatch(readme, new RegExp(localStatusWarning, "i"))
  assert.doesNotMatch(readme, new RegExp(`--model ${localOnlyModel}`, "i"))
  assert.doesNotMatch(readme, new RegExp("pr" + "ivate", "i"))
})

test("Traditional Chinese README exists for zh-TW users", async () => {
  const readme = await readFile(new URL("../README.zh-TW.md", import.meta.url), "utf8")

  assert.match(readme, hanPattern)
  assert.match(readme, /AI agent/)
  assert.match(readme, /deepseek-v4-flash/)
  assert.match(readme, /\.open_magi\/magi-log/)
  assert.match(readme, new RegExp(chars(0x958b, 0x767c, 0x885b, 0x751f)))
  assert.match(readme, new RegExp(`${chars(0x5c0f, 0x4fee, 0x6539)}[\\s\\S]*debug[\\s\\S]*commit[\\s\\S]*\`main\``))
  assert.match(readme, new RegExp(`${chars(0x9ad8, 0x98a8, 0x96aa, 0x6216, 0x5927, 0x578b, 0x8b8a, 0x66f4)}[\\s\\S]*branch`))
  assert.doesNotMatch(readme, new RegExp(oldExampleModel))
  assert.doesNotMatch(readme, new RegExp(localOnlyModel, "i"))
})

test("bundled magi skill assets contain the expected contract", async () => {
  const skill = await readFile(new URL("../skills/magi/SKILL.md", import.meta.url), "utf8")
  const references = await readMagiReferences()
  const contract = [skill, ...Object.values(references)].join("\n")

  assert.match(skill, /^---\nname: magi\n/m)
  assert.match(skill, /start deliberation/)
  assert.match(skill, /\.open_magi\/magi-log/)
  assert.ok(skill.split("\n").length <= 300, "SKILL.md should stay concise and route detail to references")
  assert.ok(Buffer.byteLength(skill, "utf8") <= 14000, "SKILL.md should stay below the main-load context budget")
  assert.doesNotMatch(skill, /\.omo|deliberation-log/)
  assert.doesNotMatch(skill, hanPattern)
  for (const name of requiredMagiReferences) {
    assert.match(skill, new RegExp(`references/${name.replace(".", "\\.")}`), `SKILL.md should route to ${name}`)
    assert.doesNotMatch(references[name], hanPattern, `${name} should not contain Chinese characters`)
  }

  assert.match(contract, /acceptanceCriteria/)
  assert.match(contract, /verificationCommands/)
  assert.match(skill, /Report Integrity Gate/)
  assert.match(contract, /report-melchior\.md/)
  assert.match(contract, /verification\.md/)
  assert.match(contract, /final-report\.md/)
  assert.match(skill, /needsContinue=true/)
  assert.match(skill, /Phase Transition Checklist Gate/)
  assert.match(skill, /\.open_magi\/magi-log\/checklist\.md/)
  assert.match(skill, /Before every phase transition, read/)
  assert.match(contract, /report-melchior\.md/)
  assert.match(skill, /Debug Direction Gate/)
  assert.match(skill, /Direction questions are allowed only during Phase 1/)
  assert.match(skill, /Do not ask the user which debug direction to try next/)
  assert.match(skill, /verification is impossible/)
  assert.match(contract, /failure_diagnostic_commands/)
  assert.match(contract, /Only run these commands after verification fails/)
  assert.match(contract, /Diagnostic evidence from the previous failed round/)
  assert.match(contract, /Phase 5 executes verification and failure diagnostics/)
  assert.match(contract, /Phase 6 only judges pass\/fail/)
  assert.match(skill, /Procedural Autonomy Gate/)
  assert.match(skill, /Before Asking User Gate/)
  assert.match(skill, /Question Request Firewall/)
  assert.match(contract, /question-request\.md/)
  assert.match(contract, /question-denied\.md/)
  assert.match(contract, /consumes `question-request\.md`/)
  assert.match(contract, /default_action_if_denied/)
  assert.match(contract, /missing or unknown `classification` is denied/)
  assert.match(skill, /currentDeliberationPass/)
  assert.match(skill, /maxDeliberationPasses/)
  assert.match(skill, /Council Pass Gate/)
  assert.match(skill, /proposal-first deliberation/)
  assert.match(skill, /main agent prepares an evidence packet/)
  assert.match(skill, /does not propose a fix/)
  assert.match(contract, /proposal pass/)
  assert.match(contract, /direction-selection\.md/)
  assert.match(contract, /review pass/)
  assert.match(contract, /selected direction/)
  assert.match(contract, /Pass 1 is not a veto pass/)
  assert.match(contract, /Pass 2 starts veto review/)
  assert.match(skill, /default `maxDeliberationPasses` is 3/)
  assert.match(skill, /hard maximum is 5/)
  assert.match(skill, /blocking_objection/)
  assert.match(skill, /Do not ask the user whether another council pass is needed/)
  assert.match(skill, /Do not ask procedural questions/)
  assert.match(skill, /whether to write report files/)
  assert.match(skill, /which role each deliberator should play/)
  assert.match(skill, /question_classification/)
  assert.match(skill, /No procedural question was asked/)
  assert.match(skill, /Checkpoint Commit and Rollback Gate/)
  assert.match(contract, /checkpoint_commit_plan/)
  assert.match(skill, /git checkpoint commit/)
  assert.match(skill, /do not stage `\.open_magi\//)
  assert.match(skill, /revert this round's uncommitted code changes/)
  assert.match(contract, /checkpoint_commit/)
  assert.match(skill, /Set `currentPhase=complete`/)
  assert.match(skill, /`progress: true\|false`/)
  assert.match(skill, /Round Transition Gate/)
  assert.match(skill, /currentRound > 1 must never use `goal_definition`/)
  assert.match(skill, /Do not perform extended single-agent debugging/)
  assert.match(contract, /Phase 6: Goal Check/)

  for (const name of ["melchior", "balthasar", "casper"]) {
    const prompt = await readFile(new URL(`../skills/magi/prompts/${name}.md`, import.meta.url), "utf8")
    assert.match(prompt, /## Summary/)
    assert.match(prompt, /## Evidence/)
    assert.match(prompt, /## Risks/)
    assert.match(prompt, /## Recommended Next Action/)
    assert.match(prompt, /## Confidence/)
    assert.match(prompt, /## Blocking Questions/)
    assert.match(prompt, /stance: approve \| oppose \| needs_evidence/)
    assert.match(prompt, /blocking_objection: yes \| no/)
    assert.match(prompt, /proposal pass/)
    assert.match(prompt, /review pass/)
    assert.match(prompt, /direction proposal/)
    assert.match(prompt, /Do not modify files/)
    assert.doesNotMatch(prompt, hanPattern)
  }
})

test("GitHub Actions CI runs tests and package dry-run", async () => {
  const workflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")

  assert.match(workflow, /node-version:\s*\[20\.x,\s*22\.x\]/)
  assert.match(workflow, /npm test/)
  assert.match(workflow, /npm pack --dry-run/)
})

test("gitignore protects local runtime and scratch artifacts", async () => {
  const ignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8")

  assert.match(ignore, /^\.open_magi\/$/m)
  assert.match(ignore, /^docs\/superpowers\/$/m)
  assert.match(ignore, /^\*\.sw\[pon\]$/m)
  assert.match(ignore, /^\.env$/m)
  assert.match(ignore, /^\.env\.\*$/m)
  assert.match(ignore, /^tmp\/$/m)
})

test("CLI entrypoint exists and is executable", async () => {
  await access(new URL("../bin/open-magi.js", import.meta.url), constants.X_OK)
})

test("only README.zh-TW.md contains Chinese characters", async () => {
  const files = await listFiles(repoRoot)
  const allowed = new Set(["README.zh-TW.md"])

  for (const file of files) {
    const rel = relative(repoRoot, file)
    if (allowed.has(rel)) continue
    const text = await readFile(file, "utf8")
    assert.doesNotMatch(text, hanPattern, `${rel} should not contain Chinese characters`)
  }
})

test("tracked public files avoid local environment markers", async () => {
  const files = await listTrackedFiles()
  const forbidden = [
    [/\/home\//, "home directory path"],
    [/\/opt\//, "local opt path"],
    [new RegExp(`\\b${["pen", "guin"].join("")}\\b`, "i"), "local user name"],
    [new RegExp(`\\b${["ad", "am"].join("")}\\b`, "i"), "local user name"],
    [new RegExp(`\\b${["URI", "AL"].join("")}\\b`, "i"), "local test branch name"],
    [new RegExp(`\\b${["ai", "_test"].join("")}\\b`, "i"), "local test directory"],
    [new RegExp(`\\b${["local", "host"].join("")}\\b`, "i"), "local host name"],
    [/\b127\.0\.0\.1\b/, "loopback address"],
    [/\b192\.168\.\d+\.\d+\b/, "private network address"],
    [/\b10\.\d+\.\d+\.\d+\b/, "private network address"],
    [/\b172\.(1[6-9]|2\d|3[01])\.\d+\.\d+\b/, "private network address"],
  ]

  for (const rel of files) {
    const text = await readFile(join(repoRoot, rel), "utf8")
    for (const [pattern, label] of forbidden) {
      assert.doesNotMatch(text, pattern, `${rel} contains ${label}`)
    }
  }
})
