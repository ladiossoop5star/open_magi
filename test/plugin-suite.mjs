import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { setTimeout as sleep } from "node:timers/promises"
import test from "node:test"

export async function runPluginTests(importPlugin) {
const { default: pluginDefault, DeliberationPlugin, server } = await importPlugin()

async function makeProject(stateText) {
  const root = await mkdtemp(join(tmpdir(), "open-magi-plugin-"))
  const logDir = join(root, ".open_magi", "magi-log")
  await import("node:fs/promises").then((fs) => fs.mkdir(logDir, { recursive: true }))
  await writeFile(join(logDir, "state.json"), stateText)
  return { root, logDir, statePath: join(logDir, "state.json") }
}

async function writeArtifact(root, relativePath, text = "ok\n") {
  const path = join(root, relativePath)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

function activeState(overrides = {}) {
  return {
    schemaVersion: 1,
    goal: "finish the toy goal",
    acceptanceCriteria: ["toy goal is complete"],
    verificationCommands: ["true"],
    active: true,
    sessionID: "ses-1",
    projectRoot: "",
    mainAgent: "build",
    currentRound: 3,
    currentPhase: "status_assessment",
    needsContinue: true,
    inFlight: false,
    inFlightSince: null,
    lastPromptedRound: 2,
    lastPromptedAt: null,
    consecutiveNoProgress: 0,
    verdict: null,
    lastError: null,
    history: [],
    ...overrides,
  }
}

function fakeClient(calls, options = {}) {
  return {
    session: {
      async promptAsync(payload) {
        if (options.promptError) throw options.promptError
        calls.push(payload)
        return { ok: true }
      },
      async abort(payload) {
        if (options.abortError) throw options.abortError
        if (options.aborts) options.aborts.push(payload)
        return true
      },
    },
  }
}

test("package exports plugin aliases accepted by OpenCode loaders", () => {
  assert.equal(typeof server, "function")
  assert.equal(typeof DeliberationPlugin, "function")
  assert.equal(typeof pluginDefault, "function")
  assert.equal(pluginDefault, server)
  assert.equal(DeliberationPlugin, server)
})

test("idle event locks state and sends exactly one continue prompt for the same round", async () => {
  const project = await makeProject("{}")
  const state = activeState({ projectRoot: project.root })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  await writeArtifact(project.root, ".open_magi/magi-log/checklist.md")
  const calls = []
  const hooks = await server({
    client: fakeClient(calls),
    directory: project.root,
  })

  await hooks.event({
    event: { type: "session.idle", properties: { sessionID: "ses-1" } },
  })
  await hooks.event({
    event: { type: "session.idle", properties: { sessionID: "ses-1" } },
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].path.id, "ses-1")
  assert.equal(calls[0].query.directory, project.root)
  assert.equal(calls[0].body.agent, "build")
  const prompt = calls[0].body.parts[0].text
  assert.match(prompt, /^\[magi\] Continue the active deliberation loop/)
  assert.match(prompt, /Do not ask procedural questions/)
  assert.match(prompt, /Magi skill, checklist, state\.json, phase contract/)
  assert.match(prompt, /whether to write reports/)

  const updated = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.equal(updated.inFlight, true)
  assert.equal(updated.lastPromptedRound, 3)
  assert.equal(typeof updated.lastPromptedAt, "string")

  await rm(project.root, { recursive: true, force: true })
})

test("idle event continues a same-round loop after the previous prompt was consumed", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    currentRound: 1,
    currentPhase: "status_assessment",
    needsContinue: true,
    inFlight: false,
    lastPromptedRound: 1,
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  await writeArtifact(project.root, ".open_magi/magi-log/checklist.md")
  const calls = []
  const hooks = await server({
    client: fakeClient(calls),
    directory: project.root,
  })

  await hooks.event({
    event: { type: "session.idle", properties: { sessionID: "ses-1" } },
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].path.id, "ses-1")
  assert.doesNotMatch(calls[0].body.parts[0].text, /Artifact integrity repair required/)

  const updated = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.equal(updated.inFlight, true)
  assert.equal(updated.lastPromptedRound, 1)

  await rm(project.root, { recursive: true, force: true })
})

test("idle event repairs next-round state that incorrectly resumes at goal_definition", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    currentRound: 2,
    currentPhase: "goal_definition",
    needsContinue: true,
    inFlight: false,
    lastPromptedRound: 1,
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  await writeArtifact(project.root, ".open_magi/magi-log/checklist.md")
  for (const artifact of [
    "research-prompt.md",
    "report-melchior.md",
    "report-balthasar.md",
    "report-casper.md",
    "synthesis.md",
    "verdict.md",
    "verification.md",
  ]) {
    await writeArtifact(project.root, `.open_magi/magi-log/round-001/${artifact}`)
  }
  const calls = []
  const hooks = await server({
    client: fakeClient(calls),
    directory: project.root,
  })

  await hooks.event({
    event: { type: "session.idle", properties: { sessionID: "ses-1" } },
  })

  assert.equal(calls.length, 1)
  const prompt = calls[0].body.parts[0].text
  assert.match(prompt, /Round transition repair required/)
  assert.match(prompt, /currentRound is 2/)
  assert.match(prompt, /round-002\/research-prompt\.md/)
  assert.match(prompt, /launch all three deliberator subtasks/)

  const updated = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.equal(updated.currentPhase, "status_assessment")
  assert.equal(updated.needsContinue, true)
  assert.equal(updated.inFlight, true)
  assert.match(updated.lastError, /round transition repair required/i)

  await rm(project.root, { recursive: true, force: true })
})

test("idle event in research_task tells the agent to immediately launch deliberators", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    currentRound: 2,
    currentPhase: "research_task",
    needsContinue: true,
    inFlight: false,
    lastPromptedRound: 1,
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  await writeArtifact(project.root, ".open_magi/magi-log/checklist.md")
  for (const artifact of [
    "research-prompt.md",
    "report-melchior.md",
    "report-balthasar.md",
    "report-casper.md",
    "synthesis.md",
    "verdict.md",
    "verification.md",
  ]) {
    await writeArtifact(project.root, `.open_magi/magi-log/round-001/${artifact}`)
  }
  await writeArtifact(project.root, ".open_magi/magi-log/round-002/research-prompt.md")
  const calls = []
  const hooks = await server({
    client: fakeClient(calls),
    directory: project.root,
  })

  await hooks.event({
    event: { type: "session.idle", properties: { sessionID: "ses-1" } },
  })

  assert.equal(calls.length, 1)
  const prompt = calls[0].body.parts[0].text
  assert.match(prompt, /Phase 2 -> Phase 3 immediate action/)
  assert.match(prompt, /Do not add more single-agent analysis before launching deliberators/)
  assert.match(prompt, /deliberator-melchior, deliberator-balthasar, deliberator-casper/)
  assert.match(prompt, /round-002\/report-melchior\.md/)

  await rm(project.root, { recursive: true, force: true })
})

test("idle event in council research_task tells the agent to launch the current council pass", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    currentRound: 2,
    currentPhase: "research_task",
    currentDeliberationPass: 1,
    maxDeliberationPasses: 3,
    deliberationStatus: "collecting_reports",
    needsContinue: true,
    inFlight: false,
    lastPromptedRound: 1,
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  await writeArtifact(project.root, ".open_magi/magi-log/checklist.md")
  for (const artifact of [
    "research-prompt.md",
    "report-melchior.md",
    "report-balthasar.md",
    "report-casper.md",
    "synthesis.md",
    "verdict.md",
    "verification.md",
  ]) {
    await writeArtifact(project.root, `.open_magi/magi-log/round-001/${artifact}`)
  }
  await writeArtifact(project.root, ".open_magi/magi-log/round-002/research-prompt.md")
  const calls = []
  const hooks = await server({
    client: fakeClient(calls),
    directory: project.root,
  })

  await hooks.event({
    event: { type: "session.idle", properties: { sessionID: "ses-1" } },
  })

  assert.equal(calls.length, 1)
  const prompt = calls[0].body.parts[0].text
  assert.match(prompt, /Council pass 1 of 3/)
  assert.match(prompt, /round-002\/council-001\/prompt\.md/)
  assert.match(prompt, /round-002\/council-001\/report-melchior\.md/)
  assert.match(prompt, /stance: approve \| oppose \| needs_evidence/)
  assert.match(prompt, /Do not ask the user whether another council pass is needed/)

  await rm(project.root, { recursive: true, force: true })
})

