# Nanoclaw Lite Runtime

This directory contains the purpose-built Telegram and OpenCode runtime described in `docs/tasks/0004-build-nanoclaw-lite-runtime.md`.

The runtime replaces the old upstream `nanocoai/nanoclaw` integration. It must not depend on upstream Nanoclaw setup, pairing, provider branches, Claude Code, OneCLI, or agent-container bootstrapping.

## Shape

- `src/config.ts` is the only runtime config boundary. It parses, defaults, validates, and exposes ordered gates.
- `src/state.ts` persists `/data/state.json` and `/data/tasks/*.json` with atomic writes.
- `src/telegram.ts` polls Telegram and ignores chats outside `TELEGRAM_ALLOWED_CHAT_ID`.
- `src/git.ts` owns clone/update/branch/commit/rebase/push behavior and guarded autonomous branch pushes.
- `src/gates.ts` runs configured Polyglot gates through Docker Compose.
- `src/opencode.ts` isolates OpenCode subprocess details and strict review JSON parsing.
- `src/orchestrator.ts` implements the task state machine and Telegram commands.

The package has no third-party runtime dependencies. `pnpm build` emits `src/*.ts` to `dist/*.js` with TypeScript, then syntax-checks the generated JavaScript.

## Telegram Commands

- `/status`, `/tasks`, `/logs [active|latest|task-id] [lines]`, and `/inspect` are read-only control-plane commands. They do not start OpenCode, create branches, or run gates.
- `/run <prompt>` is only for implementation work. It may create an autonomous branch, edit the target repository, and run the configured install/build/lint/deps/test gates.
- Use `/fix`, `/discard`, `/archive`, `/cancel`, and `/push` to move an active task through the state machine after `/run`.

## Gate And Tooling Notes

- Tooling/runtime failures such as missing `node_modules`, `tsc: not found`, missing `pnpm`, missing `/workspace/package.json`, or Biome missing its ignore file are classified as `infra_gate` and stop without an OpenCode fix attempt.
- Ordinary task and fix prompts tell OpenCode not to edit `deploy/nanoclaw-tooling/**`, `.dockerignore`, or `pnpm-lock.yaml` unless the original operator prompt is explicitly about tooling or deployment.
- Polyglot tooling should bind-mount the repository into `/workspace`; the tooling image should provide shell/git/pnpm, not copy the repo into the image.
- `pnpm` warnings about ignored build scripts such as `esbuild`, `sharp`, or `vue-demi` are warnings, not gate failures. Missing `node_modules` after the install gate usually means a tooling mount problem, not an application-code issue.

## Local Checks

```bash
pnpm install --frozen-lockfile
pnpm check
node dist/index.js --help
node dist/index.js
```

The final command should fail with a clear missing environment variable message unless runtime env is configured.
