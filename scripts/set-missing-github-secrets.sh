#!/usr/bin/env bash
set -eo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/set-missing-github-secrets.sh [--repo OWNER/REPO] [options]

Adds only missing GitHub Actions repository secrets for the Nanoclaw deploy workflow.
Secret values must be passed as command-line arguments. Existing secrets are skipped.

Required when missing:
  --vps-host VALUE
  --vps-user VALUE
  --vps-ssh-private-key VALUE
  --oc-go-cc-api-key VALUE
  --opencode-api-key VALUE
  --telegram-bot-token VALUE
  --telegram-allowed-chat-id VALUE
  --target-github-token VALUE

Optional:
  --vps-ssh-port VALUE
  --polyglot-env-b64 VALUE
  --ghcr-read-token VALUE
  --secret NAME=VALUE       Extra repository secret. Can be repeated.
  --dry-run                 Show what would be created without writing secrets.
  -h, --help

Examples:
  scripts/set-missing-github-secrets.sh \
    --vps-host 203.0.113.10 \
    --vps-user deploy \
    --vps-ssh-private-key "$(cat ~/.ssh/nanoclaw_deploy)" \
    --oc-go-cc-api-key "$OC_TOKEN" \
    --opencode-api-key "$OC_TOKEN" \
    --telegram-bot-token "$TELEGRAM_TOKEN" \
    --telegram-allowed-chat-id 123456789 \
    --target-github-token "$POLYGLOT_PAT"

  scripts/set-missing-github-secrets.sh --repo Stanislavussov/dark-software-factory --dry-run ...
EOF
}

repo=""
dry_run=false
declare -a provided_names=()
declare -a provided_values=()

has_name() {
  local needle="$1"
  shift
  local item

  for item in "$@"; do
    [[ "$item" == "$needle" ]] && return 0
  done

  return 1
}

