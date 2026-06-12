# Task 0004: Build Nanoclaw Lite Runtime for Telegram and OpenCode

## Status

Ready.

## Context

Task 0003 explored using the real upstream `nanocoai/nanoclaw` project as the factory runtime. Local smoke testing showed that upstream Nanoclaw is a Node/pnpm application centered on Claude Code, OneCLI, setup pairing, internal SQLite wiring, provider registry branches, and an agent-container model.

That is too much inherited behavior for the target workflow:

```text
Telegram -> OpenCode -> Polyglot branch -> gates -> review -> explicit /push
```

OpenCode is not the upstream core path. It is an optional provider skill on Nanoclaw's `providers` branch. Making upstream Nanoclaw production-ready for this use case would require a custom fork, provider installation, Telegram pairing automation, DB seeding, agent container image management, and ongoing compatibility with upstream's Claude-oriented assumptions.

The next step is to replace the upstream Nanoclaw integration with a small purpose-built runtime in this repository.

## Goal

Implement `nanoclaw-lite`: a production Docker runtime that accepts commands only from one Telegram chat, runs OpenCode against the Polyglot repository, enforces deterministic quality gates, performs report-only code review, commits locally after clean verification, and pushes only the autonomous task branch to GitHub after explicit `/push`.

## Non-Goals

- Do not fork or vendor `nanocoai/nanoclaw`.
- Do not run `bash nanoclaw.sh`.
- Do not use Claude Code or OneCLI.
- Do not implement multi-user chat, multi-repo orchestration, queues, PR creation, or arbitrary shell commands in v1.
- Do not give the runtime production Polyglot secrets.
- Do not merge into or push `TARGET_BRANCH` from the runtime.

## Architecture

```text
claw repo
  runtime/nanoclaw-lite/
    Telegram command loop
    task state machine
    git workflow
    OpenCode subprocess runner
    Polyglot gate runner
    report-only review runner
    explicit push flow

  docker/nanoclaw/
    Dockerfile for nanoclaw-lite
    entrypoint
    global superpowers

  deploy/nanoclaw/
    compose.yml
    env.example

Polyglot repo
  deploy/nanoclaw-tooling/
    Node 26 + pnpm tooling container
```

Runtime flow:

```text
Telegram /run <prompt>
  -> validate TELEGRAM_ALLOWED_CHAT_ID
  -> ensure no active/pending task
  -> clone or update TARGET_REPO
  -> checkout TARGET_BRANCH
  -> pull --ff-only
  -> create autonomous/YYYYMMDD-HHMM-short-slug
  -> run opencode implementation prompt
  -> run gates through Polyglot tooling container
  -> auto-fix failed gates up to MAX_FIX_ATTEMPTS
  -> run report-only OpenCode review
  -> if clean, commit locally
  -> report ready_for_push to Telegram

Telegram /push
  -> fetch origin
  -> rebase autonomous branch on origin/TARGET_BRANCH
  -> rerun full gate
  -> rerun report-only OpenCode review
  -> push autonomous branch to GitHub
  -> send branch and compare URLs
  -> mark task pushed
```

## Required Commands

- `/help`: show supported commands.
- `/status`: show runtime state, branch, task id, last gate, and next action.
- `/run <prompt>`: start a new free-form task when idle.
- `/fix [extra instructions]`: retry the current failed task using the latest gate/review/rebase failure context and optional operator instructions.
- `/logs`: send summary plus last `LOG_TAIL_LINES` lines.
- `/discard`: request confirmation before discarding current pending work.
- `/discard confirm`: discard current pending work and return to idle.
- `/archive`: keep the current branch locally but unblock new work.
- `/cancel`: stop a running task if possible and keep logs.
- `/push`: rebase the ready autonomous branch, rerun gates and review, then push only the autonomous branch to GitHub.

## State Machine

```text
idle
  /run -> running

running
  gates/review fail -> failed
  gates/review pass -> ready_for_push
  /cancel -> failed

failed
  /fix -> running
  /discard -> idle
  /archive -> idle

ready_for_push
  /push success -> pushed
  /discard -> idle
  /archive -> idle

pushed
  -> idle
```

