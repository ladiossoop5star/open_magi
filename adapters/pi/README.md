# Open Magi for Pi

## Status

Experimental. OpenCode remains the only production-supported runtime; the Pi
adapter matches the current maturity of the Codex and Claude adapters.

## Install for Local Development

    cd /path/to/open_magi
    pi install .

Remote (Git) installs must skip the repo root `postinstall` (it configures
OpenCode, not Pi):

    OPEN_MAGI_SKIP_POSTINSTALL=1 pi install git:github.com/ladiossoop5star/open_magi

## Usage

- `/magi <goal>`, `/skill:magi <goal>`, or an explicit use-Magi request starts
  the loop on an interactive Pi session.
- `/magi-setup` edits per-role model overrides (user scope owner-only 0600;
  project scope read only when the project is trusted).
- Deliberation runs through the internal `magi_council` tool: three isolated
  read-only Pi children in JSON mode, atomic `report-*.md` writes, fail-closed
  error envelopes.

## Herdr Precedence

Under `HERDR_ENV=1` the `.open-magi-herdr` activation gate, pane ownership, and
the three-pane lifecycle are authoritative; the native Pi council rejects
invocation. See README.md#herdr-native-deliberation.

## Limitations

- No print/JSON/RPC main controller in the first release.
- No general Pi subagents; the runner is council-only.
- Deliberator children load no user extensions, skills, prompt templates,
  themes, or project context files.
