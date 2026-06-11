#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GENERATED_DIR="${ROOT_DIR}/.generated"
INVENTORY_DIR="${GENERATED_DIR}/inventory"
INVENTORY_FILE="${INVENTORY_DIR}/hosts.yml"

# Project identity.
PROJECT_NAME="${PROJECT_NAME:-dark-software-factory}"
ANSIBLE_TARGET_GROUP="${ANSIBLE_TARGET_GROUP:-factory_vps}"
ANSIBLE_HOST_ALIAS="${ANSIBLE_HOST_ALIAS:-factory-vps}"

# VPS connection values. Replace these before provisioning a real host.
VPS_HOST="${VPS_HOST:-203.0.113.10}"
VPS_USER="${VPS_USER:-root}"
VPS_SSH_KEY="${VPS_SSH_KEY:-${HOME}/.ssh/factory_vps_root}"
VPS_SSH_PORT="${VPS_SSH_PORT:-22}"

# User created by Ansible for deployments.
DEPLOY_USER="${DEPLOY_USER:-deploy}"
DEPLOY_USER_SSH_KEY="${DEPLOY_USER_SSH_KEY:-}"

# App filesystem layout on the VPS.
APP_ROOT="${APP_ROOT:-/opt/dark-software-factory}"
APP_OLD_ROOT="${APP_OLD_ROOT:-/opt/dark-software-factory_old}"
SUDOERS_FILE_NAME="${SUDOERS_FILE_NAME:-deploy-user-dark-software-factory}"

# Docker apt repository architecture for the VPS.
DOCKER_APT_ARCH="${DOCKER_APT_ARCH:-amd64}"
DOCKER_LOG_MAX_SIZE="${DOCKER_LOG_MAX_SIZE:-10m}"
DOCKER_LOG_MAX_FILE="${DOCKER_LOG_MAX_FILE:-3}"

# Optional runtime tooling. Keep disabled until a concrete service needs it.
INSTALL_BUN="${INSTALL_BUN:-false}"
BUN_INSTALL_DIR="${BUN_INSTALL_DIR:-/opt/bun}"

# Swap helps small VPS instances survive memory spikes from builds and agents.
ENABLE_SWAP="${ENABLE_SWAP:-true}"
SWAP_FILE_PATH="${SWAP_FILE_PATH:-/swapfile}"
SWAP_SIZE="${SWAP_SIZE:-2G}"
SWAP_SWAPPINESS="${SWAP_SWAPPINESS:-10}"
SWAP_VFS_CACHE_PRESSURE="${SWAP_VFS_CACHE_PRESSURE:-50}"

# Optional public routing. Set ENABLE_PUBLIC_ROUTING=true after DNS is ready.
ENABLE_PUBLIC_ROUTING="${ENABLE_PUBLIC_ROUTING:-false}"
PUBLIC_FIREWALL_PORTS="${PUBLIC_FIREWALL_PORTS:-80,443}"
WEB_DOMAIN="${WEB_DOMAIN:-}"
WEB_UPSTREAM_PORT="${WEB_UPSTREAM_PORT:-4321}"
API_DOMAIN="${API_DOMAIN:-}"
API_UPSTREAM_PORT="${API_UPSTREAM_PORT:-3001}"
NGINX_SITE_NAME="${NGINX_SITE_NAME:-dark-software-factory}"
ACME_EMAIL="${ACME_EMAIL:-}"

# Optional app-specific helper. Disabled for the generic VPS Foundation.
INSTALL_SEED_HELPER="${INSTALL_SEED_HELPER:-false}"
SEED_HELPER_NAME="${SEED_HELPER_NAME:-}"
SEED_COMPOSE_SERVICE="${SEED_COMPOSE_SERVICE:-}"
SEED_NODE_SCRIPT="${SEED_NODE_SCRIPT:-}"

expand_path() {
  local path="$1"

  case "${path}" in
    "~") printf '%s\n' "${HOME}" ;;
    "~/"*) printf '%s/%s\n' "${HOME}" "${path#"~/"}" ;;
    *) printf '%s\n' "${path}" ;;
  esac
}

require_value() {
  local name="$1"
  local value="$2"

  if [[ -z "${value}" ]]; then
    echo "Missing required config value: ${name}" >&2
    exit 1
  fi
}

is_enabled() {
  local value="$1"
  local normalized

  normalized="$(printf '%s' "${value}" | tr '[:upper:]' '[:lower:]')"

  case "${normalized}" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

mode="run"
ansible_args=()

for arg in "$@"; do
  case "${arg}" in
    syntax|--syntax-check)
      mode="syntax"
      ;;
    check)
      mode="check"
      ;;
    *)
      ansible_args+=("${arg}")
      ;;
  esac
done

VPS_SSH_KEY="$(expand_path "${VPS_SSH_KEY}")"

require_value PROJECT_NAME "${PROJECT_NAME}"
require_value ANSIBLE_TARGET_GROUP "${ANSIBLE_TARGET_GROUP}"
require_value ANSIBLE_HOST_ALIAS "${ANSIBLE_HOST_ALIAS}"
require_value VPS_HOST "${VPS_HOST}"
require_value VPS_USER "${VPS_USER}"
require_value VPS_SSH_KEY "${VPS_SSH_KEY}"
require_value VPS_SSH_PORT "${VPS_SSH_PORT}"
require_value DEPLOY_USER "${DEPLOY_USER}"
require_value APP_ROOT "${APP_ROOT}"
require_value APP_OLD_ROOT "${APP_OLD_ROOT}"
require_value SUDOERS_FILE_NAME "${SUDOERS_FILE_NAME}"
require_value DOCKER_LOG_MAX_SIZE "${DOCKER_LOG_MAX_SIZE}"
require_value DOCKER_LOG_MAX_FILE "${DOCKER_LOG_MAX_FILE}"

