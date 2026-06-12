# Nanoclaw Git Workflow

Use this skill for every target repository task.

## Target

- Clone or update only `TARGET_REPO`.
- Base all tasks on `TARGET_BRANCH`.
- Use `TARGET_GITHUB_TOKEN` for authenticated clone, push, and API operations.

## Branching

- `/run` must start from a clean `TARGET_BRANCH`.
- Before creating a task branch:
  - fetch origin;
  - checkout `TARGET_BRANCH`;
  - pull with `--ff-only`.
- Create task branches as `autonomous/YYYYMMDD-HHMM-short-slug`.
- Keep `TARGET_BRANCH` clean until `/push`.

## Commit Policy

- Do not commit until implementation, quality gates, and review all pass.
- Commit message format: `auto: <short task summary>`.
- If gates or review fail, leave changes uncommitted on the autonomous branch.

## Push Policy

`/push` must:

- fetch origin;
- checkout the autonomous branch;
- rebase it on `origin/TARGET_BRANCH`;
- run the full quality gate again;
- run report-only review again;
- push only the autonomous branch to GitHub with a guarded `refs/heads/autonomous/*` refspec;
- send branch and compare URLs to Telegram;
- leave the autonomous branch locally after successful push.

Never force-push.
Never push or merge `TARGET_BRANCH`.
Never create pull requests in v1.
