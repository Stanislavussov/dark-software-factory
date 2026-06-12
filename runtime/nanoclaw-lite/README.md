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

## Local Checks

```bash
pnpm install --frozen-lockfile
pnpm build
node dist/index.js --help
node dist/index.js
```

The final command should fail with a clear missing environment variable message unless runtime env is configured.
