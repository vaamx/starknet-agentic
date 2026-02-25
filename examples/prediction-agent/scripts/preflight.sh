#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${APP_DIR}"

RUN_BUILD=1
RUN_TEST=1
ALLOW_PLACEHOLDERS=0
REQUIRE_UPSTASH=0
REQUIRE_ALERT_CHANNELS=0
ENV_FILE=".env"

errors=()
warnings=()

usage() {
  cat <<'USAGE'
Usage: bash scripts/preflight.sh [options]

Checks production launch readiness for examples/prediction-agent.

Options:
  --env-file <path>       Load environment from a specific file (default: .env)
  --skip-test             Skip `pnpm test`
  --skip-build            Skip `pnpm build`
  --allow-placeholders    Treat placeholder env values as warnings (for template validation)
  --require-upstash       Fail when RATE_LIMIT_BACKEND is not `upstash`
  --require-alert-channels
                           Fail unless AGENT_ALERTING_ENABLED=true and at least one channel is configured
  -h, --help              Show this help
USAGE
}

add_error() {
  errors+=("$1")
}

add_warning() {
  warnings+=("$1")
}

is_placeholder() {
  local value="${1:-}"
  local lowered

  if [[ -z "${value}" ]]; then
    return 0
  fi

  lowered="$(printf '%s' "${value}" | tr '[:upper:]' '[:lower:]')"

  if [[ "${value}" == *"..."* ]]; then
    return 0
  fi

  case "${lowered}" in
    "replace-me"|"replace-with-random-secret"|"your-secret"|"changeme"|"todo"|"tbd")
      return 0
      ;;
  esac

  return 1
}

is_hex_0x() {
  [[ "${1}" =~ ^0x[0-9a-fA-F]{1,64}$ ]]
}