test("session.created records deliberator child sessions with deadlines", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    currentRound: 2,
    currentPhase: "parallel_deliberation",
    currentDeliberationPass: 1,
    maxDeliberationPasses: 3,
    activeDeliberators: {},
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  const hooks = await server({
    client: fakeClient([]),
    directory: project.root,
  })

  await hooks.event({
    event: {
      type: "session.created",
      properties: {
        info: {
          id: "ses-melchior",
          parentID: "ses-1",
          agent: "deliberator-melchior",
        },
      },
    },
  })

  const updated = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.equal(updated.activeDeliberators.melchior.sessionID, "ses-melchior")
  assert.equal(updated.activeDeliberators.melchior.parentSessionID, "ses-1")
  assert.equal(updated.activeDeliberators.melchior.agent, "deliberator-melchior")
  assert.equal(updated.activeDeliberators.melchior.round, 2)
  assert.equal(updated.activeDeliberators.melchior.pass, 1)
  assert.equal(updated.activeDeliberators.melchior.status, "running")
  assert.equal(typeof updated.activeDeliberators.melchior.startedAt, "string")
  assert.equal(typeof updated.activeDeliberators.melchior.deadlineAt, "string")
  assert.equal(
    Date.parse(updated.activeDeliberators.melchior.deadlineAt) -
      Date.parse(updated.activeDeliberators.melchior.startedAt),
    30 * 60 * 1000,
  )
  assert.equal(updated.deliberatorTimeoutMs, 30 * 60 * 1000)

  await rm(project.root, { recursive: true, force: true })
})

test("concurrent session.created events preserve all deliberator child sessions", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    currentRound: 2,
    currentPhase: "parallel_deliberation",
    currentDeliberationPass: 1,
    maxDeliberationPasses: 3,
    deliberatorTimeoutMs: 600000,
    activeDeliberators: {},
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  const hooks = await server({
    client: fakeClient([]),
    directory: project.root,
  })

  function created(id, agent) {
    return hooks.event({
      event: {
        type: "session.created",
        properties: {
          info: {
            id,
            parentID: "ses-1",
            agent,
            createdAt: new Date().toISOString(),
          },
        },
      },
    })
  }

  await Promise.all([
    created("ses-melchior", "deliberator-melchior"),
    created("ses-balthasar", "deliberator-balthasar"),
    created("ses-casper", "deliberator-casper"),
  ])

  const updated = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.deepEqual(Object.keys(updated.activeDeliberators).sort(), [
    "balthasar",
    "casper",
    "melchior",
  ])
  assert.equal(updated.activeDeliberators.melchior.sessionID, "ses-melchior")
  assert.equal(updated.activeDeliberators.balthasar.sessionID, "ses-balthasar")
  assert.equal(updated.activeDeliberators.casper.sessionID, "ses-casper")

  await rm(project.root, { recursive: true, force: true })
})

test("session.created ignores non-deliberator and wrong-parent child sessions", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    currentPhase: "parallel_deliberation",
    currentDeliberationPass: 1,
    activeDeliberators: {},
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  const hooks = await server({
    client: fakeClient([]),
    directory: project.root,
  })

  await hooks.event({
    event: {
      type: "session.created",
      properties: {
        info: {
          id: "ses-helper",
          parentID: "ses-1",
          agent: "build",
        },
      },
    },
  })
  await hooks.event({
    event: {
      type: "session.created",
      properties: {
        info: {
          id: "ses-casper",
          parentID: "ses-other",
          agent: "deliberator-casper",
        },
      },
    },
  })

  const updated = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.deepEqual(updated.activeDeliberators, {})

  await rm(project.root, { recursive: true, force: true })
})

test("expired deliberator sessions are aborted and converted into timeout reports", async () => {
  const project = await makeProject("{}")
  const expiredDeadline = new Date(Date.now() - 1000).toISOString()
  const state = activeState({
    projectRoot: project.root,
    currentRound: 2,
    currentPhase: "parallel_deliberation",
    currentDeliberationPass: 1,
    maxDeliberationPasses: 3,
    needsContinue: false,
    inFlight: false,
    activeDeliberators: {
      melchior: {
        agent: "deliberator-melchior",
        sessionID: "ses-melchior",
        parentSessionID: "ses-1",
        round: 2,
        pass: 1,
        startedAt: new Date(Date.now() - 700000).toISOString(),
        deadlineAt: expiredDeadline,
        status: "running",
      },
    },
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  await writeArtifact(project.root, ".open_magi/magi-log/checklist.md")
  for (const artifact of [
    "research-prompt.md",
    "council-001/prompt.md",
    "council-001/report-melchior.md",
    "council-001/report-balthasar.md",
    "council-001/report-casper.md",
    "council-001/synthesis.md",
    "verdict.md",
    "verification.md",
  ]) {
    await writeArtifact(project.root, `.open_magi/magi-log/round-001/${artifact}`)
  }
  for (const artifact of [
    "research-prompt.md",
    "council-001/prompt.md",
    "council-001/report-balthasar.md",
    "council-001/report-casper.md",
  ]) {
    await writeArtifact(project.root, `.open_magi/magi-log/round-002/${artifact}`)
  }
  const calls = []
  const aborts = []
  const hooks = await server({
    client: fakeClient(calls, { aborts }),
    directory: project.root,
  })

  await hooks.event({
    event: { type: "session.idle", properties: { sessionID: "ses-1" } },
  })

  assert.equal(aborts.length, 1)
  assert.equal(aborts[0].path.id, "ses-melchior")
  assert.equal(aborts[0].query.directory, project.root)

  const report = await readFile(
    join(project.root, ".open_magi/magi-log/round-002/council-001/report-melchior.md"),
    "utf8",
  )
  assert.match(report, /status: timeout/)
  assert.match(report, /stance: needs_evidence/)
  assert.match(report, /blocking_objection: yes/)
  assert.match(report, /OpenCode plugin aborted/)

  const updated = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.equal(updated.activeDeliberators.melchior.status, "timed_out")
  assert.equal(updated.activeDeliberators.melchior.reportPath, ".open_magi/magi-log/round-002/council-001/report-melchior.md")
  assert.equal(updated.deliberatorTimeoutCounts.melchior, 1)
  assert.equal(updated.needsContinue, true)
  assert.equal(updated.inFlight, true)
  assert.match(updated.lastError, /deliberator timeout enforced/i)

  assert.equal(calls.length, 1)
  assert.match(calls[0].body.parts[0].text, /Deliberator timeout enforced/)
  assert.match(calls[0].body.parts[0].text, /report-melchior\.md/)
  assert.match(calls[0].body.parts[0].text, /Do not ask the user/)

  await rm(project.root, { recursive: true, force: true })
})

test("expired stale council deliberator entries are retired without disturbing the current phase", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    currentRound: 3,
    currentPhase: "synthesis",
    currentDeliberationPass: 2,
    maxDeliberationPasses: 3,
    needsContinue: false,
    inFlight: false,
    activeDeliberators: {
      melchior: {
        agent: "deliberator-melchior",
        sessionID: "ses-old-melchior",
        parentSessionID: "ses-1",
        round: 1,
        pass: 1,
        startedAt: new Date(Date.now() - 900000).toISOString(),
        deadlineAt: new Date(Date.now() - 1000).toISOString(),
        status: "running",
      },
    },
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  const aborts = []
  const hooks = await server({
    client: fakeClient([], { aborts }),
    directory: project.root,
  })

  await hooks["chat.message"]({ sessionID: "ses-1", agent: "build" })

  const updated = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.equal(updated.currentPhase, "synthesis")
  assert.equal(updated.needsContinue, false)
  assert.equal(updated.inFlight, false)
  assert.equal(updated.lastError, null)
  assert.equal(updated.activeDeliberators.melchior.status, "superseded")
  assert.equal(updated.activeDeliberators.melchior.supersededByRound, 3)
  assert.equal(updated.activeDeliberators.melchior.supersededByPass, 2)
  assert.equal(
    existsSync(join(project.root, ".open_magi/magi-log/round-001/council-001/report-melchior.md")),
    false,
  )

  await rm(project.root, { recursive: true, force: true })
})

test("expired current council deliberator entries still timeout and drive continuation", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    currentRound: 3,
    currentPhase: "research_task",
    currentDeliberationPass: 2,
    maxDeliberationPasses: 3,
    needsContinue: false,
    inFlight: false,
    activeDeliberators: {
      melchior: {
        agent: "deliberator-melchior",
        sessionID: "ses-current-melchior",
        parentSessionID: "ses-1",
        round: 3,
        pass: 2,
        startedAt: new Date(Date.now() - 900000).toISOString(),
        deadlineAt: new Date(Date.now() - 1000).toISOString(),
        status: "running",
      },
    },
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  const calls = []
  const aborts = []
  const hooks = await server({
    client: fakeClient(calls, { aborts }),
    directory: project.root,
  })

  await hooks["chat.message"]({ sessionID: "ses-1", agent: "build" })

  assert.equal(aborts.length, 1)
  assert.equal(aborts[0].path.id, "ses-current-melchior")
  const updated = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.equal(updated.currentPhase, "parallel_deliberation")
  assert.equal(updated.needsContinue, true)
  assert.equal(updated.activeDeliberators.melchior.status, "timed_out")
  assert.equal(updated.activeDeliberators.melchior.reportPath, ".open_magi/magi-log/round-003/council-002/report-melchior.md")
  assert.match(updated.lastError, /deliberator timeout enforced/i)
  assert.equal(
    existsSync(join(project.root, ".open_magi/magi-log/round-003/council-002/report-melchior.md")),
    true,
  )
  assert.equal(calls.length, 0)

  await rm(project.root, { recursive: true, force: true })
})

