#!/usr/bin/env bash
set -euo pipefail

required_vars=(
  OPENCODE_API_KEY
  TARGET_BRANCH
  TARGET_GITHUB_TOKEN
  TARGET_REPO
  TELEGRAM_ALLOWED_CHAT_ID
  TELEGRAM_BOT_TOKEN
)

case "${1:-}" in
  --help|-h|help)
    cat <<'EOF'
Usage: nanoclaw-lite [--help|--version]

Telegram-only OpenCode runtime for Polyglot autonomous branches.

Commands:
  nanoclaw-lite          Start the Telegram daemon
  nanoclaw-lite --help   Show this help
  opencode --help        Show OpenCode CLI help
EOF
    exit 0
    ;;
  --version|-v|version)
    if [[ -f /opt/nanoclaw-lite/package.json ]]; then
      node -p "require('/opt/nanoclaw-lite/package.json').version"
    else
      echo "nanoclaw-lite-unimplemented"
    fi
    exit 0
    ;;
esac

case "${1:-}" in
  --help|-h|help|--version|-v|version)
    skip_runtime_env_check=true
    ;;
  nanoclaw-lite|opencode)
    case "${2:-}" in
      --help|-h|help|--version|-v|version)
        skip_runtime_env_check=true
        ;;
      *)
        skip_runtime_env_check=false
        ;;
    esac
    ;;
  *)
    skip_runtime_env_check=false
    ;;
esac

if [[ "${skip_runtime_env_check}" != "true" ]]; then
  for required_var in "${required_vars[@]}"; do
    if [[ -z "${!required_var:-}" ]]; then
      echo "${required_var} is required." >&2
      exit 1
    fi
  done
fi

if [[ "${1:-nanoclaw-lite}" == "nanoclaw-lite" && ! -f /opt/nanoclaw-lite/dist/index.js ]]; then
  echo "nanoclaw-lite runtime is not built yet. Implement runtime/nanoclaw-lite before building a production image." >&2
  exit 1
fi

if ! command -v opencode >/dev/null 2>&1; then
  echo "opencode binary was not found in PATH." >&2
  exit 1
fi

if [[ ! -d "${NANOCLAW_SKILLS_DIR:-/opt/nanoclaw/superpowers}" ]]; then
  echo "NANOCLAW_SKILLS_DIR does not exist: ${NANOCLAW_SKILLS_DIR:-/opt/nanoclaw/superpowers}" >&2
  exit 1
fi

case "${1:-nanoclaw-lite}" in
  nanoclaw-lite|"")
    cd /opt/nanoclaw-lite
    exec node dist/index.js
    ;;
esac

exec "$@"