Rules:

- One active or pending task at a time.
- Pending `failed` or `ready_for_push` blocks new `/run`.
- `pushed` does not block new `/run`, even though the autonomous branch remains locally.
- `/run` never pushes.
- Commit happens only after gates and report-only review pass.
- `pushed` means the autonomous branch was pushed to GitHub for manual review/merge outside the runtime.
- Archived tasks are final in v1. There is no `/resume`.

## Environment Contract

Required:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_ALLOWED_CHAT_ID
TARGET_REPO=https://github.com/Stanislavussov/Polyglot
TARGET_BRANCH=master
TARGET_GITHUB_TOKEN
OPENCODE_API_KEY
OPENCODE_GO_API_BASE=http://oc-go-cc:3456/v1
```

Optional:

```text
POLYGLOT_ENV_B64
MAX_FIX_ATTEMPTS=3
LOG_TAIL_LINES=80
CANCEL_GRACE_MS=10000
GIT_TIMEOUT_MS=120000
OPENCODE_TIMEOUT_MS=3600000
REVIEW_TIMEOUT_MS=1800000
GATE_TIMEOUT_MS=1200000
WORKSPACE_DIR=/workspace
DATA_DIR=/data
LOGS_DIR=/logs
TOOLING_COMPOSE_FILE=deploy/nanoclaw-tooling/compose.yml
TOOLING_SERVICE=polyglot-tooling
OPENCODE_COMMAND=opencode
OPENCODE_RUN_ARGS=
OPENCODE_REVIEW_ARGS=
VERIFY_INSTALL=pnpm install --frozen-lockfile
VERIFY_BUILD=pnpm build
VERIFY_LINT=pnpm lint
VERIFY_DEPS=pnpm lint:deps
VERIFY_TEST=pnpm test
```

All runtime configuration must be parsed, defaulted, and validated in one central config module. Other modules receive a typed `RuntimeConfig`; they must not read `process.env` directly. The gate commands remain separate env vars for simple deployment, but the config module exposes them as an ordered array:

```text
install -> build -> lint -> deps -> test
```

Task state must store a non-secret snapshot of relevant config values, including target repo, target branch, ordered gate ids/commands, and OpenCode command mode.

## Quality Gate

Run as separate steps:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm lint
pnpm lint:deps
pnpm test
```

Do not run `pnpm audit` in v1.

Each failed gate triggers an OpenCode fix attempt, up to `MAX_FIX_ATTEMPTS`. Retry from the failed gate and continue subsequent gates.

Run Polyglot commands through Docker Compose from the target repo root:

```bash
docker compose -f "$TOOLING_COMPOSE_FILE" run --rm "$TOOLING_SERVICE" sh -lc "<configured gate command>"
```

If `POLYGLOT_ENV_B64` is set, decode it to `/workspace/Polyglot/.env.nanoclaw` with mode `0600` and pass it to Docker Compose as an env file. Do not create or overwrite `/workspace/Polyglot/.env`.

## Review Gate

After quality gates pass, run a separate OpenCode subprocess in report-only mode.

Review input must include:

- current git diff;
- global superpowers from `docker/nanoclaw/superpowers/`;
- Polyglot `AGENTS.md`;
- relevant Polyglot `.pi/skills`.

Review output:

- if findings exist, send findings to Telegram and mark task `failed`;
- if clean, commit locally with `auto: <short summary>` and mark `ready_for_push`.

The review subprocess must not edit files, commit, or push.

The review subprocess must emit a strict machine-readable result between markers:

```text
NANOCLAW_REVIEW_RESULT_BEGIN
{
  "status": "clean",
  "summary": "short text",
  "findings": []
}
NANOCLAW_REVIEW_RESULT_END
```

`status` is either `clean` or `findings`. Findings must include severity, file, optional line, message, and recommendation. Missing or invalid review JSON is a failed review, not a clean review.