test("expired stale non-council deliberator entries are retired using round only", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    currentRound: 3,
    currentPhase: "execution",
    needsContinue: false,
    inFlight: false,
    activeDeliberators: {
      casper: {
        agent: "deliberator-casper",
        sessionID: "ses-old-casper",
        parentSessionID: "ses-1",
        round: 2,
        startedAt: new Date(Date.now() - 900000).toISOString(),
        deadlineAt: new Date(Date.now() - 1000).toISOString(),
        status: "running",
      },
    },
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  const hooks = await server({
    client: fakeClient([]),
    directory: project.root,
  })

  await hooks["chat.message"]({ sessionID: "ses-1", agent: "build" })

  const updated = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.equal(updated.currentPhase, "execution")
  assert.equal(updated.needsContinue, false)
  assert.equal(updated.inFlight, false)
  assert.equal(updated.lastError, null)
  assert.equal(updated.activeDeliberators.casper.status, "superseded")
  assert.equal(updated.activeDeliberators.casper.supersededByRound, 3)
  assert.equal(updated.activeDeliberators.casper.supersededByPass, null)
  assert.equal(
    existsSync(join(project.root, ".open_magi/magi-log/round-002/report-casper.md")),
    false,
  )

  await rm(project.root, { recursive: true, force: true })
})

test("running deliberator sessions are not aborted before their deadline", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    currentPhase: "parallel_deliberation",
    currentDeliberationPass: 1,
    activeDeliberators: {
      casper: {
        agent: "deliberator-casper",
        sessionID: "ses-casper",
        parentSessionID: "ses-1",
        round: 3,
        pass: 1,
        startedAt: new Date().toISOString(),
        deadlineAt: new Date(Date.now() + 600000).toISOString(),
        status: "running",
      },
    },
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  const aborts = []
  const hooks = await server({
    client: fakeClient([], { aborts }),
    directory: project.root,
  })

  await hooks.event({
    event: { type: "message.updated", properties: { sessionID: "ses-casper" } },
  })

  assert.equal(aborts.length, 0)
  const updated = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.equal(updated.activeDeliberators.casper.status, "running")

  await rm(project.root, { recursive: true, force: true })
})

test("session.error from a running deliberator writes hard-error report and blocks the loop", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    currentRound: 2,
    currentPhase: "parallel_deliberation",
    currentDeliberationPass: 1,
    maxDeliberationPasses: 3,
    needsContinue: true,
    inFlight: false,
    activeDeliberators: {
      balthasar: {
        agent: "deliberator-balthasar",
        sessionID: "ses-balthasar",
        parentSessionID: "ses-1",
        round: 2,
        pass: 1,
        startedAt: new Date(Date.now() - 1000).toISOString(),
        deadlineAt: new Date(Date.now() + 600000).toISOString(),
        status: "running",
      },
    },
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  const calls = []
  const hooks = await server({
    client: fakeClient(calls),
    directory: project.root,
  })

  await hooks.event({
    event: {
      type: "session.error",
      properties: {
        sessionID: "ses-balthasar",
        error: {
          name: "ProviderAuthError",
          data: { message: "invalid api key" },
        },
      },
    },
  })

  const report = await readFile(
    join(project.root, ".open_magi/magi-log/round-002/council-001/report-balthasar.md"),
    "utf8",
  )
  assert.match(report, /status: hard_error/)
  assert.match(report, /failure_type: hard_error/)
  assert.match(report, /report_source: opencode_session_error/)
  assert.match(report, /ProviderAuthError/)
  assert.match(report, /invalid api key/)
  assert.match(report, /repair_file: .*opencode\.json/)

  const updated = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.equal(updated.active, false)
  assert.equal(updated.currentPhase, "blocked")
  assert.equal(updated.needsContinue, false)
  assert.equal(updated.inFlight, false)
  assert.equal(updated.activeDeliberators.balthasar.status, "hard_error")
  assert.equal(updated.activeDeliberators.balthasar.failureType, "hard_error")
  assert.match(updated.lastError, /deliberator hard error/i)

  assert.equal(calls.length, 1)
  assert.equal(calls[0].path.id, "ses-1")
  assert.match(calls[0].body.parts[0].text, /Magi deliberator hard error/)
  assert.match(calls[0].body.parts[0].text, /ProviderAuthError/)
  assert.match(calls[0].body.parts[0].text, /opencode\.json/)

  await hooks.event({
    event: { type: "session.idle", properties: { sessionID: "ses-1" } },
  })
  assert.equal(calls.length, 1)

  await rm(project.root, { recursive: true, force: true })
})

test("session.error after a deliberator timeout does not upgrade timeout into hard error", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    currentRound: 2,
    currentPhase: "parallel_deliberation",
    currentDeliberationPass: 1,
    activeDeliberators: {
      casper: {
        agent: "deliberator-casper",
        sessionID: "ses-casper",
        parentSessionID: "ses-1",
        round: 2,
        pass: 1,
        status: "timed_out",
        timedOutAt: new Date().toISOString(),
        reportPath: ".open_magi/magi-log/round-002/council-001/report-casper.md",
      },
    },
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  await writeArtifact(project.root, ".open_magi/magi-log/round-002/council-001/report-casper.md", "status: timeout\n")
  const calls = []
  const hooks = await server({
    client: fakeClient(calls),
    directory: project.root,
  })

  await hooks.event({
    event: {
      type: "session.error",
      properties: {
        sessionID: "ses-casper",
        error: {
          name: "MessageAbortedError",
          data: { message: "aborted by timeout" },
        },
      },
    },
  })

  const updated = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.equal(updated.currentPhase, "parallel_deliberation")
  assert.equal(updated.activeDeliberators.casper.status, "timed_out")
  assert.doesNotMatch(updated.lastError || "", /hard error/i)
  assert.equal(calls.length, 0)
  assert.equal(
    await readFile(join(project.root, ".open_magi/magi-log/round-002/council-001/report-casper.md"), "utf8"),
    "status: timeout\n",
  )

  await rm(project.root, { recursive: true, force: true })
})

