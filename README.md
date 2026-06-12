# Dark Software Factory

Dark Software Factory is a concept for software delivery where most implementation work happens inside automated agent systems instead of inside a human developer's editor.

The goal is not just "AI writes code". The goal is a production system that turns high-level intent into verified, deployable software changes through repeatable automation.

Humans remain responsible for:

- defining product intent;
- setting architectural and security policies;
- approving important trade-offs;
- auditing outcomes.

Agents and automation take over the repeatable delivery loop:

- decomposing work into executable tasks;
- modifying code and infrastructure;
- running tests and verification;
- fixing failures through feedback loops;
- preparing deployable changes;
- eventually deploying within explicit guardrails.

The "dark" part comes from lights-out manufacturing: the factory should be able to keep producing without a human manually touching every step. Humans operate the control room, not every workstation.

## Core Idea

A Dark Software Factory needs more than prompts. It needs a delivery environment with:

- persistent project context and vocabulary;
- task records and decision history;
- agent-readable operating instructions;
- deterministic verification gates;
- isolated execution environments;
- deployment infrastructure;
- audit trails for what changed and why.

This repository captures the language, tasks, and implementation path for building that system.

## What Comes Next

The next step is to turn the concept into concrete factory services: intent capture, task decomposition, verification, audit trails, and controlled deployment loops.

## Current Infrastructure

- `ansible/` provisions the VPS Foundation: SSH hardening, firewall, fail2ban, Docker, deploy user, app root, optional public routing, and log rotation.
- `docker/nanoclaw/` defines the `nanoclaw-lite` runtime image. It installs OpenCode and copies the local purpose-built runtime.
- `deploy/nanoclaw/` contains the production Compose bundle and environment example for the VPS.
- `.github/workflows/deploy-nanoclaw.yml` builds the image, pushes it to GHCR, uploads the Compose bundle, writes the server `.env`, and restarts the service.

See `docs/runbooks/nanoclaw-docker-deployment.md` for the deployment steps and required GitHub configuration.

The `nanoclaw-lite` runtime is Telegram-only: `/run` accepts free-form prompts from one allowlisted chat id, works on autonomous branches against `Stanislavussov/Polyglot`, runs Polyglot gates through a separate tooling container, runs report-only code review, commits locally only after clean verification, and pushes only the autonomous branch to GitHub after an explicit `/push`. GitHub merge remains manual.
