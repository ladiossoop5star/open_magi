# Deliberation Reference

Use this for Phase 1b recon, Phase 2, Phase 3, Phase 4, Phase 6 completion
review, timeout handling, synthesis, and verdict writing.

## Council Modes

The council runs in three modes. All three share the same launch mechanics,
timeout handling, and report file rules; only the prompt contract and the gate
differ.

- `recon` (Phase 1b, round 1 only): parallel evidence gathering. Reports land
  in `round-NNN/recon-001/`.
- `decision` (Phase 2-4): proposal-first direction selection before execution.
  Reports land in `round-NNN/council-PPP/`.
- `review` (Phase 6, completion claim only): adversarial review of the actual
  diff before `final-report.md`. Reports land in `round-NNN/review-001/`.

Set `state.json.currentCouncilMode` to the active mode before launching
deliberators so runtime adapters route timeout and hard-error reports to the
correct directory.

## Phase 1b: Recon Pass (Round 1 Only)

Write `round-NNN/recon-001/prompt.md` with:
- the goal and acceptance criteria;
- observed symptoms: error messages, failing test output, git status/diff
  summary;
- files or areas already identified during Phase 1a minimal scoping;
- one precise recon question per sage angle;
- forbidden actions for sub-agents;
- the required report format.

Launch all three deliberators with the same recon prompt. Each deliberator
investigates read-only from its own angle and reports findings, not a fix:
- Melchior: implementation status, risk points, relevant code paths.
- Balthasar: architecture boundaries, module dependencies, design context.
- Casper: reproduction conditions, evidence gaps, unverified assumptions.

Recon report semantics reuse the standard report header:
- `stance: approve` means the evidence is sufficient to draft the decision
  council prompt; `stance: needs_evidence` names the missing evidence.
- `recommended_plan` is normally `none`; recon reports findings, not fixes.
- `verification_plan` lists candidate checks discovered during recon.

After the three `round-NNN/recon-001/report-*.md` files exist, write
`round-NNN/evidence-base.md` with:
- confirmed facts, each tied to a file, output, or report;
- open questions the decision council must answer;
- key files and symbols;
- constraints and candidate verification approaches.

Phase 2 must draw its evidence packet from `evidence-base.md`. Do not perform
extended single-agent debugging between recon and the decision council.

## Phase 2: Research Task