test("child session idle marks a deliberator complete so later sweeps do not timeout it", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    currentRound: 2,
    currentPhase: "parallel_deliberation",
    currentDeliberationPass: 1,
    activeDeliberators: {
      casper: {
        agent: "deliberator-casper",
        sessionID: "ses-casper",
        parentSessionID: "ses-1",
        round: 2,
        pass: 1,
        startedAt: new Date(Date.now() - 700000).toISOString(),
        deadlineAt: new Date(Date.now() - 1000).toISOString(),
        status: "running",
      },
    },
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  const aborts = []
  const hooks = await server({
    client: fakeClient([], { aborts }),
    directory: project.root,
  })

  await hooks.event({
    event: { type: "session.idle", properties: { sessionID: "ses-casper" } },
  })
  await hooks["chat.message"]({ sessionID: "ses-1", agent: "build" })

  assert.equal(aborts.length, 0)
  const updated = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.equal(updated.activeDeliberators.casper.status, "completed")
  assert.equal(typeof updated.activeDeliberators.casper.completedAt, "string")

  await rm(project.root, { recursive: true, force: true })
})

test("chat.message sweeps expired deliberator sessions after plugin restart", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    currentRound: 2,
    currentPhase: "parallel_deliberation",
    currentDeliberationPass: 1,
    needsContinue: true,
    inFlight: false,
    activeDeliberators: {
      balthasar: {
        agent: "deliberator-balthasar",
        sessionID: "ses-balthasar",
        parentSessionID: "ses-1",
        round: 2,
        pass: 1,
        startedAt: new Date(Date.now() - 700000).toISOString(),
        deadlineAt: new Date(Date.now() - 1000).toISOString(),
        status: "running",
      },
    },
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  const aborts = []
  const hooks = await server({
    client: fakeClient([], { aborts }),
    directory: project.root,
  })

  await hooks["chat.message"]({ sessionID: "ses-1", agent: "build" })

  assert.equal(aborts.length, 1)
  assert.equal(aborts[0].path.id, "ses-balthasar")
  const updated = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.equal(updated.activeDeliberators.balthasar.status, "timed_out")
  assert.equal(
    existsSync(join(project.root, ".open_magi/magi-log/round-002/council-001/report-balthasar.md")),
    true,
  )

  await rm(project.root, { recursive: true, force: true })
})

test("server startup reschedules persisted expired deliberator deadlines without waiting for another hook", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    currentRound: 2,
    currentPhase: "parallel_deliberation",
    currentDeliberationPass: 1,
    activeDeliberators: {
      melchior: {
        agent: "deliberator-melchior",
        sessionID: "ses-melchior",
        parentSessionID: "ses-1",
        round: 2,
        pass: 1,
        startedAt: new Date(Date.now() - 700000).toISOString(),
        deadlineAt: new Date(Date.now() - 1000).toISOString(),
        status: "running",
      },
    },
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  const aborts = []

  await server({
    client: fakeClient([], { aborts }),
    directory: project.root,
  })
  await sleep(30)

  assert.equal(aborts.length, 1)
  const updated = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.equal(updated.activeDeliberators.melchior.status, "timed_out")

  await rm(project.root, { recursive: true, force: true })
})

test("abort failures still write timeout reports and do not ask the user", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    currentRound: 2,
    currentPhase: "parallel_deliberation",
    currentDeliberationPass: 1,
    needsContinue: false,
    inFlight: false,
    activeDeliberators: {
      casper: {
        agent: "deliberator-casper",
        sessionID: "ses-casper",
        parentSessionID: "ses-1",
        round: 2,
        pass: 1,
        startedAt: new Date(Date.now() - 700000).toISOString(),
        deadlineAt: new Date(Date.now() - 1000).toISOString(),
        status: "running",
      },
    },
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  await writeArtifact(project.root, ".open_magi/magi-log/checklist.md")
  for (const artifact of [
    "research-prompt.md",
    "council-001/prompt.md",
    "council-001/report-melchior.md",
    "council-001/report-balthasar.md",
    "council-001/report-casper.md",
    "council-001/synthesis.md",
    "verdict.md",
    "verification.md",
  ]) {
    await writeArtifact(project.root, `.open_magi/magi-log/round-001/${artifact}`)
  }
  for (const artifact of [
    "research-prompt.md",
    "council-001/prompt.md",
    "council-001/report-melchior.md",
    "council-001/report-balthasar.md",
  ]) {
    await writeArtifact(project.root, `.open_magi/magi-log/round-002/${artifact}`)
  }
  const calls = []
  const hooks = await server({
    client: fakeClient(calls, { abortError: new Error("transport closed") }),
    directory: project.root,
  })

  await hooks.event({
    event: { type: "session.idle", properties: { sessionID: "ses-1" } },
  })

  const report = await readFile(
    join(project.root, ".open_magi/magi-log/round-002/council-001/report-casper.md"),
    "utf8",
  )
  assert.match(report, /status: timeout/)
  assert.match(report, /abort_error: transport closed/)

  const updated = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.equal(updated.activeDeliberators.casper.status, "timed_out")
  assert.equal(updated.activeDeliberators.casper.abortError, "transport closed")
  assert.match(updated.lastError, /deliberator timeout enforced/i)

  assert.equal(calls.length, 1)
  assert.match(calls[0].body.parts[0].text, /Do not ask the user/)

  await rm(project.root, { recursive: true, force: true })
})

test("idle event accepts previous rounds that used council artifact layout", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    currentRound: 2,
    currentPhase: "research_task",
    currentDeliberationPass: 1,
    maxDeliberationPasses: 3,
    deliberationStatus: "collecting_reports",
    needsContinue: true,
    inFlight: false,
    lastPromptedRound: 1,
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  await writeArtifact(project.root, ".open_magi/magi-log/checklist.md")
  for (const artifact of [
    "research-prompt.md",
    "council-001/prompt.md",
    "council-001/report-melchior.md",
    "council-001/report-balthasar.md",
    "council-001/report-casper.md",
    "council-001/synthesis.md",
    "verdict.md",
    "verification.md",
  ]) {
    await writeArtifact(project.root, `.open_magi/magi-log/round-001/${artifact}`)
  }
  await writeArtifact(project.root, ".open_magi/magi-log/round-002/research-prompt.md")
  const calls = []
  const hooks = await server({
    client: fakeClient(calls),
    directory: project.root,
  })

  await hooks.event({
    event: { type: "session.idle", properties: { sessionID: "ses-1" } },
  })

  assert.equal(calls.length, 1)
  const prompt = calls[0].body.parts[0].text
  assert.doesNotMatch(prompt, /Artifact integrity repair required/)
  assert.doesNotMatch(prompt, /round-001\/report-melchior\.md/)
  assert.match(prompt, /Council pass 1 of 3/)

  await rm(project.root, { recursive: true, force: true })
})

