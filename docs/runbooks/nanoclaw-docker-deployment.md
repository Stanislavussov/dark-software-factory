# Nanoclaw Docker Deployment Runbook

This runbook turns `nanoclaw-lite` into a Docker image deployed to the VPS Foundation by GitHub Actions.

## Production Contract

`nanoclaw-lite` is local code in this repository. The Docker build must not clone or vendor upstream `nanocoai/nanoclaw`.

Required OpenCode installer:

```text
OPENCODE_INSTALL_URL=https://opencode.ai/install
```

The runtime uses Node 24. Polyglot verification still runs through the separate Polyglot-owned tooling container, not inside the runtime image.

## GitHub Configuration

Create these GitHub Actions secrets:

- `VPS_HOST`
- `VPS_USER`
- `VPS_SSH_PRIVATE_KEY`
- `VPS_SSH_PORT`, optional, defaults to `22`
- `OC_GO_CC_API_KEY`
- `OPENCODE_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ALLOWED_CHAT_ID`
- `TARGET_GITHUB_TOKEN`, fine-grained PAT scoped to `Stanislavussov/Polyglot`
- `POLYGLOT_ENV_B64`, optional base64-encoded test/dev `.env`
- `GHCR_READ_TOKEN`, optional for public packages, required for private GHCR packages

Create these GitHub Actions variables:

- `GHCR_USERNAME`, optional, defaults to the workflow actor
- `OPENCODE_INSTALL_URL`, set to `https://opencode.ai/install`
- `VPS_APP_ROOT`, optional, defaults to `/opt/dark-software-factory`
- `OC_GO_CC_IMAGE`, optional, defaults to `samueltuyizere/oc-go-cc:latest`
- `OC_GO_CC_PORT`, optional, defaults to `3456`
- `TARGET_REPO`, optional, defaults to `https://github.com/Stanislavussov/Polyglot`
- `TARGET_BRANCH`, optional, defaults to `master`
- `MAX_FIX_ATTEMPTS`, optional, defaults to `3`
- `LOG_TAIL_LINES`, optional, defaults to `80`
- `CANCEL_GRACE_MS`, optional, defaults to `10000`
- `GIT_TIMEOUT_MS`, optional, defaults to `120000`
- `OPENCODE_TIMEOUT_MS`, optional, defaults to `3600000`
- `REVIEW_TIMEOUT_MS`, optional, defaults to `1800000`
- `GATE_TIMEOUT_MS`, optional, defaults to `1200000`
- `OPENCODE_COMMAND`, optional, defaults to `opencode`
- `OPENCODE_RUN_ARGS`, optional
- `OPENCODE_REVIEW_ARGS`, optional
- `TOOLING_COMPOSE_FILE`, optional, defaults to `deploy/nanoclaw-tooling/compose.yml`
- `TOOLING_SERVICE`, optional, defaults to `polyglot-tooling`

## VPS Prerequisites

Provision the server with the VPS Foundation first:

```bash
cd ansible
./run.sh
```

The deploy user must be able to run Docker. The app root must be writable by that deploy user.

## Deployment

Push to `main` after changing files under `docker/nanoclaw/`, `deploy/nanoclaw/`, or `.github/workflows/deploy-nanoclaw.yml`, or run the workflow manually.

The workflow:

- builds `docker/nanoclaw/Dockerfile`;
- pushes `ghcr.io/<owner>/<repo>/nanoclaw:<sha>` and `latest`;
- uploads `deploy/nanoclaw/compose.yml` to the VPS;
- writes the server-side `.env` from GitHub secrets;
- runs `docker compose pull && docker compose up -d --remove-orphans`.

## Runtime Contract

`nanoclaw-lite` accepts runtime commands only from Telegram and only from `TELEGRAM_ALLOWED_CHAT_ID`.

Supported v1 commands:

- `/status`
- `/run <prompt>`
- `/fix`
- `/push`
- `/discard`
- `/archive`
- `/logs`
- `/cancel`
- `/help`

`/run` creates an autonomous branch, runs implementation, runs the Polyglot quality gate through the Polyglot tooling container, runs a report-only code review agent, and commits locally only after a clean review.

`/push` fetches origin, rebases the autonomous branch on `origin/TARGET_BRANCH`, reruns the full quality gate and report-only review, pushes only the autonomous branch to GitHub, and returns branch/compare URLs. The runtime does not push or merge `TARGET_BRANCH`, and it does not create pull requests in v1.

## Polyglot Tooling Requirement

The Polyglot repository must provide the tooling compose file referenced by `TOOLING_COMPOSE_FILE`, default:

```text
deploy/nanoclaw-tooling/compose.yml
```

The compose file exposes a `polyglot-tooling` service with Node 26 and pnpm 10.14.0. `nanoclaw-lite` runs commands through that service rather than installing Polyglot tooling on the VPS host or inside the runtime image.

## Local Smoke Test

After building the image locally, start the daemon with Docker socket access:

```bash
docker build -f docker/nanoclaw/Dockerfile -t nanoclaw-lite:test .
```

```bash
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e OPENCODE_API_KEY=test \
  -e OPENCODE_GO_API_BASE=http://127.0.0.1:3456/v1 \
  -e TARGET_REPO=https://github.com/Stanislavussov/Polyglot \
  -e TARGET_BRANCH=master \
  -e TARGET_GITHUB_TOKEN=test \
  -e TELEGRAM_ALLOWED_CHAT_ID=1 \
  -e TELEGRAM_BOT_TOKEN=test \
  nanoclaw-lite:test
```

Without the socket mount, gates cannot run through the Polyglot tooling container.

## Manual Recovery

SSH into the VPS as the deploy user:

```bash
cd /opt/dark-software-factory/nanoclaw
docker compose ps
docker compose logs --tail=100 nanoclaw
docker compose logs --tail=100 oc-go-cc
docker compose pull
docker compose up -d --remove-orphans
```

## Security Notes

- Keep `.env` only on the VPS. Do not commit it.
- The `nanoclaw-lite` container mounts `/var/run/docker.sock` so it can run Docker-based verification. Treat the container as highly privileged.
- Keep the proxy bound to `127.0.0.1` unless there is a specific reason to expose it publicly.
- Use only test/dev Polyglot environment values in `POLYGLOT_ENV_B64`.
