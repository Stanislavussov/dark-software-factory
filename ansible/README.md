# Dark Software Factory VPS Foundation

Repeatable Ansible bootstrap for turning a fresh Ubuntu VPS into the first production-capable Docker host for the Dark Software Factory.

## What It Does

- Installs UFW, fail2ban, Docker Engine, and the Docker Compose plugin.
- Optionally creates and tunes swap for small VPS instances.
- Configures Docker container log rotation.
- Hardens SSH by disabling root login, password authentication, empty passwords, and limiting authentication attempts.
- Creates a deploy user with SSH key access and Docker group membership.
- Creates the app root owned by the deploy user.
- Allows the deploy user to remove only the previous deployment directory through a narrow sudoers rule.
- Optionally installs nginx, certbot, and public web/API reverse proxies.
- Optionally installs Bun when a concrete service needs it.
- Leaves app-specific seed helpers disabled by default.

## Required Operator Inputs

Set these as environment variables before running against a real VPS, or edit `run.sh` locally and keep secrets out of git:

- `VPS_HOST`: public IP or hostname of the fresh Ubuntu VPS.
- `VPS_USER`: initial SSH user, commonly `root` on a new VPS.
- `VPS_SSH_KEY`: private SSH key path for `VPS_USER`.
- `VPS_SSH_PORT`: SSH port, default `22`.
- `DEPLOY_USER_SSH_KEY`: public key text authorized for the created deploy user. If empty, `run.sh` tries `${VPS_SSH_KEY}.pub`.
- `DEPLOY_USER`: deploy account to create, default `deploy`.
- `APP_ROOT`: application root on the VPS, default `/opt/dark-software-factory`.
- `APP_OLD_ROOT`: previous deployment directory that the deploy user may remove, default `/opt/dark-software-factory_old`.
- `DOCKER_LOG_MAX_SIZE`: Docker JSON log max size, default `10m`.
- `DOCKER_LOG_MAX_FILE`: Docker JSON log file count, default `3`.

For optional public routing, set:

- `ENABLE_PUBLIC_ROUTING=true`.
- `WEB_DOMAIN`: public hostname for the web service.
- `WEB_UPSTREAM_PORT`: localhost port for the web service.
- `API_DOMAIN`: public hostname for the API service.
- `API_UPSTREAM_PORT`: localhost port for the API service.
- `PUBLIC_FIREWALL_PORTS`: comma-separated public web ports, default `80,443`.
- `ACME_EMAIL`: email passed to certbot.

DNS for `WEB_DOMAIN` and `API_DOMAIN` must already point at the VPS before enabling automatic TLS.

## Optional Inputs

- `ENABLE_SWAP`: default `true`.
- `SWAP_SIZE`: default `2G`.
- `INSTALL_BUN`: default `false`.
- `INSTALL_SEED_HELPER`: default `false`.

Bun and the seed helper are intentionally disabled for the generic VPS Foundation. Enable them only when the first concrete factory service requires those capabilities.

## Install Requirements

Install the required Ansible collections once:

```bash
ansible-galaxy collection install -r requirements.yml
```

## Local Validation

Generate the inventory and syntax-check the playbook without contacting the VPS:

```bash
./run.sh syntax
```

This mode permits placeholder connection values and a missing private key so operators can validate local Ansible structure before touching a server.

## Provision

After replacing the required values:

```bash
./run.sh
```

If the initial SSH user needs a sudo password:

```bash
./run.sh -K
```

To ask Ansible for a dry run against the VPS:

```bash
./run.sh check
```