test("idle event denies forbidden question requests and tells the agent to self-answer", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    currentRound: 2,
    currentPhase: "parallel_deliberation",
    needsContinue: true,
    inFlight: false,
    lastPromptedRound: 1,
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  await writeArtifact(project.root, ".open_magi/magi-log/checklist.md")
  for (const artifact of [
    "research-prompt.md",
    "report-melchior.md",
    "report-balthasar.md",
    "report-casper.md",
    "synthesis.md",
    "verdict.md",
    "verification.md",
  ]) {
    await writeArtifact(project.root, `.open_magi/magi-log/round-001/${artifact}`)
  }
  for (const artifact of [
    "research-prompt.md",
    "report-melchior.md",
    "report-balthasar.md",
    "report-casper.md",
  ]) {
    await writeArtifact(project.root, `.open_magi/magi-log/round-002/${artifact}`)
  }
  await writeArtifact(
    project.root,
    ".open_magi/magi-log/question-request.md",
    [
      "# Question Request",
      "classification: debug_direction",
      "phase: parallel_deliberation",
      "question: Which debug direction should I try next?",
      "why_local_context_failed: I am unsure which report to follow.",
      "commands_or_files_checked: .open_magi/magi-log/round-002/report-melchior.md",
      "default_action_if_denied: choose the highest-evidence recommendation and write verdict.md.",
      "",
    ].join("\n"),
  )
  const calls = []
  const hooks = await server({
    client: fakeClient(calls),
    directory: project.root,
  })

  await hooks.event({
    event: { type: "session.idle", properties: { sessionID: "ses-1" } },
  })

  assert.equal(calls.length, 1)
  const prompt = calls[0].body.parts[0].text
  assert.match(prompt, /Question request denied/)
  assert.match(prompt, /classification: debug_direction/)
  assert.match(prompt, /Do not ask the user/)
  assert.match(prompt, /choose the highest-evidence recommendation and write verdict\.md/)

  const updated = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.equal(updated.inFlight, true)
  assert.match(updated.lastError, /question request denied/i)
  assert.match(
    await readFile(join(project.logDir, "question-denied.md"), "utf8"),
    /classification: debug_direction/,
  )
  assert.equal(existsSync(join(project.logDir, "question-request.md")), false)

  await rm(project.root, { recursive: true, force: true })
})

test("idle event denies later-round debug direction questions even in status_assessment", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    currentRound: 2,
    currentPhase: "status_assessment",
    needsContinue: true,
    inFlight: false,
    lastPromptedRound: 1,
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  await writeArtifact(project.root, ".open_magi/magi-log/checklist.md")
  for (const artifact of [
    "research-prompt.md",
    "report-melchior.md",
    "report-balthasar.md",
    "report-casper.md",
    "synthesis.md",
    "verdict.md",
    "verification.md",
  ]) {
    await writeArtifact(project.root, `.open_magi/magi-log/round-001/${artifact}`)
  }
  await writeArtifact(
    project.root,
    ".open_magi/magi-log/question-request.md",
    [
      "# Question Request",
      "classification: debug_direction",
      "phase: status_assessment",
      "question: Should I ask the three sages again or implement now?",
      "why_local_context_failed: I am not sure if another council pass is needed.",
      "commands_or_files_checked: .open_magi/magi-log/state.json",
      "default_action_if_denied: follow the bounded council loop and launch the next required pass.",
      "",
    ].join("\n"),
  )
  const calls = []
  const hooks = await server({
    client: fakeClient(calls),
    directory: project.root,
  })

  await hooks.event({
    event: { type: "session.idle", properties: { sessionID: "ses-1" } },
  })

  assert.equal(calls.length, 1)
  const prompt = calls[0].body.parts[0].text
  assert.match(prompt, /Question request denied/)
  assert.match(prompt, /classification: debug_direction/)
  assert.match(prompt, /follow the bounded council loop/)

  const updated = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.equal(updated.inFlight, true)
  assert.match(updated.lastError, /question request denied/i)

  await rm(project.root, { recursive: true, force: true })
})

test("idle event allows execution blocker question requests to wait for the user", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    currentRound: 2,
    currentPhase: "execution",
    needsContinue: true,
    inFlight: false,
    lastPromptedRound: 1,
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  await writeArtifact(project.root, ".open_magi/magi-log/checklist.md")
  for (const artifact of [
    "research-prompt.md",
    "report-melchior.md",
    "report-balthasar.md",
    "report-casper.md",
    "synthesis.md",
    "verdict.md",
    "verification.md",
  ]) {
    await writeArtifact(project.root, `.open_magi/magi-log/round-001/${artifact}`)
  }
  await writeArtifact(project.root, ".open_magi/magi-log/round-002/research-prompt.md")
  await writeArtifact(project.root, ".open_magi/magi-log/round-002/report-melchior.md")
  await writeArtifact(project.root, ".open_magi/magi-log/round-002/report-balthasar.md")
  await writeArtifact(project.root, ".open_magi/magi-log/round-002/report-casper.md")
  await writeArtifact(project.root, ".open_magi/magi-log/round-002/synthesis.md")
  await writeArtifact(project.root, ".open_magi/magi-log/round-002/verdict.md")
  await writeArtifact(project.root, ".open_magi/magi-log/round-002/verification.md")
  await writeArtifact(
    project.root,
    ".open_magi/magi-log/question-request.md",
    [
      "# Question Request",
      "classification: execution_blocker",
      "phase: execution",
      "question: DUT is unreachable. Please restore DUT access.",
      "why_local_context_failed: mard cannot connect to the external device.",
      "commands_or_files_checked: test-runner /tmp/open-magi-device-check example-user",
      "default_action_if_denied: mark blocked with the connection failure evidence.",
      "",
    ].join("\n"),
  )
  const calls = []
  const hooks = await server({
    client: fakeClient(calls),
    directory: project.root,
  })

  await hooks.event({
    event: { type: "session.idle", properties: { sessionID: "ses-1" } },
  })

  assert.equal(calls.length, 0)
  const updated = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.equal(updated.inFlight, false)
  assert.equal(existsSync(join(project.logDir, "question-denied.md")), false)
  assert.equal(existsSync(join(project.logDir, "question-request.md")), false)

  await hooks.event({
    event: { type: "session.idle", properties: { sessionID: "ses-1" } },
  })

  assert.equal(calls.length, 1)
  assert.match(calls[0].body.parts[0].text, /active deliberation loop/)

  await rm(project.root, { recursive: true, force: true })
})

test("idle event recovers an active non-terminal loop even when needsContinue was left false", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    currentRound: 1,
    currentPhase: "research_task",
    needsContinue: false,
    lastPromptedRound: 0,
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  await writeArtifact(project.root, ".open_magi/magi-log/checklist.md")
  await writeArtifact(project.root, ".open_magi/magi-log/round-001/research-prompt.md")
  const calls = []
  const hooks = await server({
    client: fakeClient(calls),
    directory: project.root,
  })

  await hooks.event({
    event: { type: "session.idle", properties: { sessionID: "ses-1" } },
  })

  assert.equal(calls.length, 1)
  assert.match(calls[0].body.parts[0].text, /active deliberation loop/)

  const updated = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.equal(updated.needsContinue, true)
  assert.equal(updated.inFlight, true)
  assert.match(updated.lastError, /recovered active non-terminal loop/i)

  await rm(project.root, { recursive: true, force: true })
})

test("idle event repairs missing required round artifacts before phase transition", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    currentPhase: "synthesis",
    needsContinue: false,
    lastPromptedRound: 3,
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  const calls = []
  const hooks = await server({
    client: fakeClient(calls),
    directory: project.root,
  })

  await hooks.event({
    event: { type: "session.idle", properties: { sessionID: "ses-1" } },
  })

  assert.equal(calls.length, 1)
  const prompt = calls[0].body.parts[0].text
  assert.match(prompt, /Artifact integrity repair required/)
  assert.match(prompt, /\.open_magi\/magi-log\/checklist\.md/)
  assert.match(prompt, /round-003\/report-melchior\.md/)
  assert.match(prompt, /round-003\/report-balthasar\.md/)
  assert.match(prompt, /round-003\/report-casper\.md/)

  const updated = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.equal(updated.active, true)
  assert.equal(updated.needsContinue, true)
  assert.equal(updated.inFlight, true)
  assert.match(updated.lastError, /artifact integrity repair required/i)

  await rm(project.root, { recursive: true, force: true })
})

