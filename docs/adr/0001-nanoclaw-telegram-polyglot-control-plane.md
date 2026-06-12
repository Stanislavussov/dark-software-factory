# ADR 0001: Nanoclaw Telegram Control Plane for Polyglot

## Status

Accepted.

## Date

2026-06-11

## Context

The factory must run Nanoclaw on a VPS and use it to perform development tasks against `Stanislavussov/Polyglot`. Commands must come from Telegram. The target application has its own rules, package manager, quality gate, and skills.

## Decision

- Keep this repository as the factory/control-plane repository.
- Keep Polyglot as the application repository.
- Use Telegram as the only runtime command source.
- Allow free-form `/run <prompt>` commands only from one allowlisted Telegram chat id.
- Run at most one active task at a time.
- Use `https://github.com/Stanislavussov/Polyglot` as `TARGET_REPO`.
- Use `master` as `TARGET_BRANCH`.
- Use `TARGET_GITHUB_TOKEN` as a fine-grained GitHub PAT for clone/push.
- Give Nanoclaw only test/dev Polyglot environment through `POLYGLOT_ENV_B64`.
- Run `/run` on an autonomous branch named `autonomous/YYYYMMDD-HHMM-short-slug`.
- Commit only after implementation, quality gates, and report-only code review pass.
- Keep `/push` explicit. `/run` never pushes.
- `/push` rebases the autonomous branch on `origin/master`, reruns gates and report-only review, then pushes only the autonomous branch to GitHub.
- Do not merge into or push `master` from the runtime.
- Do not create pull requests in v1.
- Leave autonomous branches locally after successful push, but do not block new tasks.
- Bake global `superpowers` skills into the Nanoclaw image.
- Also require Nanoclaw to read Polyglot `AGENTS.md` and relevant `.pi/skills`.
- Global rules win for security/control-plane behavior.
- Polyglot rules win for application/code behavior.
- Use Node 24 for the `nanoclaw-lite` runtime image.
- Keep Node 26 out of the runtime image.
- Run Polyglot verification through a separate `polyglot-tooling` container owned by the Polyglot repository.

## Quality Gate

Run the gate as separate steps:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm lint
pnpm lint:deps
pnpm test
```

Do not run `pnpm audit` in v1.

## Consequences

- VPS setup remains generic: Docker, SSH, firewall, deploy user, and app root.
- Factory behavior is versioned and deployable through the `nanoclaw-lite` image.
- Application tooling remains versioned with Polyglot.
- The Docker socket mount still makes `nanoclaw-lite` powerful; the Telegram allowlist and explicit `/push` gate are mandatory controls.
