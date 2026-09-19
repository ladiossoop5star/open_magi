import { buildSkillInvocation, injectionOptions, detectActivation } from "./lib/activation.js"
import { createModelConfigApi, ROLE_NAMES, MODEL_CONFIG_VERSION } from "./lib/config.js"
import {
  isHerdrActive, TRANSPORT_MISMATCH_ERROR, validateCouncilInput,
  assertGuardableToolSet, createNativeController,
} from "./lib/controller.js"

// Peers stay OPTIONAL at runtime: production resolves them; CI-less peers are
// handled through the testOverrides injection seam (mandatory in tests).
export default async function (pi, testOverrides = {}) {
  const host = testOverrides.host ?? await import("@earendil-works/pi-coding-agent")
  const typebox = testOverrides.typebox ?? await import("typebox")
  const Type = typebox?.Type ?? typebox
  const modelConfig = testOverrides.modelConfig ?? createModelConfigApi({ getAgentDir: host.getAgentDir, CONFIG_DIR_NAME: host.CONFIG_DIR_NAME })
  const controller = testOverrides.controllerOverride ?? createNativeController({ pi, modelConfig })

  const councilInputSchema = Type.Union([
    Type.Object({
      projectRoot: Type.String(),
      promptPath: Type.String(),
      round: Type.Integer({ minimum: 1 }),
      pass: Type.Integer({ minimum: 1 }),
      mode: Type.Union([Type.Literal("decision"), Type.Literal("recon")]),
    }, { additionalProperties: false }),
    Type.Object({
      projectRoot: Type.String(),
      promptPath: Type.String(),
      round: Type.Integer({ minimum: 1 }),
      mode: Type.Literal("review"),
    }, { additionalProperties: false }),
  ])

  pi.registerCommand("magi", {
    description: "Run Open Magi deliberation on a goal",
    async handler(args, ctx) {
      const invocation = buildSkillInvocation(String(args ?? "").trim())
      await pi.sendUserMessage(invocation, injectionOptions(!ctx.isIdle()))
    },
  })

  pi.registerCommand("magi-setup", {
    description: "Edit per-role Open Magi model overrides for Pi",
    async handler(_args, ctx) {
      const scope = await ctx.ui.select(
        "Open Magi model overrides — choose scope",
        ["User scope (getAgentDir()/open-magi.json)", `Project scope (${modelConfig.CONFIG_DIR_NAME}/open-magi.json, trusted projects only)`],
      )
      if (!scope) return
      const isUserScope = scope.startsWith("User scope")
      if (!isUserScope && !ctx.isProjectTrusted()) {
        ctx.ui.notify("[magi] Project is not trusted; the project open-magi.json cannot be read or written.", "warning")
        return
      }
      const targetPath = isUserScope ? modelConfig.userModelConfigPath() : modelConfig.projectModelConfigPath(ctx.cwd)
      // Always pass the REAL ctx.isProjectTrusted() — the user-scope path must not
      // impersonate trust for the project file read.
      const loaded = await modelConfig.loadModelConfig({ projectRoot: ctx.cwd, isProjectTrusted: ctx.isProjectTrusted() })
      if (!loaded.ok) {
        ctx.ui.notify(loaded.error + " Fix or remove the file with /magi-setup after editing it manually.", "error")
        return
      }
      // Fresh reads: role defaults come from loadModelConfig() ONCE, so the value
      // shown in the input dialog is the CURRENT stored selector.
      const roleDefaultFor = (role) => String(isUserScope ? loaded.user?.models?.[role] ?? "" : loaded.project?.models?.[role] ?? "")
      // Distinguish cancel (undefined => drop the whole update) from an empty
      // string (clear THIS role only). Unmodified roles are preserved because the
      // dialog pre-fills the existing value and untouched roles confirm it.
      const next = { version: MODEL_CONFIG_VERSION, models: {} }
      for (const role of ROLE_NAMES) {
        const answer = await ctx.ui.input(
          `${role} — Pi model selector (empty clears the override; lower-precedence source inherits)`,
          roleDefaultFor(role),
        )
        if (answer === undefined) {
          ctx.ui.notify("[magi] Model override update cancelled; nothing written.", "info")
          return
        }
        const value = String(answer ?? "").trim()
        if (value) next.models[role] = value
      }

      // The loop above builds next.models: an empty answer drops that role
      // (clear), untouched roles keep their pre-filled default (preserve), and
      // there is NO merge-back of previously loaded values in either scope.
      await modelConfig.writeModelConfig(targetPath, next, { scope: isUserScope ? "user" : "project" })
      ctx.ui.notify(`[magi] ${isUserScope ? "User" : "Project"} model overrides written to ${targetPath} (CONFIG_DIR_NAME=${modelConfig.CONFIG_DIR_NAME}).`, "info")
    },
  })

  pi.registerTool({
    name: "magi_council",
    label: "Magi Council",
    description:
      "Run one Open Magi deliberation pass (three isolated read-only Pi children) for the CURRENT round/pass/mode and atomically write report-<sage>.md files. Only callable by the Magi skill during an active loop.",
    promptSnippet: "magi_council: execute the active Magi council/recon/review pass",
    parameters: councilInputSchema,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const validation = validateCouncilInput(params)
      if (!validation.ok) throw new Error(validation.message)
      if (isHerdrActive()) throw new Error(TRANSPORT_MISMATCH_ERROR)
      const guard = assertGuardableToolSet(pi.getAllTools(), pi.getActiveTools())
      if (!guard.ok) throw new Error(guard.message)
      const outcome = await controller.council({
        ...validation.normalized,
        isProjectTrusted: ctx.isProjectTrusted(),
        signal,
      })
      if (!outcome.ok && !outcome.results) {
        throw new Error(outcome.error) // PRE-dispatch failure only
      }
      const text = outcome.results.map((result) => `report-${result.sage} written to ${result.reportPath}${result.ok ? "" : ` (${result.failureType}: ${result.piFailureType ?? "unknown"})`}`).join("\n")
      return {
        content: [{ type: "text", text: `[magi] council pass complete for round ${validation.normalized.round}.\n${text}` }],
        details: { round: validation.normalized.round, pass: validation.normalized.pass, mode: validation.normalized.mode, results: outcome.results },
      }
    },
  })

  pi.on("input", async (event, ctx) => {
    const decision = detectActivation(event.text, { source: event.source, mode: ctx.mode })
    if (decision.action === "transform") return decision
    if (decision.action === "handled") {
      ctx.ui?.notify?.(decision.message, "warning")
      return decision // message rides along with the handled action
    }
    return { action: "continue" }
  })

  pi.on("session_start", async (event, ctx) => {
    // Await so subsequent events (tool_call, agent_settled) always see the fresh
    // filesystem state; restore() is intentionally fs-authoritative.
    // Pi 0.85.1: thinking level comes from pi.getThinkingLevel() (ExtensionAPI,
    // types.d.ts: getThinkingLevel(): ThinkingLevel), NOT an arbitrary
    // ctx.thinkingLevel; the current model comes from ExtensionContext.model
    // (typed `Model<any> | undefined`). Both are captured with `null` fallbacks.
    const capturedThinking = pi.getThinkingLevel?.() ?? ctx?.thinkingLevel ?? null
    const capturedModel = ctx.model?.id ?? null
    await controller.restore(ctx, { mainModel: capturedModel, thinkingLevel: capturedThinking })
  })

  pi.on("tool_call", async (event, ctx) => {
    return controller.enforceToolGuard(event, ctx)
  })

  pi.on("agent_settled", async (_event, ctx) => {
    await controller.settled(ctx)
  })

  pi.on("session_shutdown", async () => {
    // Await reaping of every owned council child before extension teardown.
    await controller.shutdown()
  })
}