test("idle event repairs missing current council pass artifacts before verdict", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    currentRound: 2,
    currentPhase: "synthesis",
    currentDeliberationPass: 2,
    maxDeliberationPasses: 3,
    deliberationStatus: "synthesizing",
    needsContinue: false,
    lastPromptedRound: 2,
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  await writeArtifact(project.root, ".open_magi/magi-log/checklist.md")
  for (const artifact of [
    "research-prompt.md",
    "report-melchior.md",
    "report-balthasar.md",
    "report-casper.md",
    "synthesis.md",
    "verdict.md",
    "verification.md",
  ]) {
    await writeArtifact(project.root, `.open_magi/magi-log/round-001/${artifact}`)
  }
  await writeArtifact(project.root, ".open_magi/magi-log/round-002/research-prompt.md")
  await writeArtifact(project.root, ".open_magi/magi-log/round-002/council-002/prompt.md")
  await writeArtifact(project.root, ".open_magi/magi-log/round-002/council-002/report-melchior.md")
  await writeArtifact(project.root, ".open_magi/magi-log/round-002/council-002/report-balthasar.md")
  const calls = []
  const hooks = await server({
    client: fakeClient(calls),
    directory: project.root,
  })

  await hooks.event({
    event: { type: "session.idle", properties: { sessionID: "ses-1" } },
  })

  assert.equal(calls.length, 1)
  const prompt = calls[0].body.parts[0].text
  assert.match(prompt, /Artifact integrity repair required/)
  assert.match(prompt, /round-002\/council-002\/report-casper\.md/)
  assert.match(prompt, /round-002\/council-002\/synthesis\.md/)
  assert.doesNotMatch(prompt, /round-002\/verdict\.md/)

  const updated = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.equal(updated.active, true)
  assert.equal(updated.needsContinue, true)
  assert.match(updated.lastError, /artifact integrity repair required/i)

  await rm(project.root, { recursive: true, force: true })
})

test("idle event repairs missing direction selection before review pass", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    currentRound: 1,
    currentPhase: "research_task",
    currentDeliberationPass: 2,
    maxDeliberationPasses: 3,
    deliberationStatus: "direction_selected",
    needsContinue: false,
    lastPromptedRound: 1,
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  await writeArtifact(project.root, ".open_magi/magi-log/checklist.md")
  await writeArtifact(project.root, ".open_magi/magi-log/round-001/research-prompt.md")
  for (const artifact of [
    "prompt.md",
    "report-melchior.md",
    "report-balthasar.md",
    "report-casper.md",
    "synthesis.md",
  ]) {
    await writeArtifact(project.root, `.open_magi/magi-log/round-001/council-001/${artifact}`)
  }
  await writeArtifact(project.root, ".open_magi/magi-log/round-001/council-002/prompt.md")
  const calls = []
  const hooks = await server({
    client: fakeClient(calls),
    directory: project.root,
  })

  await hooks.event({
    event: { type: "session.idle", properties: { sessionID: "ses-1" } },
  })

  assert.equal(calls.length, 1)
  const prompt = calls[0].body.parts[0].text
  assert.match(prompt, /Artifact integrity repair required/)
  assert.match(prompt, /round-001\/direction-selection\.md/)
  assert.doesNotMatch(prompt, /round-001\/verdict\.md/)

  const updated = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.equal(updated.active, true)
  assert.equal(updated.needsContinue, true)
  assert.match(updated.lastError, /artifact integrity repair required/i)

  await rm(project.root, { recursive: true, force: true })
})

test("status assessment does not require current-round council artifacts when pass was not reset", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    currentRound: 2,
    currentPhase: "status_assessment",
    currentDeliberationPass: 3,
    maxDeliberationPasses: 3,
    deliberationStatus: "needs_more_deliberation",
    needsContinue: true,
    lastPromptedRound: 1,
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  await writeArtifact(project.root, ".open_magi/magi-log/checklist.md")
  await writeArtifact(project.root, ".open_magi/magi-log/round-001/research-prompt.md")
  await writeArtifact(project.root, ".open_magi/magi-log/round-001/verdict.md")
  await writeArtifact(project.root, ".open_magi/magi-log/round-001/verification.md")
  const calls = []
  const hooks = await server({
    client: fakeClient(calls),
    directory: project.root,
  })

  await hooks.event({
    event: { type: "session.idle", properties: { sessionID: "ses-1" } },
  })

  assert.equal(calls.length, 1)
  const prompt = calls[0].body.parts[0].text
  assert.doesNotMatch(prompt, /Artifact integrity repair required/)
  assert.doesNotMatch(prompt, /round-002\/council-/)

  const updated = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.equal(updated.currentDeliberationPass, 1)
  assert.equal(updated.deliberationStatus, "not_started")
  assert.doesNotMatch(updated.lastError || "", /artifact integrity repair/i)

  await rm(project.root, { recursive: true, force: true })
})

test("normalized next-round council state enters research task without phantom previous passes", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    currentRound: 2,
    currentPhase: "status_assessment",
    currentDeliberationPass: 3,
    maxDeliberationPasses: 3,
    deliberationStatus: "needs_more_deliberation",
    needsContinue: true,
    lastPromptedRound: 1,
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  await writeArtifact(project.root, ".open_magi/magi-log/checklist.md")
  await writeArtifact(project.root, ".open_magi/magi-log/round-001/research-prompt.md")
  await writeArtifact(project.root, ".open_magi/magi-log/round-001/verdict.md")
  await writeArtifact(project.root, ".open_magi/magi-log/round-001/verification.md")
  const calls = []
  const hooks = await server({
    client: fakeClient(calls),
    directory: project.root,
  })

  await hooks.event({
    event: { type: "session.idle", properties: { sessionID: "ses-1" } },
  })

  const normalized = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.equal(normalized.currentDeliberationPass, 1)
  assert.equal(normalized.deliberationStatus, "not_started")

  const researchState = {
    ...normalized,
    currentPhase: "research_task",
    needsContinue: true,
    inFlight: false,
    inFlightSince: null,
    lastPromptedRound: 1,
  }
  await writeFile(project.statePath, JSON.stringify(researchState, null, 2))
  await writeArtifact(project.root, ".open_magi/magi-log/round-002/research-prompt.md")

  await hooks.event({
    event: { type: "session.idle", properties: { sessionID: "ses-1" } },
  })

  assert.equal(calls.length, 2)
  const prompt = calls[1].body.parts[0].text
  assert.match(prompt, /Council pass 1 of 3/)
  assert.doesNotMatch(prompt, /Artifact integrity repair required/)
  assert.doesNotMatch(prompt, /round-002\/council-002/)
  assert.doesNotMatch(prompt, /round-002\/council-003/)

  await rm(project.root, { recursive: true, force: true })
})

test("council verdict requires direction selection even if state is still on pass one", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    currentRound: 1,
    currentPhase: "execution",
    currentDeliberationPass: 1,
    maxDeliberationPasses: 3,
    deliberationStatus: "ready_for_verdict",
    needsContinue: false,
    lastPromptedRound: 1,
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  await writeArtifact(project.root, ".open_magi/magi-log/checklist.md")
  await writeArtifact(project.root, ".open_magi/magi-log/round-001/research-prompt.md")
  for (const artifact of [
    "prompt.md",
    "report-melchior.md",
    "report-balthasar.md",
    "report-casper.md",
    "synthesis.md",
  ]) {
    await writeArtifact(project.root, `.open_magi/magi-log/round-001/council-001/${artifact}`)
  }
  await writeArtifact(project.root, ".open_magi/magi-log/round-001/verdict.md")
  await writeArtifact(project.root, ".open_magi/magi-log/round-001/verification.md")
  const calls = []
  const hooks = await server({
    client: fakeClient(calls),
    directory: project.root,
  })

  await hooks.event({
    event: { type: "session.idle", properties: { sessionID: "ses-1" } },
  })

  assert.equal(calls.length, 1)
  const prompt = calls[0].body.parts[0].text
  assert.match(prompt, /Artifact integrity repair required/)
  assert.match(prompt, /round-001\/direction-selection\.md/)
  assert.doesNotMatch(prompt, /round-001\/verdict\.md/)

  const updated = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.equal(updated.active, true)
  assert.equal(updated.needsContinue, true)
  assert.match(updated.lastError, /artifact integrity repair required/i)

  await rm(project.root, { recursive: true, force: true })
})

