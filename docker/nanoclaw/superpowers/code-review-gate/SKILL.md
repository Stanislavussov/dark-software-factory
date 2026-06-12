# Nanoclaw Code Review Gate

Use this skill after the quality gate passes and before committing.

## Reviewer Contract

- Start a separate `opencode` subprocess for review.
- Review the uncommitted diff on the autonomous branch.
- Read global Nanoclaw skills, Polyglot `AGENTS.md`, and relevant Polyglot `.pi/skills`.
- Report findings only.
- Do not edit code.
- Do not commit.
- Do not push.

## Review Focus

Prioritize:

- correctness bugs;
- regressions;
- missing tests for changed behavior;
- violations of `AGENTS.md`;
- violations of relevant `.pi/skills`;
- unsafe DB migration behavior;
- dependency boundary violations;
- accidental secret exposure.

If there are findings, stop the task in `failed` state and send findings to Telegram.

If there are no findings, allow the implementation flow to commit locally.