## OpenCode Runner

All OpenCode CLI details must be isolated behind one `OpenCodeRunner` module.

- Pass prompts through stdin or temporary files, never through shell interpolation.
- Capture stdout/stderr to the task log.
- Treat exit code `0` as subprocess success.
- Parse review success only from the strict review JSON contract.
- Keep `OPENCODE_COMMAND`, `OPENCODE_RUN_ARGS`, and `OPENCODE_REVIEW_ARGS` configurable until the installed CLI flags are verified.

## Git Rules

- Clone target repo into `/workspace/Polyglot`.
- Authenticate with `TARGET_GITHUB_TOKEN` through a scoped `GIT_ASKPASS` helper or equivalent credential helper. Never persist the token in `.git/config`, command logs, task state, or Telegram output.
- Base tasks on `TARGET_BRANCH`.
- Branch format: `autonomous/YYYYMMDD-HHMM-short-slug`.
- Commit format: `auto: <short task summary>`.
- `/push` fetches origin, rebases the autonomous branch on `origin/TARGET_BRANCH`, reruns gates and review, then pushes only the autonomous branch to GitHub.
- `/push` must use a guarded refspec equivalent to `HEAD:refs/heads/autonomous/<task-branch>`.
- Runtime code must reject any push target outside `refs/heads/autonomous/*`.
- Runtime code must reject force push, `--mirror`, `--all`, and arbitrary refspecs.
- Never force-push.
- Leave autonomous branches locally after successful push.
- Do not create PRs in v1. Send branch and compare URLs to Telegram after successful `/push`.

`TARGET_GITHUB_TOKEN` should be a fine-grained PAT scoped only to `Stanislavussov/Polyglot` with `Contents: Read and write`. It should not need Pull requests, Actions, Administration, Secrets, or Issues permissions in v1.

## Command Semantics

`/fix`:

- allowed only in `failed`;
- continues on the same autonomous branch and current worktree;
- accepts optional extra operator instructions;
- for failed gates, includes failed command, exit code, log context, and current diff;
- for failed review, includes structured findings and current diff;
- for failed rebase, resolves the current conflicted rebase rather than aborting it;
- after failed review or rebase fix, reruns the full gate and review.

`/cancel`:

- allowed during `/run` and `/fix` execution;
- sends `SIGTERM`, waits `CANCEL_GRACE_MS`, then sends `SIGKILL`;
- moves the task to `failed` with the current branch and logs preserved;
- is rejected during `/push` because interrupting publication/rebase is unsafe in v1.

`/discard`:

- requires `/discard confirm` within a short confirmation window;
- deletes the current local autonomous branch/worktree changes for `failed` or `ready_for_push` tasks;
- preserves task JSON and logs;
- never deletes remote branches.

`/archive`:

- finalizes the current `failed` or `ready_for_push` task as archived;
- leaves the local autonomous branch in the same Git repository;
- clears the active pointer and unblocks new `/run`;
- cannot be resumed through Telegram in v1.

## Persistence

Persist runtime state outside the container:

```text
/data/state.json
/data/tasks/<task-id>.json
/logs/tasks/<task-id>.log
/workspace/Polyglot
```

`/data/state.json` is the atomic runtime pointer file. Task JSON files are the source of truth for task details; `state.json` is the source of truth for the active/blocking task pointer and recent task ids.

Task state must include:

- task id;
- prompt;
- status;
- branch;
- base branch;
- commit hash if committed;
- pushed commit hash if pushed;
- remote branch and compare URL if pushed;
- timestamps;
- last failed gate;
- latest failure/review summary;
- latest manual fix note if `/fix <extra instructions>` was used;
- log path.

Writes to state files must be atomic: write a temporary file and rename it into place.

Startup recovery:

- if a previous task was `running`, mark it `failed` with `crashed_or_interrupted`;
- if `state.json` points to a final task (`pushed`, `discarded`, `archived`), clear the active pointer;
- if the repo has dirty/untracked changes while no active task exists, enter a runtime-level recovery lock, reject new `/run`, and require `/discard confirm` or manual recovery.