is_http_url() {
  [[ "${1}" =~ ^https?://.+$ ]]
}

load_env_file() {
  if [[ ! -f "${ENV_FILE}" ]]; then
    add_error "Environment file not found: ${ENV_FILE}"
    return
  fi

  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
}

require_var() {
  local name="$1"
  local value="${!name:-}"

  if [[ -z "${value}" ]]; then
    add_error "${name} is required but missing"
    return
  fi

  if is_placeholder "${value}"; then
    if (( ALLOW_PLACEHOLDERS )); then
      add_warning "${name} is still a placeholder (${value})"
    else
      add_error "${name} is still a placeholder (${value})"
    fi
  fi
}

require_hex_var() {
  local name="$1"
  local allow_zero="${2:-0}"
  local value="${!name:-}"

  require_var "${name}"

  if [[ -z "${value}" ]]; then
    return
  fi

  if is_placeholder "${value}"; then
    return
  fi

  if ! is_hex_0x "${value}"; then
    add_error "${name} must be a Starknet hex value (0x + 1-64 hex chars)"
    return
  fi

  if [[ "${allow_zero}" != "1" && "${value}" == "0x0" ]]; then
    add_error "${name} must not be 0x0 for production launch"
  fi
}

validate_env() {
  require_var STARKNET_RPC_URL
  if [[ -n "${STARKNET_RPC_URL:-}" ]] && ! is_placeholder "${STARKNET_RPC_URL}"; then
    if ! is_http_url "${STARKNET_RPC_URL}"; then
      add_error "STARKNET_RPC_URL must start with http:// or https://"
    fi
  fi

  require_hex_var AGENT_ADDRESS
  require_hex_var AGENT_PRIVATE_KEY
  require_hex_var MARKET_FACTORY_ADDRESS
  require_hex_var ACCURACY_TRACKER_ADDRESS

  require_var ANTHROPIC_API_KEY
  require_var HEARTBEAT_SECRET

  require_var RATE_LIMIT_BACKEND
  case "${RATE_LIMIT_BACKEND:-}" in
    memory)
      if (( REQUIRE_UPSTASH )); then
        add_error "RATE_LIMIT_BACKEND must be upstash when --require-upstash is enabled"
      else
        add_warning "RATE_LIMIT_BACKEND=memory is single-instance only; use upstash for multi-replica deployments"
      fi
      ;;
    upstash)
      require_var UPSTASH_REDIS_REST_URL
      require_var UPSTASH_REDIS_REST_TOKEN
      ;;
    "")
      ;;
    *)
      add_error "RATE_LIMIT_BACKEND must be one of: memory, upstash"
      ;;
  esac

  if [[ -n "${RATE_LIMIT_GLOBAL_PER_MIN:-}" ]]; then
    if [[ ! "${RATE_LIMIT_GLOBAL_PER_MIN}" =~ ^[0-9]+$ ]]; then
      add_error "RATE_LIMIT_GLOBAL_PER_MIN must be a positive integer"
    elif (( RATE_LIMIT_GLOBAL_PER_MIN < 1 )); then
      add_error "RATE_LIMIT_GLOBAL_PER_MIN must be >= 1"
    fi
  else
    add_error "RATE_LIMIT_GLOBAL_PER_MIN is required"
  fi

  local alerting_enabled="${AGENT_ALERTING_ENABLED:-false}"
  if (( REQUIRE_ALERT_CHANNELS )) && [[ "${alerting_enabled}" != "true" ]]; then
    add_error "AGENT_ALERTING_ENABLED must be true when --require-alert-channels is enabled"
  fi

  if [[ "${alerting_enabled}" == "true" || ${REQUIRE_ALERT_CHANNELS} -eq 1 ]]; then
    local channel_count=0

    if [[ -n "${AGENT_ALERT_WEBHOOK_URL:-}" ]]; then
      if is_placeholder "${AGENT_ALERT_WEBHOOK_URL}"; then
        add_error "AGENT_ALERT_WEBHOOK_URL is a placeholder"
      elif ! is_http_url "${AGENT_ALERT_WEBHOOK_URL}"; then
        add_error "AGENT_ALERT_WEBHOOK_URL must be a valid http(s) URL"
      else
        channel_count=$((channel_count + 1))
      fi
    fi

    if [[ -n "${AGENT_ALERT_SLACK_WEBHOOK_URL:-}" ]]; then
      if is_placeholder "${AGENT_ALERT_SLACK_WEBHOOK_URL}"; then
        add_error "AGENT_ALERT_SLACK_WEBHOOK_URL is a placeholder"
      elif ! is_http_url "${AGENT_ALERT_SLACK_WEBHOOK_URL}"; then
        add_error "AGENT_ALERT_SLACK_WEBHOOK_URL must be a valid http(s) URL"
      else
        channel_count=$((channel_count + 1))
      fi
    fi

    if [[ -n "${AGENT_ALERT_PAGERDUTY_ROUTING_KEY:-}" ]]; then
      if is_placeholder "${AGENT_ALERT_PAGERDUTY_ROUTING_KEY}"; then
        add_error "AGENT_ALERT_PAGERDUTY_ROUTING_KEY is a placeholder"
      else
        channel_count=$((channel_count + 1))
      fi
    fi

    local alert_secret="${AGENT_ALERT_TEST_SECRET:-${HEARTBEAT_SECRET:-}}"
    if [[ -z "${alert_secret}" ]]; then
      add_error "AGENT_ALERT_TEST_SECRET or HEARTBEAT_SECRET must be set for alert test flows"
    elif is_placeholder "${alert_secret}"; then
      add_error "AGENT_ALERT_TEST_SECRET (or HEARTBEAT_SECRET) is a placeholder"
    fi

    if (( channel_count == 0 )); then
      if (( REQUIRE_ALERT_CHANNELS )); then
        add_error "At least one alert channel is required (webhook, Slack, or PagerDuty)"
      else
        add_warning "AGENT_ALERTING_ENABLED=true but no delivery channel configured"
      fi
    fi
  fi
}

print_findings() {
  if (( ${#errors[@]} > 0 )); then
    echo ""
    echo "Preflight errors:"
    for msg in "${errors[@]}"; do
      echo "  - ${msg}"
    done
  fi

  if (( ${#warnings[@]} > 0 )); then
    echo ""
    echo "Preflight warnings:"
    for msg in "${warnings[@]}"; do
      echo "  - ${msg}"
    done
  fi
}

while (( $# > 0 )); do
  case "$1" in
    --)
      shift
      ;;
    --env-file)
      if (( $# < 2 )); then
        echo "Missing value for --env-file"
        usage
        exit 1
      fi
      ENV_FILE="$2"
      shift 2
      ;;
    --skip-test)
      RUN_TEST=0
      shift
      ;;
    --skip-build)
      RUN_BUILD=0
      shift
      ;;
    --allow-placeholders)
      ALLOW_PLACEHOLDERS=1
      shift
      ;;
    --require-upstash)
      REQUIRE_UPSTASH=1
      shift
      ;;
    --require-alert-channels)
      REQUIRE_ALERT_CHANNELS=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

echo "== Prediction Agent Preflight =="
echo "App dir: ${APP_DIR}"
echo "Env file: ${ENV_FILE}"

load_env_file
validate_env

if (( ${#errors[@]} > 0 )); then
  print_findings
  echo ""
  echo "Preflight failed before build/test."
  exit 1
fi

if (( RUN_TEST )); then
  echo ""
  echo "Running tests..."
  pnpm test
fi

if (( RUN_BUILD )); then
  echo ""
  echo "Running production build..."
  pnpm build
fi

print_findings

echo ""
echo "Preflight passed. Prediction agent is launch-ready at code/config level."