test("council max deliberation passes is clamped to the minimum proposal-first budget", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    currentRound: 1,
    currentPhase: "research_task",
    currentDeliberationPass: 1,
    maxDeliberationPasses: 2,
    deliberationStatus: "not_started",
    needsContinue: true,
    lastPromptedRound: 0,
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  await writeArtifact(project.root, ".open_magi/magi-log/checklist.md")
  await writeArtifact(project.root, ".open_magi/magi-log/round-001/research-prompt.md")
  const calls = []
  const hooks = await server({
    client: fakeClient(calls),
    directory: project.root,
  })

  await hooks.event({
    event: { type: "session.idle", properties: { sessionID: "ses-1" } },
  })

  assert.equal(calls.length, 1)
  const prompt = calls[0].body.parts[0].text
  assert.match(prompt, /Council pass 1 of 3/)
  assert.doesNotMatch(prompt, /Council pass 1 of 2/)

  await rm(project.root, { recursive: true, force: true })
})

test("state write does not reopen a completed fast-path loop with a final report", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    currentPhase: "complete",
    active: false,
    needsContinue: false,
    lastPromptedRound: 3,
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  await writeArtifact(project.root, ".open_magi/magi-log/final-report.md")
  const calls = []
  const hooks = await server({
    client: fakeClient(calls),
    directory: project.root,
  })

  await hooks["tool.execute.after"]({
    sessionID: "ses-1",
    tool: "write",
    args: { filePath: project.statePath },
  })

  assert.equal(calls.length, 0)

  const updated = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.equal(updated.active, false)
  assert.equal(updated.needsContinue, false)
  assert.equal(updated.currentPhase, "complete")

  await rm(project.root, { recursive: true, force: true })
})

test("state write does not reopen a real completed status_assessment loop with a final report", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    currentRound: 2,
    currentPhase: "status_assessment",
    active: false,
    needsContinue: false,
    lastPromptedRound: 2,
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  await writeArtifact(project.root, ".open_magi/magi-log/final-report.md")
  const calls = []
  const hooks = await server({
    client: fakeClient(calls),
    directory: project.root,
  })

  await hooks["tool.execute.after"]({
    sessionID: "ses-1",
    tool: "write",
    args: { filePath: project.statePath },
  })

  assert.equal(calls.length, 0)

  const updated = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.equal(updated.active, false)
  assert.equal(updated.needsContinue, false)
  assert.equal(updated.currentPhase, "status_assessment")

  await rm(project.root, { recursive: true, force: true })
})

test("state write reopens an incorrectly closed non-complete loop when required artifacts are missing", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    currentPhase: "execution",
    active: false,
    needsContinue: false,
    lastPromptedRound: 3,
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  const calls = []
  const hooks = await server({
    client: fakeClient(calls),
    directory: project.root,
  })

  await hooks["tool.execute.after"]({
    sessionID: "ses-1",
    tool: "write",
    args: { filePath: project.statePath },
  })

  assert.equal(calls.length, 1)
  assert.match(calls[0].body.parts[0].text, /Artifact integrity repair required/)

  const updated = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.equal(updated.active, true)
  assert.equal(updated.needsContinue, true)
  assert.equal(updated.currentPhase, "execution")
  assert.match(updated.lastError, /artifact integrity repair required/i)

  await rm(project.root, { recursive: true, force: true })
})

test("state write repairs active next-round state that regressed to goal_definition", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    currentRound: 2,
    currentPhase: "goal_definition",
    needsContinue: true,
    inFlight: false,
    lastPromptedRound: 1,
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  const calls = []
  const hooks = await server({
    client: fakeClient(calls),
    directory: project.root,
  })

  await hooks["tool.execute.after"]({
    sessionID: "ses-1",
    tool: "write",
    args: { filePath: project.statePath },
  })

  assert.equal(calls.length, 0)
  const updated = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.equal(updated.currentPhase, "status_assessment")
  assert.equal(updated.needsContinue, true)
  assert.equal(updated.inFlight, false)
  assert.match(updated.lastError, /round transition repair required/i)

  await rm(project.root, { recursive: true, force: true })
})

test("idle event does not recover completed or blocked loops without needsContinue", async () => {
  for (const phase of ["complete", "blocked"]) {
    const project = await makeProject("{}")
    const state = activeState({
      projectRoot: project.root,
      currentPhase: phase,
      needsContinue: false,
      lastPromptedRound: 0,
    })
    await writeFile(project.statePath, JSON.stringify(state, null, 2))
    const calls = []
    const hooks = await server({
      client: fakeClient(calls),
      directory: project.root,
    })

    await hooks.event({
      event: { type: "session.idle", properties: { sessionID: "ses-1" } },
    })

    assert.equal(calls.length, 0)
    const updated = JSON.parse(await readFile(project.statePath, "utf8"))
    assert.equal(updated.inFlight, false)

    await rm(project.root, { recursive: true, force: true })
  }
})

test("idle event blocks an active loop when consecutive no-progress reaches the limit", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    currentPhase: "status_assessment",
    needsContinue: true,
    consecutiveNoProgress: 5,
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  await writeArtifact(project.root, ".open_magi/magi-log/checklist.md")
  const calls = []
  const hooks = await server({
    client: fakeClient(calls),
    directory: project.root,
  })

  await hooks.event({
    event: { type: "session.idle", properties: { sessionID: "ses-1" } },
  })

  assert.equal(calls.length, 0)
  const updated = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.equal(updated.active, false)
  assert.equal(updated.currentPhase, "blocked")
  assert.equal(updated.needsContinue, false)
  assert.match(updated.lastError, /no progress limit reached/i)

  await rm(project.root, { recursive: true, force: true })
})

test("state write derives the no-progress limit from trailing history progress markers", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    currentPhase: "status_assessment",
    needsContinue: true,
    consecutiveNoProgress: 0,
    history: [
      { round: 1, progress: true },
      { round: 2, progress: false },
      { round: 3, progress: false },
      { round: 4, progress: false },
      { round: 5, progress: false },
      { round: 6, progress: false },
    ],
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  const calls = []
  const hooks = await server({
    client: fakeClient(calls),
    directory: project.root,
  })

  await hooks["tool.execute.after"]({
    sessionID: "ses-1",
    tool: "write",
    args: { filePath: project.statePath },
  })

  assert.equal(calls.length, 0)
  const updated = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.equal(updated.consecutiveNoProgress, 5)
  assert.equal(updated.active, false)
  assert.equal(updated.currentPhase, "blocked")
  assert.equal(updated.needsContinue, false)

  await rm(project.root, { recursive: true, force: true })
})

test("chat.message rebinds an active loop to a new primary session in the same project", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    sessionID: "ses-old",
    mainAgent: "build",
    currentPhase: "research_task",
    needsContinue: true,
    inFlight: false,
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  const hooks = await server({
    client: fakeClient([]),
    directory: project.root,
  })

  await hooks["chat.message"]({ sessionID: "ses-new", agent: "build" })

  const updated = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.equal(updated.sessionID, "ses-new")
  assert.equal(updated.previousSessionID, "ses-old")
  assert.equal(updated.mainAgent, "build")
  assert.equal(updated.needsContinue, true)
  assert.equal(updated.inFlight, false)
  assert.match(updated.lastError, /rebound active loop from ses-old to ses-new/)

  await rm(project.root, { recursive: true, force: true })
})