## Docker Changes

Replace upstream Nanoclaw image behavior with `nanoclaw-lite`:

- remove `git clone nanocoai/nanoclaw` from `docker/nanoclaw/Dockerfile`;
- use Node 24 for the `nanoclaw-lite` daemon;
- install OpenCode CLI from `https://opencode.ai/install`;
- install Docker CLI and git;
- copy `runtime/nanoclaw-lite/`;
- copy global superpowers;
- set `CMD` to start the Telegram daemon.

Keep `oc-go-cc` in `deploy/nanoclaw/compose.yml`.

Keep `/var/run/docker.sock` mounted so gates can run the Polyglot tooling container.

## Local Smoke Tests

1. Build image:

```bash
docker build -f docker/nanoclaw/Dockerfile -t nanoclaw-lite:test .
```

2. Check CLI/help:

```bash
docker run --rm nanoclaw-lite:test --help
docker run --rm nanoclaw-lite:test opencode --help
```

3. Check config validation:

```bash
docker run --rm nanoclaw-lite:test
```

Expected: fails with a clear missing env message.

4. Check daemon starts with dummy env and Docker socket:

```bash
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e TELEGRAM_BOT_TOKEN=test \
  -e TELEGRAM_ALLOWED_CHAT_ID=1 \
  -e TARGET_REPO=https://github.com/Stanislavussov/Polyglot \
  -e TARGET_BRANCH=master \
  -e TARGET_GITHUB_TOKEN=test \
  -e OPENCODE_API_KEY=test \
  -e OPENCODE_GO_API_BASE=http://127.0.0.1:3456/v1 \
  nanoclaw-lite:test
```

Expected: starts or fails only because Telegram token is fake, with a clear error.

## Acceptance Criteria

- No upstream `nanocoai/nanoclaw` source is cloned or required at build time.
- Docker image builds locally.
- Runtime starts as a Telegram bot daemon.
- Unknown Telegram chat ids are ignored and logged.
- Allowed chat id can run `/help` and `/status`.
- `/run <prompt>` creates an autonomous branch in Polyglot and invokes OpenCode.
- Gates run through the Polyglot tooling container.
- Failed gates trigger bounded OpenCode fix attempts.
- Clean gates trigger report-only review.
- Clean review creates a local commit and marks the task `ready_for_push`.
- `/push` rebases on `origin/TARGET_BRANCH`, reruns gates and review, pushes only the autonomous branch, and sends branch/compare URLs.
- Runtime never pushes or merges `TARGET_BRANCH`.
- Runtime never creates PRs in v1.
- Full logs persist under `/logs/tasks`.
- Telegram receives concise summaries plus log tails, not full logs.
- No secrets are committed to the repository.
- GitHub token is never written to `.git/config`, task state, logs, or Telegram output.

## Implementation Order

1. Scaffold `runtime/nanoclaw-lite` with TypeScript package and entrypoint.
2. Implement config validation and structured logger.
3. Implement persistent task state.
4. Implement Telegram bot polling and allowlist.
5. Implement `/help`, `/status`, and `/logs`.
6. Implement target repo clone/update and branch creation.
7. Implement OpenCode implementation runner.
8. Implement Polyglot gate runner through Docker Compose.
9. Implement bounded fix loop.
10. Implement report-only review runner.
11. Implement commit, rebase-before-push, guarded autonomous branch push, and branch/compare URLs.
12. Replace Dockerfile upstream Nanoclaw build with `nanoclaw-lite`.
13. Update compose/env/runbook.
14. Run local Docker smoke tests.

## Open Risks

- OpenCode non-interactive prompt flags need to be verified against the installed CLI.
- The exact `OPENCODE_GO_API_BASE`/provider configuration may require an OpenCode config file in addition to env vars.
- Polyglot gates may need test/dev env from `POLYGLOT_ENV_B64`.
- Docker socket access makes the runtime highly privileged; keep Telegram allowlist strict.
