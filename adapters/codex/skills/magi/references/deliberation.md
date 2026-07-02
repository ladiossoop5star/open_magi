# Deliberation Reference

Use this for Phase 2, Phase 3, Phase 4, timeout handling, synthesis, and
verdict writing.

## Phase 2: Research Task

Write `round-NNN/research-prompt.md` with:
- relevant context;
- one precise question for this round;
- Diagnostic evidence from the previous failed round, if present;
- known constraints;
- forbidden actions for sub-agents;
- required report format.

For the active council pass, also write `round-NNN/council-PPP/prompt.md`.

Pass prompt rules:
- Pass 1 is the proposal pass. The main agent prepares an evidence packet and
  does not propose a fix. Deliberators provide a direction proposal in
  `recommended_plan`.
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

Write results to:
- `round-NNN/council-PPP/report-melchior.md`;
- `round-NNN/council-PPP/report-balthasar.md`;
- `round-NNN/council-PPP/report-casper.md`.

If the runtime cannot launch named subagents, use equivalent read-only
deliberator prompts with the same role names and still write the same report
file names. This fallback is less reliable because it may reuse the main
agent's model instead of the configured sage models.

Each report must be concise and include required metadata fields. During the
proposal pass, `recommended_plan` is the direction proposal. During a review
pass, `stance` and `blocking_objection` judge the selected direction. Do not
proceed to synthesis until all three report files exist. If a deliberator fails
or times out, write that deliberator's report file with failure evidence and
`stance: needs_evidence` instead of omitting it.

When the plugin writes a timeout report, do not overwrite it unless the same
deliberator later produces a complete report for the same council pass before
synthesis begins. If overwritten, preserve timeout evidence in `synthesis.md`.

## Deliberator Timeout Gate

Rules:
- Default timeout is 30 minutes per deliberator child session.
- Timeout applies to each council pass independently.
- A timeout report uses `status: timeout`, `stance: needs_evidence`, and
  `blocking_objection: yes`.
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
- `verification_commands`;
- `failure_diagnostic_commands`;
- `checkpoint_commit_plan`;
- `rollback_plan`.

Use `failure_diagnostic_commands` only for commands that collect data needed
for the next round if verification fails. Keep it empty when no fail-only
diagnostic data is needed.

Keep `synthesis.md` and `verdict.md` short enough to unblock action. Prefer a
direct, verifiable decision over long analysis.

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