test("chat.message does not rebind an active loop while the old session is in flight", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    sessionID: "ses-old",
    mainAgent: "build",
    currentPhase: "research_task",
    inFlight: true,
    inFlightSince: new Date().toISOString(),
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  const hooks = await server({
    client: fakeClient([]),
    directory: project.root,
  })

  await hooks["chat.message"]({ sessionID: "ses-new", agent: "build" })

  const updated = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.equal(updated.sessionID, "ses-old")
  assert.equal(updated.previousSessionID, undefined)

  await rm(project.root, { recursive: true, force: true })
})

test("chat.message does not bind a new loop to deliberator subagent sessions", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    sessionID: null,
    mainAgent: "build",
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  const hooks = await server({
    client: fakeClient([]),
    directory: project.root,
  })

  await hooks["chat.message"]({ sessionID: "ses-subagent", agent: "deliberator-melchior" })

  const afterSubagent = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.equal(afterSubagent.sessionID, null)
  assert.equal(afterSubagent.mainAgent, "build")

  await hooks["chat.message"]({ sessionID: "ses-primary", agent: "build" })

  const afterPrimary = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.equal(afterPrimary.sessionID, "ses-primary")
  assert.equal(afterPrimary.mainAgent, "build")

  await rm(project.root, { recursive: true, force: true })
})

test("tool.execute.after binds the primary session after a bash state file write", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    sessionID: null,
    mainAgent: "build",
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  const hooks = await server({
    client: fakeClient([]),
    directory: project.root,
  })

  await hooks["tool.execute.after"]({
    sessionID: "ses-primary",
    tool: "bash",
    args: {
      command: `cat > ${project.statePath} << 'STATEEOF'\n{}\nSTATEEOF`,
    },
  })

  const updated = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.equal(updated.sessionID, "ses-primary")
  assert.equal(updated.mainAgent, "build")

  await rm(project.root, { recursive: true, force: true })
})

test("tool.execute.after does not rebind an active loop after a state file write from an unknown session", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    sessionID: "ses-old",
    mainAgent: "build",
    currentPhase: "research_task",
    inFlight: false,
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  const hooks = await server({
    client: fakeClient([]),
    directory: project.root,
  })

  await hooks["tool.execute.after"]({
    sessionID: "ses-new",
    tool: "write",
    args: { filePath: project.statePath },
  })

  const updated = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.equal(updated.sessionID, "ses-old")
  assert.equal(updated.previousSessionID, undefined)

  await rm(project.root, { recursive: true, force: true })
})

test("tool.execute.after does not bind the primary session after a bash state file read", async () => {
  const project = await makeProject("{}")
  const state = activeState({
    projectRoot: project.root,
    sessionID: null,
    mainAgent: "build",
  })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  const hooks = await server({
    client: fakeClient([]),
    directory: project.root,
  })

  await hooks["tool.execute.after"]({
    sessionID: "ses-primary",
    tool: "bash",
    args: {
      command: `cat ${project.statePath}`,
    },
  })

  const updated = JSON.parse(await readFile(project.statePath, "utf8"))
  assert.equal(updated.sessionID, null)
  assert.equal(updated.mainAgent, "build")

  await rm(project.root, { recursive: true, force: true })
})

test("compaction hook injects active deliberation context with checklist reminder", async () => {
  const project = await makeProject("{}")
  const state = activeState({ projectRoot: project.root, currentPhase: "synthesis" })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  const hooks = await server({
    client: fakeClient([]),
    directory: project.root,
  })
  const output = { context: [] }

  await hooks["experimental.session.compacting"]({ sessionID: "ses-1" }, output)

  assert.equal(output.context.length, 1)
  assert.match(output.context[0], /finish the toy goal/)
  assert.match(output.context[0], /currentRound: 3/)
  assert.match(output.context[0], /currentPhase: synthesis/)
  assert.match(output.context[0], /checklist\.md/)
  assert.match(output.context[0], /Do not ask procedural questions/)
  assert.match(output.context[0], /Before Asking User Gate/)

  const otherOutput = { context: [] }
  await hooks["experimental.session.compacting"]({ sessionID: "other" }, otherOutput)
  assert.deepEqual(otherOutput.context, [])

  await rm(project.root, { recursive: true, force: true })
})

test("invalid state json is backed up and prompts repair without crashing hooks", async () => {
  const project = await makeProject("{ invalid json")
  const calls = []
  const hooks = await server({
    client: fakeClient(calls),
    directory: project.root,
  })

  await hooks.event({
    event: { type: "session.idle", properties: { sessionID: "ses-1" } },
  })

  assert.equal(calls.length, 1)
  assert.match(calls[0].body.parts[0].text, /State file repair required/)
  assert.match(calls[0].body.parts[0].text, /state\.json/)
  const errorPath = join(project.logDir, "plugin-error.log")
  assert.equal(existsSync(errorPath), true)
  assert.match(await readFile(errorPath, "utf8"), /Failed to read state/)
  const backups = (await readdir(project.logDir)).filter((name) =>
    /^state\.json\.corrupt-\d{8}T\d{6}\.\d{3}Z\.bak$/.test(name),
  )
  assert.equal(backups.length, 1)
  assert.match(await readFile(join(project.logDir, backups[0]), "utf8"), /\{ invalid json/)

  await rm(project.root, { recursive: true, force: true })
})

test("repeated corrupt state repair failures escalate to a blocked repair marker", async () => {
  const project = await makeProject("{ invalid json")
  const calls = []
  const hooks = await server({
    client: fakeClient(calls),
    directory: project.root,
  })

  for (let index = 0; index < 3; index++) {
    await hooks.event({
      event: { type: "session.idle", properties: { sessionID: "ses-1" } },
    })
  }

  assert.equal(calls.length, 3)
  assert.match(calls[0].body.parts[0].text, /State file repair required/)
  assert.match(calls[2].body.parts[0].text, /State file repair halted/)
  assert.match(calls[2].body.parts[0].text, /state-repair-blocked\.md/)

  const marker = JSON.parse(await readFile(join(project.logDir, ".state-corrupt-count.json"), "utf8"))
  assert.equal(marker.count, 3)
  assert.equal(typeof marker.firstSeenAt, "string")
  assert.equal(typeof marker.lastSeenAt, "string")
  assert.match(marker.latestBackup, /^state\.json\.corrupt-/)

  const blocked = await readFile(join(project.logDir, "state-repair-blocked.md"), "utf8")
  assert.match(blocked, /status: hard_error/)
  assert.match(blocked, /failure_type: hard_error/)
  assert.match(blocked, /state\.json/)

  await hooks.event({
    event: { type: "session.idle", properties: { sessionID: "ses-1" } },
  })
  assert.equal(calls.length, 3)

  await rm(project.root, { recursive: true, force: true })
})

test("event hook logs prompt failures instead of throwing to the host", async () => {
  const project = await makeProject("{}")
  const state = activeState({ projectRoot: project.root })
  await writeFile(project.statePath, JSON.stringify(state, null, 2))
  await writeArtifact(project.root, ".open_magi/magi-log/checklist.md")
  const hooks = await server({
    client: fakeClient([], { promptError: new Error("prompt transport failed") }),
    directory: project.root,
  })

  await assert.doesNotReject(() =>
    hooks.event({
      event: { type: "session.idle", properties: { sessionID: "ses-1" } },
    }),
  )

  const errorPath = join(project.logDir, "plugin-error.log")
  assert.equal(existsSync(errorPath), true)
  assert.match(await readFile(errorPath, "utf8"), /Failed to send continue prompt/)

  await rm(project.root, { recursive: true, force: true })
})

test("event hook contains unexpected filesystem errors instead of rejecting", async () => {
  const rootFile = join(tmpdir(), `open-magi-not-a-dir-${Date.now()}-${Math.random()}`)
  await writeFile(rootFile, "not a directory")
  const hooks = await server({
    client: fakeClient([]),
    directory: rootFile,
  })

  await assert.doesNotReject(() =>
    hooks.event({
      event: { type: "session.idle", properties: { sessionID: "ses-1" } },
    }),
  )

  await rm(rootFile, { force: true })
})
}
