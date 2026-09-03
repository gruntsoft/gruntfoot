# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project overview

gruntfoot is a pi extension package: a full-replacement footer (model/thinking colors, context bar,
usage/cost stats), static `borderAccent` editor separators with a session-name chip, a
`/gruntfoot` toggle, per-role color configuration (`/gruntfoot color…`, `/gruntfoot color-reset`),
and named color themes (`/gruntfoot theme…`). Entry point is `index.ts` (registered via the
`pi.extensions` field in `package.json`). ROADMAP.md holds unscheduled ideas — nothing there is
committed work.

## Commands

```bash
npm run check   # tsc --noEmit — typecheck; run before declaring done
npm test        # node --test test/ — plain Node, no terminal or pi instance needed
pi -e .         # run pi with the local extension loaded for manual TUI testing
```

The package is already loaded via `.pi/settings.json`. Use `/reload` after making changes to
prompts, skills, or extensions to pick them up live.

## Architecture

- `index.ts` — entry point; installs footer/editor overrides and the `/gruntfoot` command (toggle
  plus `color`/`color-reset`/`theme` subcommands). Installs are TUI mode only; silently no-ops in
  other modes. Toggle + colors state comes from `src/state.ts`, themes from `src/themes.ts`.
- `src/footer.ts` — footer layout and rendering.
- `src/editor.ts` — `GruntfootEditor`, wraps the previous editor component; renders separators and the
  session-name chip.
- `src/border.ts`, `src/thinking.ts`, `src/bar.ts`, `src/format.ts` — small pure helpers
  (border-color suppression, thinking-level colors, context bar cells, text formatting).
- `src/colors.ts` — color-role registry, value parsing/validation (`auto`, any pi fg token,
  `#RRGGBB`/`#RGB` hex, ANSI-256 index), auto-chain resolution, and raw-ANSI styling (hex
  downconverts to the nearest xterm-256 index on 256-color terminals).
- `src/command.ts` — pure parsing and slash-command completions for the `/gruntfoot` subcommands;
  unit-testable without pi.
- `src/picker.ts` — two-step color picker (role list → value list with live previews) for
  `ctx.ui.custom`; a thin TUI component over pure item builders.
- `src/theme-picker.ts` — theme save/load picker (menu → name input → overwrite confirmation →
  load list), mirroring the color picker's structure.
- `src/themes.ts` — `createThemeStore()`: one JSON file per theme in
  `~/.pi/agent/gruntfoot/themes/`; name normalization, overwrite refusal, defensive fs (never
  throws; injectable hooks keep tests pi-free).
- `src/probes.ts` — read-only environment probes (settings files, `PI_EXPERIMENTAL`,
  subscription-provider detection). Defensive: never throws, falls back to defaults, caches.
- `src/state.ts` — `createUiState()` factory for the persisted state
  (`~/.pi/agent/gruntfoot/settings.json`: `enabled` default off, plus `colors`). Lazy read,
  lockfile-guarded merge-preserving writes via `proper-lockfile` (the same pattern as pi's
  `FileSettingsStorage`); a malformed file disables persistence for the session; junk `colors`
  values are ignored per-role. `applyColors` (theme load) replaces `colors` wholesale.
  Injectable path + fs hooks keep tests pi-free.
- `test/` — one test file per module, mirroring `src/` names.

## Code conventions

- TypeScript strict, ES2023, NodeNext. Tabs for indentation. Relative imports use explicit
  `.ts` extensions.
- `verbatimModuleSyntax`: use `import type` for type-only imports. `erasableSyntaxOnly`: no enums,
  namespaces, or parameter properties.
- Prefer small pure functions with injectable dependencies (see `probes.ts` accepting settings
  contents, `command.ts`/`themes.ts` accepting plain data, `footer.ts` accepting render data) —
  this is what keeps tests runnable without pi.
- Tests use `node:test` + `node:assert/strict`. Cover new behavior with unit tests where possible;
  TUI-only behavior goes on the manual checklist in README.md.

## Design constraints

- **Render paths must never throw.** Footer/editor render on every frame; all probing and data
  access stays defensive with sensible fallbacks.
- **Compose, don't replace blindly.** Other extensions may have replaced the editor before us —
  always capture `ctx.ui.getEditorComponent()` and delegate to it. Likewise, expect to be wrapped.
- Feature tests for TUI behavior (chip, separators, toggle, pickers) come from README.md's manual
  checklist, not automated tests.

## Conversation style

- Be concise. Avoid fluff, filler, and unnecessary repetition.
- Work collaboratively. Treat me as a peer — evaluate my ideas on merit, push back politely when
  you disagree, and offer alternatives when you see a better path.
- Ask clarifying questions when the direction is ambiguous rather than running with assumptions.
- Prefer discussing approach before writing code. Small changes are fine inline; for anything
  structural, talk it through first.

## Environment

- This repository is hosted on a private Gitea instance at `gitea.zeal.home`, not GitHub. Never
  assume GitHub URLs, APIs, or conventions.
- pi API reference: `/home/victor/.config/nvm/versions/node/v24.19.0/lib/node_modules/@earendil-works/pi-coding-agent/docs`
  (especially `docs/extensions.md`) when working against extension APIs.

## Git conventions

- Never stage, commit, merge, or push unless explicitly asked. Keep all changes unstaged so I can
  review them first.
- When asked to commit, write concise, meaningful commit messages. Use imperative mood
  ("Add X" not "Added X").
- Never create branches unless asked. Running `/start` is an explicit request to branch — it creates
  the branch as part of its flow, which is expected and not an exception.
- Branch names use plain `<slug>` format derived from the task description (e.g. `add-user-auth`,
  `fix-login-timeout`). No prefixes like `feature/` or `fix/`.
- Don't force-push or rewrite history unless I explicitly request it.