if is_enabled "${INSTALL_BUN}"; then
  require_value BUN_INSTALL_DIR "${BUN_INSTALL_DIR}"
fi

if is_enabled "${ENABLE_SWAP}"; then
  require_value SWAP_FILE_PATH "${SWAP_FILE_PATH}"
  require_value SWAP_SIZE "${SWAP_SIZE}"
  require_value SWAP_SWAPPINESS "${SWAP_SWAPPINESS}"
  require_value SWAP_VFS_CACHE_PRESSURE "${SWAP_VFS_CACHE_PRESSURE}"
fi

if [[ "${mode}" != "syntax" && ! -f "${VPS_SSH_KEY}" ]]; then
  echo "VPS_SSH_KEY points to a missing file: ${VPS_SSH_KEY}" >&2
  exit 1
fi

if [[ -z "${DEPLOY_USER_SSH_KEY}" && -f "${VPS_SSH_KEY}.pub" ]]; then
  DEPLOY_USER_SSH_KEY="$(<"${VPS_SSH_KEY}.pub")"
fi

if [[ "${mode}" != "syntax" && -z "${DEPLOY_USER_SSH_KEY}" ]]; then
  echo "DEPLOY_USER_SSH_KEY is empty and ${VPS_SSH_KEY}.pub was not found." >&2
  echo "Set DEPLOY_USER_SSH_KEY or create the matching public key file." >&2
  exit 1
fi

if is_enabled "${ENABLE_PUBLIC_ROUTING}"; then
  require_value WEB_DOMAIN "${WEB_DOMAIN}"
  require_value WEB_UPSTREAM_PORT "${WEB_UPSTREAM_PORT}"
  require_value API_DOMAIN "${API_DOMAIN}"
  require_value API_UPSTREAM_PORT "${API_UPSTREAM_PORT}"
  require_value NGINX_SITE_NAME "${NGINX_SITE_NAME}"
  require_value PUBLIC_FIREWALL_PORTS "${PUBLIC_FIREWALL_PORTS}"
  require_value ACME_EMAIL "${ACME_EMAIL}"
fi

if is_enabled "${INSTALL_SEED_HELPER}"; then
  require_value SEED_HELPER_NAME "${SEED_HELPER_NAME}"
  require_value SEED_COMPOSE_SERVICE "${SEED_COMPOSE_SERVICE}"
  require_value SEED_NODE_SCRIPT "${SEED_NODE_SCRIPT}"
fi

mkdir -p "${INVENTORY_DIR}"
printf '%s\n' \
  '---' \
  "${ANSIBLE_TARGET_GROUP}:" \
  '  hosts:' \
  "    ${ANSIBLE_HOST_ALIAS}:" \
  "      ansible_host: ${VPS_HOST}" \
  "      ansible_user: ${VPS_USER}" \
  "      ansible_ssh_private_key_file: ${VPS_SSH_KEY}" \
  "      ansible_port: ${VPS_SSH_PORT}" \
  >"${INVENTORY_FILE}"

export PROJECT_NAME
export ANSIBLE_TARGET_GROUP
export DEPLOY_USER
export DEPLOY_USER_SSH_KEY
export APP_ROOT
export APP_OLD_ROOT
export SUDOERS_FILE_NAME
export DOCKER_APT_ARCH
export DOCKER_LOG_MAX_SIZE
export DOCKER_LOG_MAX_FILE
export INSTALL_BUN
export BUN_INSTALL_DIR
export ENABLE_SWAP
export SWAP_FILE_PATH
export SWAP_SIZE
export SWAP_SWAPPINESS
export SWAP_VFS_CACHE_PRESSURE
export ENABLE_PUBLIC_ROUTING
export PUBLIC_FIREWALL_PORTS
export WEB_DOMAIN
export WEB_UPSTREAM_PORT
export API_DOMAIN
export API_UPSTREAM_PORT
export NGINX_SITE_NAME
export ACME_EMAIL
export INSTALL_SEED_HELPER
export SEED_HELPER_NAME
export SEED_COMPOSE_SERVICE
export SEED_NODE_SCRIPT

cd "${ROOT_DIR}"

case "${mode}" in
  syntax)
    ansible-inventory --list >/dev/null
    if [[ ${#ansible_args[@]} -gt 0 ]]; then
      exec ansible-playbook site.yml --syntax-check "${ansible_args[@]}"
    fi
    exec ansible-playbook site.yml --syntax-check
    ;;
  check)
    if [[ ${#ansible_args[@]} -gt 0 ]]; then
      exec ansible-playbook site.yml --check --diff "${ansible_args[@]}"
    fi
    exec ansible-playbook site.yml --check --diff
    ;;
  run)
    if [[ ${#ansible_args[@]} -gt 0 ]]; then
      exec ansible-playbook site.yml "${ansible_args[@]}"
    fi
    exec ansible-playbook site.yml
    ;;
esac
