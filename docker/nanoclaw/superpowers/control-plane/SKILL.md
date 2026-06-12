# Nanoclaw Control Plane

Use this skill for every Telegram command handled by the Nanoclaw runtime.

## Hard Rules

- Telegram is the only runtime command source.
- Accept commands only from `TELEGRAM_ALLOWED_CHAT_ID`.
- Ignore and log every command from any other chat id.
- Run at most one active task at a time.
- Never push to the target repository during `/run`.
- Never use production application secrets.
- Keep full task logs under `/logs/tasks`.

## Supported Commands

- `/status`: report current state, branch, task id, last gate, and pending action.
- `/run <prompt>`: start one free-form implementation task.
- `/fix`: continue the current failed task using the latest failure or review findings.
- `/push`: rebase the ready autonomous branch on `origin/TARGET_BRANCH`, rerun gates and review, then push only the autonomous branch to GitHub.
- `/discard`: discard the current pending branch/worktree.
- `/archive`: stop blocking new work while leaving the branch locally.
- `/logs`: return a summary and tail of the current task log.
- `/cancel`: cancel the running task and keep logs.
- `/help`: list commands.

## State Rules

- `idle` accepts `/run`.
- `running` rejects new `/run`.
- `failed` rejects new `/run` and accepts `/fix`, `/discard`, `/archive`, `/logs`.
- `ready_for_push` rejects new `/run` and accepts `/push`, `/discard`, `/archive`, `/logs`.
- `pushed` means the autonomous branch was pushed to GitHub for manual review/merge outside the runtime.
- `pushed` does not block new `/run`, even if the local autonomous branch remains.

## Telegram Output

- On success, send a short summary with task id, branch, commit hash when available, branch/compare URLs when pushed, and next action.
- On failure, send failed stage, attempt number, short diagnosis, and the last `LOG_TAIL_LINES` log lines.
- Never send full logs to Telegram when they are large.