provided_value() {
  local needle="$1"
  local index

  for ((index = 0; index < ${#provided_names[@]}; index++)); do
    if [[ "${provided_names[$index]}" == "$needle" ]]; then
      printf '%s' "${provided_values[$index]}"
      return 0
    fi
  done

  return 1
}

set_secret_arg() {
  local name="$1"
  local value="$2"
  local index

  if [[ -z "$value" ]]; then
    printf 'error: %s value cannot be empty\n' "$name" >&2
    exit 1
  fi

  for ((index = 0; index < ${#provided_names[@]}; index++)); do
    if [[ "${provided_names[$index]}" == "$name" ]]; then
      provided_values[$index]="$value"
      return 0
    fi
  done

  provided_names+=("$name")
  provided_values+=("$value")
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      [[ $# -ge 2 ]] || { printf 'error: --repo requires OWNER/REPO\n' >&2; exit 1; }
      repo="$2"
      shift 2
      ;;
    --vps-host)
      [[ $# -ge 2 ]] || { printf 'error: --vps-host requires a value\n' >&2; exit 1; }
      set_secret_arg VPS_HOST "$2"
      shift 2
      ;;
    --vps-user)
      [[ $# -ge 2 ]] || { printf 'error: --vps-user requires a value\n' >&2; exit 1; }
      set_secret_arg VPS_USER "$2"
      shift 2
      ;;
    --vps-ssh-private-key)
      [[ $# -ge 2 ]] || { printf 'error: --vps-ssh-private-key requires a value\n' >&2; exit 1; }
      set_secret_arg VPS_SSH_PRIVATE_KEY "$2"
      shift 2
      ;;
    --vps-ssh-port)
      [[ $# -ge 2 ]] || { printf 'error: --vps-ssh-port requires a value\n' >&2; exit 1; }
      set_secret_arg VPS_SSH_PORT "$2"
      shift 2
      ;;
    --oc-go-cc-api-key)
      [[ $# -ge 2 ]] || { printf 'error: --oc-go-cc-api-key requires a value\n' >&2; exit 1; }
      set_secret_arg OC_GO_CC_API_KEY "$2"
      shift 2
      ;;
    --opencode-api-key)
      [[ $# -ge 2 ]] || { printf 'error: --opencode-api-key requires a value\n' >&2; exit 1; }
      set_secret_arg OPENCODE_API_KEY "$2"
      shift 2
      ;;
    --telegram-bot-token)
      [[ $# -ge 2 ]] || { printf 'error: --telegram-bot-token requires a value\n' >&2; exit 1; }
      set_secret_arg TELEGRAM_BOT_TOKEN "$2"
      shift 2
      ;;
    --telegram-allowed-chat-id)
      [[ $# -ge 2 ]] || { printf 'error: --telegram-allowed-chat-id requires a value\n' >&2; exit 1; }
      set_secret_arg TELEGRAM_ALLOWED_CHAT_ID "$2"
      shift 2
      ;;
    --target-github-token)
      [[ $# -ge 2 ]] || { printf 'error: --target-github-token requires a value\n' >&2; exit 1; }
      set_secret_arg TARGET_GITHUB_TOKEN "$2"
      shift 2
      ;;
    --polyglot-env-b64)
      [[ $# -ge 2 ]] || { printf 'error: --polyglot-env-b64 requires a value\n' >&2; exit 1; }
      set_secret_arg POLYGLOT_ENV_B64 "$2"
      shift 2
      ;;
    --ghcr-read-token)
      [[ $# -ge 2 ]] || { printf 'error: --ghcr-read-token requires a value\n' >&2; exit 1; }
      set_secret_arg GHCR_READ_TOKEN "$2"
      shift 2
      ;;
    --secret)
      [[ $# -ge 2 ]] || { printf 'error: --secret requires NAME=VALUE\n' >&2; exit 1; }
      if [[ "$2" != *=* ]]; then
        printf 'error: --secret requires NAME=VALUE\n' >&2
        exit 1
      fi
      name="${2%%=*}"
      value="${2#*=}"
      if [[ ! "$name" =~ ^[A-Z_][A-Z0-9_]*$ ]]; then
        printf 'error: invalid secret name: %s\n' "$name" >&2
        exit 1
      fi
      set_secret_arg "$name" "$value"
      shift 2
      ;;
    --dry-run)
      dry_run=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'error: unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if ! command -v gh >/dev/null 2>&1; then
  printf 'error: GitHub CLI (gh) is required\n' >&2
  exit 1
fi

if [[ -z "$repo" ]]; then
  repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)"
fi

if [[ -z "$repo" ]]; then
  printf 'error: could not determine GitHub repository; pass --repo OWNER/REPO\n' >&2
  exit 1
fi

declare -a required=(
  VPS_HOST
  VPS_USER
  VPS_SSH_PRIVATE_KEY
  OC_GO_CC_API_KEY
  OPENCODE_API_KEY
  TELEGRAM_BOT_TOKEN
  TELEGRAM_ALLOWED_CHAT_ID
  TARGET_GITHUB_TOKEN
)

declare -a managed=(
  "${required[@]}"
  VPS_SSH_PORT
  POLYGLOT_ENV_B64
  GHCR_READ_TOKEN
)

declare -a managed_names=()
for name in "${managed[@]}"; do
  has_name "$name" "${managed_names[@]}" || managed_names+=("$name")
done
for name in "${provided_names[@]}"; do
  has_name "$name" "${managed_names[@]}" || managed_names+=("$name")
done

existing_names="$(gh secret list --repo "$repo" --json name --jq '.[].name')"
declare -a existing=()
while IFS= read -r name; do
  [[ -n "$name" ]] && existing+=("$name")
done <<< "$existing_names"

declare -a missing_required=()
for name in "${required[@]}"; do
  if ! has_name "$name" "${existing[@]}" && ! has_name "$name" "${provided_names[@]}"; then
    missing_required+=("$name")
  fi
done

if [[ ${#missing_required[@]} -gt 0 ]]; then
  printf 'error: missing required secret argument(s) for absent GitHub secret(s): %s\n' "${missing_required[*]}" >&2
  exit 1
fi

created=0
skipped=0
not_provided=0

for name in "${managed_names[@]}"; do
  if has_name "$name" "${existing[@]}"; then
    printf 'skip existing secret: %s\n' "$name"
    skipped=$((skipped + 1))
    continue
  fi

  if ! value="$(provided_value "$name")"; then
    printf 'skip not provided optional secret: %s\n' "$name"
    not_provided=$((not_provided + 1))
    continue
  fi

  if [[ "$dry_run" == true ]]; then
    printf 'would create secret: %s\n' "$name"
  else
    gh secret set "$name" --repo "$repo" --body "$value"
    printf 'created secret: %s\n' "$name"
  fi
  created=$((created + 1))
done

printf 'repo: %s\n' "$repo"
printf 'summary: %s created, %s existing, %s optional not provided\n' "$created" "$skipped" "$not_provided"
