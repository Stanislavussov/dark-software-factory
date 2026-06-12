# Polyglot Quality Gate

Use this skill after every implementation change in the Polyglot target repository.

## Required Context

Before editing or reviewing code, read:

- `AGENTS.md`
- `.pi/skills/dev-standards/SKILL.md`
- any `.pi/skills/*/SKILL.md` relevant to the touched domain

Polyglot app-specific rules win for code behavior. Nanoclaw global rules win for security and control-plane behavior.

## Gate

Run the quality gate as separate steps, in order:

1. `pnpm install --frozen-lockfile`
2. `pnpm build`
3. `pnpm lint`
4. `pnpm lint:deps`
5. `pnpm test`

Do not run `pnpm audit` in v1.

## Fix Loop

- If a step fails, run the implementation agent with the failure log.
- Retry from the failed step and continue subsequent steps.
- Stop after `MAX_FIX_ATTEMPTS`.
- On final failure, report the failed step and log tail to Telegram.

## Tooling

Run Polyglot commands through the Polyglot tooling container, not on the VPS host and not inside the Nanoclaw runtime image.
