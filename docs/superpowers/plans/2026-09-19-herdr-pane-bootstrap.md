# Herdr Pane Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Herdr Magi sage start in the main pane's captured project directory and inherit the sage-only Stop-hook bypass before its configured command runs.

**Architecture:** Keep Herdr orchestration skill-driven with no new runner. Strengthen the shared Herdr contract and all distributed copies with an exact split/cd/verify/launch sequence, then document and test that sequence as a generic transport invariant.

**Tech Stack:** Markdown skill contracts, Node.js `node:test`, Herdr CLI contract tests.

---

### Task 1: Add failing generic Herdr bootstrap contract tests

**Files:**
- Modify: `test/package.test.mjs`
- Modify: `test/herdr-integration.md`

- [ ] Add assertions that the shared Herdr reference requires `--cwd`, `--env OPEN_MAGI_DISABLE_STOP_BACKSTOP=1`, a standalone first `cd --` command, cwd verification, and only then the configured raw command.
- [ ] Add an isolated integration scenario requiring the same observable ordering and proving a sage Stop hook is silent with the inherited bypass.
- [ ] Run `node --test --test-name-pattern='Herdr' test/package.test.mjs`; expect failure because the current reference does not contain the exact bootstrap contract.

### Task 2: Implement the shared Herdr bootstrap contract

**Files:**
- Modify: `shared/magi/references/herdr.md`
- Modify: `skills/magi/references/herdr.md`
- Modify: `adapters/codex/skills/magi/references/herdr.md`
- Modify: `adapters/claude/skills/magi/references/herdr.md`
- Modify: `adapters/pi/skills/magi/references/herdr.md`

- [ ] Require each split to pass both the captured absolute directory through `--cwd` and `OPEN_MAGI_DISABLE_STOP_BACKSTOP=1` through `--env`.
- [ ] Require the first command inside each new pane to be a standalone POSIX-safely quoted `cd -- <captured-directory>`.
- [ ] Require bounded `herdr pane get` polling that proves `cwd` and present `foreground_cwd` resolve to the captured project directory before launch.
- [ ] Fail the affected role closed without running its raw command when directory setup cannot be proven.
- [ ] Keep every distributed reference byte-identical to the shared reference.
- [ ] Run `node --test --test-name-pattern='Herdr' test/package.test.mjs`; expect all selected tests to pass.

### Task 3: Update user documentation and verify the package

**Files:**
- Modify: `README.md`
- Modify: `README.zh-TW.md`

- [ ] Document the generic split environment, first-command `cd`, cwd verification, and fail-closed behavior in both READMEs.
- [ ] Run `npm test`; expect 0 failures.
- [ ] Run `npm pack --dry-run`; expect the generic and adapter Herdr references in the package contents.
- [ ] Run `git diff --check`; expect no output.
- [ ] Commit the implementation and verification changes.

### Task 4: Install and validate on pgc0, local pgc1, and pgc2

**Files:**
- Deploy the committed package snapshot to each host's existing Open Magi installation locations.

- [ ] Discover each host's currently registered Open Magi paths without guessing or changing unrelated packages.
- [ ] Install the committed snapshot on pgc0, local pgc1, and pgc2.
- [ ] Verify the installed Herdr reference checksum is identical on all three hosts.
- [ ] Verify each installed reference contains the cwd bootstrap and Stop-hook bypass contract.
- [ ] Report that existing live sage panes require explicit cleanup/restart because installation cannot retroactively change their cwd or environment.
