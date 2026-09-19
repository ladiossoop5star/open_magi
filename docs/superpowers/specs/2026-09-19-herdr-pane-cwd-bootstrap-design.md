# Herdr Pane Working-Directory Bootstrap Design

Date: 2026-09-19
Status: Approved approach, pending written-spec review

## Problem

The Herdr Magi contract currently tells the controller to pass the captured main-pane working directory to `herdr pane split --cwd`. That creation hint is not sufficient: a newly created pane can still reach agent startup from a different working directory, and the existing contract does not require a separate in-pane directory change before the configured agent command.

## Scope

This is a generic Herdr transport requirement, independent of the application hosting Magi or the application launched in each pane. It applies equally to the generic, OpenCode, Codex, Claude, and Pi skill distributions. It does not add behavior to the Pi extension, a native adapter runner, or any host-specific subprocess implementation.

## Selected Design

Keep `--cwd` on every split as a first layer. After each split returns its new pane ID, the first shell command executed inside that pane must be a standalone directory change to the captured absolute project directory:

```sh
cd -- '<captured directory>'
```

The controller must POSIX-single-quote the path as one shell argument, replacing every embedded `'` with the standard `'\''` sequence. It may parse the split response before this command, but it must not execute any other command inside the new pane first.

After submitting `cd`, poll `herdr pane get <new-pane-id>` for at most five seconds. Require `cwd`, and `foreground_cwd` when present, to resolve to the captured project directory. Only after that verification succeeds may the controller pass the role's raw command from `.open-magi-herdr` to `herdr pane run`.

The required ordering for every role is therefore:

1. Split with the captured directory supplied through `--cwd`.
2. Extract the new pane ID from the split response.
3. Execute a standalone, safely quoted `cd -- <captured-directory>` as the pane's first shell command.
4. Verify the pane reports the captured directory.
5. Execute the configured agent command.

Melchior, Casper, and Balthasar retain the existing split topology and ordering. No Herdr runner is added.

## Failure Handling

If the standalone `cd` cannot be submitted, times out, exits unsuccessfully where status is observable, or the pane never reports the expected directory, startup for that role fails closed. The controller must not run that role's configured agent command. Existing partial-startup ownership and recovery rules apply, preserving already validated sibling panes and recording the affected role without exposing raw commands.

## Documentation and Distribution

The shared Herdr runtime reference is the source contract. Its copies bundled for the generic, OpenCode, Codex, Claude, and Pi Magi skills must remain byte-identical through the repository's existing shared-reference checks. The English and Traditional Chinese README descriptions will explicitly describe the standalone `cd` gate as Herdr-wide behavior.

## Verification

Automated contract tests will require all of the following in the Herdr reference:

- split still uses `--cwd`;
- the first in-pane shell command is standalone `cd --` with safe quoting;
- pane cwd verification occurs after `cd` and before the raw agent command;
- failure prevents agent launch.

The Herdr integration procedure will also validate the observable sequence in an isolated test-owned session: split, standalone `cd`, confirmed cwd, then harmless recognized-agent launch.
