# Task 0001: Create the VPS Foundation for the Dark Software Factory

## Status

Done.

Completed on 2026-06-11.

## Completion Summary

Implemented a reusable Ansible VPS Foundation in `ansible/`:

- Added `ansible/run.sh` as the bootstrap entrypoint with Dark Software Factory defaults and environment-variable overrides.
- Added `ansible/site.yml` to provision SSH hardening, UFW, fail2ban, Docker Engine, Docker Compose plugin, Docker log rotation, optional swap, a deploy user, the app root, and a narrow sudoers cleanup rule.
- Added optional public routing through nginx and certbot, disabled by default through `ENABLE_PUBLIC_ROUTING=false`.
- Kept Bun and the app-specific admin seed helper disabled by default for the generic foundation.
- Added `ansible/README.md` documenting required operator inputs and run modes.
- Added `ansible/requirements.yml`, `ansible/ansible.cfg`, and `.gitignore` for generated Ansible output.
- Replaced deprecated Docker `apt-key` setup with `/etc/apt/keyrings/docker.asc`.
- Kept Ansible local temp and SSH control socket files under `ansible/.generated/` so local validation works inside the project workspace.

Validated locally with:

```bash
cd ansible
./run.sh syntax
```

Provisioned the first VPS with:

```bash
cd ansible
VPS_HOST="<vps-ip>" \
VPS_USER="root" \
VPS_SSH_KEY="$HOME/.ssh/<vps-key>" \
DEPLOY_USER_SSH_KEY="$(cat ~/.ssh/<vps-key>.pub)" \
./run.sh
```

The successful Ansible recap was:

```text
factory-vps : ok=23 changed=8 unreachable=0 failed=0 skipped=14 rescued=0 ignored=0
```

Public routing was not enabled during the first provisioning run, so nginx, certbot, and ports `80/443` were intentionally skipped.

## Context

The Dark Software Factory needs a first production-capable host before higher-level agent orchestration, verification loops, or deployment automation can be useful. The existing `../ansible-prod` project already provisions an Ubuntu VPS with SSH hardening, UFW, fail2ban, Docker, Docker Compose, optional swap, optional Bun, nginx, certbot, and a deploy user.

This task adapts that setup into the first reusable VPS foundation for the factory.

## Goal

Create a repeatable Ansible-based VPS bootstrap that can provision a fresh Ubuntu VPS into a secure Docker host for the initial Dark Software Factory services.

## Scope

- Reuse `../ansible-prod` as the starting point.
- Replace project-specific defaults such as `polyglot`, `/opt/polyglot`, and `admin.example.com` with Dark Software Factory values or documented placeholders.
- Keep the setup focused on one VPS, one deploy user, Docker workloads, and optional public routing.
- Preserve SSH hardening, firewall defaults, fail2ban, Docker installation, Docker log rotation, app directory creation, and optional swap.
- Decide whether Bun and the admin seed helper belong in the generic factory foundation or should be disabled by default.
- Document the required operator inputs before first run: host, SSH user, SSH key, deploy public key, domains, upstream ports, and ACME email.
- Add a dry-run or check command path so the operator can validate the generated inventory and Ansible syntax before touching the VPS.

## Out of Scope

- Multi-agent orchestration.
- Digital twin infrastructure.
- CI/CD deployment pipelines.
- Kubernetes or fleet management.
- Multi-VPS topology.
- Production application deployment.

## Acceptance Criteria

- A fresh Ubuntu VPS can be provisioned using the adapted Ansible entrypoint.
- The resulting host rejects password SSH login and root SSH login after provisioning.
- The deploy user can SSH into the host using the configured public key.
- Docker and the Docker Compose plugin are installed and usable by the deploy user.
- UFW allows SSH and, when public routing is enabled, only the configured public web ports.
- Docker container logs are capped using the configured rotation settings.
- The app root exists and is owned by the deploy user.
- Optional public routing can be enabled for web and API hostnames with nginx and certbot.
- The README explains the exact values that must be changed before running against a real VPS.
- The bootstrap can be syntax-checked locally without contacting the VPS.

## Implementation Notes

- Start from `../ansible-prod/README.md`, `../ansible-prod/run.sh`, `../ansible-prod/site.yml`, `../ansible-prod/ansible.cfg`, and `../ansible-prod/requirements.yml`.
- Treat the current Polyglot values as examples, not factory defaults.
- Prefer configuration names that match the project language: `PROJECT_NAME="dark-software-factory"` and `APP_ROOT="/opt/dark-software-factory"` are acceptable initial defaults if no shorter deployment name is chosen.
- Keep destructive permissions narrow. The current sudoers rule allows removing only the previous deployment directory; do not broaden it for this task.
- Do not introduce secrets into version-controlled files.

## Open Question

Should the first VPS foundation install only generic infrastructure, or should it also prepare for the first concrete factory service?

Recommended answer: keep this first task generic. Disable app-specific helpers by default, then create a separate task for the first service once its runtime shape is known.