Write `round-NNN/research-prompt.md` with:
- relevant context (round 1: from `evidence-base.md`; later rounds: from the
  previous round's verification and diagnostic evidence);
- one precise question for this round;
- Diagnostic evidence from the previous failed round, if present;
- known constraints;
- forbidden actions for sub-agents;
- required report format.

For the active council pass, also write `round-NNN/council-PPP/prompt.md`.

Pass prompt rules:
- Pass 1 is the proposal pass. Pass 1 is not a veto pass. The main agent
  prepares an evidence packet and does not propose a fix. Deliberators provide
  a direction proposal in `recommended_plan`.
- After pass 1, the main agent writes `round-NNN/direction-selection.md` with
  selected direction, rejected alternatives, rationale, verification pressure,
  and rollback concerns.
- Pass 2 is the review pass for the selected direction. It includes
  `direction-selection.md` and asks deliberators to approve, oppose, or request
  evidence.
- Later passes include the previous council synthesis, unresolved objections,
  evidence requests, and the exact decision pressure for this pass.
- Do not perform extended single-agent debugging before launching deliberators.

All three deliberators receive the same council prompt.

## Phase 3: Parallel Deliberation

Start three subtasks using the runtime's subagent or task tool. Read
`references/runtime.md` for adapter-specific launch mechanics. If named
subagents are available, use:

```json
[
  {
    "type": "subtask",
    "agent": "deliberator-melchior",
    "description": "Melchior deliberation",
    "prompt": "<research prompt>"
  },
  {
    "type": "subtask",
    "agent": "deliberator-balthasar",
    "description": "Balthasar deliberation",
    "prompt": "<research prompt>"
  },
  {
    "type": "subtask",
    "agent": "deliberator-casper",
    "description": "Casper deliberation",
    "prompt": "<research prompt>"
  }
]
```

Write results to the active council mode directory:
- decision mode: `round-NNN/council-PPP/report-melchior.md`,
  `report-balthasar.md`, `report-casper.md`;
- recon mode: `round-NNN/recon-001/report-*.md`;
- review mode: `round-NNN/review-001/report-*.md`.

If the runtime cannot launch named subagents, use equivalent read-only
deliberator prompts with the same role names and still write the same report
file names. This fallback is less reliable because it may reuse the main
agent's model instead of the configured sage models.

Each report must be concise and include required metadata fields. During the
proposal pass, `recommended_plan` is the direction proposal. During a review
pass, `stance` and `blocking_objection` judge the selected direction. Do not
proceed to synthesis until all three report files exist. If a deliberator needs
more task evidence or times out, write that deliberator's report file with
failure evidence and `stance: needs_evidence` instead of omitting it. If a
deliberator hits `hard_error`, halt the loop as described below.

When the plugin writes a timeout report, do not overwrite it unless the same
deliberator later produces a complete report for the same council pass before
synthesis begins. If overwritten, preserve timeout evidence in `synthesis.md`.

## Deliberator Failure Classification

Classify deliberator failures before synthesis:
- `needs_evidence`: a normal deliberator report that requests more task data,
  opposes the selected direction, or sets `blocking_objection: yes`. Continue
  through the Council Pass Gate.
- `timeout`: the deliberator exceeded `deliberatorTimeoutMs`. Write or preserve
  a timeout report with `status: timeout` and `failure_type: timeout`, then
  continue through the timeout gate.
- `hard_error`: the deliberator runtime failed, for example provider auth,
  invalid model, sandbox/config error, missing runner, or a child
  `session.error`. Write a hard-error report with `status: hard_error` and
  `failure_type: hard_error`; set `currentPhase=blocked`, `active=false`, and
  `needsContinue=false`; tell the user which config file or runtime setting to
  repair before resuming.

Do not treat `hard_error` as an ordinary veto. A hard error means the council
cannot be trusted because one configured deliberator did not run.

## Deliberator Timeout Gate

Rules:
- Default timeout is 30 minutes per deliberator child session.
- Timeout applies to each council pass independently.
- A timeout report uses `status: timeout`, `failure_type: timeout`,
  `stance: needs_evidence`, and `blocking_objection: yes`.
- Pass 1 timeout means a missing direction proposal; record it in synthesis.
- Pass 2 starts veto review, so any timeout report is a veto unless
  `maxDeliberationPasses` has been reached.
- From Pass 3 onward, one timeout does not automatically block action if two
  other deliberators support the same executable plan, no new high-risk
  objection exists, and the verification plan is clear.
- If two or more deliberators time out in one pass, run another pass unless
  `maxDeliberationPasses` has been reached.
- If the same deliberator times out twice in the same execution round, continue
  with the remaining reports and timeout evidence.

Do not ask the user what to do after a timeout. Read the timeout report, record
the risk in synthesis, and continue through the Council Pass Gate.

## Phase 4: Synthesis and Decision

Write `round-NNN/council-PPP/synthesis.md` with consensus, disagreements,
unique insights, blocking objections, evidence for each conclusion, and reasons
rejected recommendations were not chosen.

After proposal pass 1:
- compare all direction proposals;
- write `round-NNN/direction-selection.md` with selected direction, rejected
  alternatives, evidence, risks, verification pressure, and rollback concerns;
- increment `currentDeliberationPass` to 2;
- set `deliberationStatus=direction_selected`;
- set `currentPhase=research_task`;
- do not write `verdict.md` yet.

If another pass is required:
- write unresolved objections and next-pass question into current synthesis;
- increment `currentDeliberationPass`;
- set `deliberationStatus=needs_more_deliberation`;
- set `currentPhase=research_task`;
- do not ask the user for direction.

If ready for action, write `round-NNN/verdict.md` with:
- `decision`;
- `rationale`;
- `expected_progress`;
- `allowed_files`;
- `allowed_changes`;
- `verification_commands`;
- `failure_diagnostic_commands`;
- `checkpoint_commit_plan`;
- `rollback_plan`.

Use `failure_diagnostic_commands` only for commands that collect data needed
for the next round if verification fails. Keep it empty when no fail-only
diagnostic data is needed.

Keep `synthesis.md` and `verdict.md` short enough to unblock action. Prefer a
direct, verifiable decision over long analysis.

## Phase 6: Completion Review Pass

Run exactly one review pass per completion claim, before `final-report.md`.

Write `round-NNN/review-001/prompt.md` with:
- the acceptance criteria and verification commands;
- `round-NNN/verdict.md` and `round-NNN/verification.md`;
- the actual diff: `git diff` output against the round start or checkpoint,
  or the full contents of changed files. Never substitute the main agent's
  summary of the diff;
- the review questions: does the diff implement the verdict, does the
  verification prove the acceptance criteria, what was missed;
- forbidden actions for sub-agents;
- the required report format.

Launch all three deliberators with the same review prompt. Each reviews
adversarially from its own angle:
- Melchior: does the diff actually implement the verdict? New risks introduced?
- Balthasar: is the change architecturally sound? Boundaries respected?
- Casper: does the verification output prove the acceptance criteria, or does
  it merely show green tests that miss the claimed fix? Did execution diverge
  from the verdict?

Review report semantics reuse the standard report header:
- `stance: approve` only when the diff implements the verdict and the
  verification proves the acceptance criteria;
- `stance: oppose` or `blocking_objection: yes` for any concrete gap, with
  the gap cited in Evidence;
- `verdict_adherence` is judged by the review council, not self-reported:
  reviewers cite any divergence between `verdict.md` and the actual diff.

After the three `round-NNN/review-001/report-*.md` files exist, write
`round-NNN/review-verdict.md`:

```md
outcome: approved | objected
verdict_adherence_confirmed: yes | no
melchior_stance: approve | oppose | needs_evidence
balthasar_stance: approve | oppose | needs_evidence
casper_stance: approve | oppose | needs_evidence
blocking_objections: none | one-line list
```

`outcome: approved` requires all three stances at `approve`, no
`blocking_objection: yes`, and `verdict_adherence_confirmed: yes`. Timeout
reports count as `needs_evidence` with a blocking objection, so a timeout can
never produce `approved`. On `approved`, write `final-report.md` and close the
loop. On `objected`, start the next round with the objections as evidence.
Do not ask the user whether the review passed; the gate decides.

## Required Report Format for Deliberators

```md
stance: approve | oppose | needs_evidence
blocking_objection: yes | no
recommended_plan: one concrete plan, direction proposal, or "none"
verification_plan: one concrete verification path or "none"
risk_level: low | medium | high

## Summary
One paragraph, max two sentences.

## Evidence
- Up to three specific evidence bullets.

## Risks
- Up to three failure modes and why they matter.

## Recommended Next Action
- One action for the main agent.

## Confidence
High / Medium / Low with one reason.

## Blocking Questions
- Write "None" unless the main agent cannot proceed without an answer.
```

Report length limit: keep the entire deliberator report under about 1200
characters. Do not include hidden reasoning, chain-of-thought, or `<think>`
blocks.
