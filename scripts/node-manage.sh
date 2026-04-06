#!/usr/bin/env bash
#
# Replit AI Proxy - Node Management Script
#
# Usage:
#   ./scripts/node-manage.sh add  <sub-node-url> [key] [label]
#   ./scripts/node-manage.sh rm   <sub-node-url>
#   ./scripts/node-manage.sh list
#   ./scripts/node-manage.sh test [model]
#
# Environment:
#   MASTER_URL   - Master node URL (required, or pass as first seen https:// arg)
#   ADMIN_KEY    - Admin key (default: sk-admin-default-key-2024)
#   PROXY_KEY    - Proxy API key (default: sk-proxy-default-key-2024)

set -euo pipefail

DEFAULT_ADMIN_KEY="sk-admin-default-key-2024"
DEFAULT_PROXY_KEY="sk-proxy-default-key-2024"

ADMIN_KEY="${ADMIN_KEY:-$DEFAULT_ADMIN_KEY}"
PROXY_KEY="${PROXY_KEY:-$DEFAULT_PROXY_KEY}"

# --- helpers ---

die() { echo "ERROR: $*" >&2; exit 1; }

require_master() {
  if [[ -z "${MASTER_URL:-}" ]]; then
    die "MASTER_URL not set. Export it or pass via environment."
  fi
}

# --- commands ---

cmd_add() {
  local url="${1:?Usage: node-manage.sh add <url> [key] [label]}"
  local key="${2:-$DEFAULT_PROXY_KEY}"
  local label="${3:-}"

  require_master

  local body
  if [[ -n "$label" ]]; then
    body=$(printf '{"url":"%s","key":"%s","label":"%s"}' "$url" "$key" "$label")
  else
    body=$(printf '{"url":"%s","key":"%s"}' "$url" "$key")
  fi

  echo "Adding node: $url"
  curl -s -X POST "${MASTER_URL}/v1/admin/backends" \
    -H "Authorization: Bearer ${ADMIN_KEY}" \
    -H "Content-Type: application/json" \
    -d "$body" | python3 -m json.tool 2>/dev/null || cat
  echo
}

cmd_rm() {
  local url="${1:?Usage: node-manage.sh rm <url>}"

  require_master

  echo "Removing node: $url"
  curl -s -X DELETE "${MASTER_URL}/v1/admin/backends" \
    -H "Authorization: Bearer ${ADMIN_KEY}" \
    -H "Content-Type: application/json" \
    -d "$(printf '{"url":"%s"}' "$url")" | python3 -m json.tool 2>/dev/null || cat
  echo
}

cmd_list() {
  require_master

  echo "Backend pool status:"
  echo "--------------------"
  curl -s "${MASTER_URL}/v1/admin/backends" \
    -H "Authorization: Bearer ${ADMIN_KEY}" | python3 -m json.tool 2>/dev/null || cat
  echo
}

cmd_test() {
  local model="${1:-claude-haiku-4-5}"

  require_master

  echo "Testing model: $model"
  echo "---"
  curl -s "${MASTER_URL}/v1/messages" \
    -H "x-api-key: ${PROXY_KEY}" \
    -H "Content-Type: application/json" \
    -d "$(printf '{"model":"%s","max_tokens":100,"messages":[{"role":"user","content":"Say hi in one word."}]}' "$model")" | python3 -m json.tool 2>/dev/null || cat
  echo
}

cmd_models() {
  require_master

  echo "Available models:"
  echo "-----------------"
  curl -s "${MASTER_URL}/v1/models" \
    -H "x-api-key: ${PROXY_KEY}" | python3 -m json.tool 2>/dev/null || cat
  echo
}

cmd_help() {
  cat <<'EOF'
Replit AI Proxy - Node Management

Usage:
  ./scripts/node-manage.sh <command> [args]

Commands:
  add <url> [key] [label]   Add a sub-node to the pool
  rm  <url>                 Remove a sub-node from the pool
  list                      Show all nodes and their status
  test [model]              Test a chat request (default: claude-haiku-4-5)
  models                    List available models
  help                      Show this help

Environment:
  MASTER_URL    Master node URL (required)
  ADMIN_KEY     Admin key (default: sk-admin-default-key-2024)
  PROXY_KEY     Proxy API key (default: sk-proxy-default-key-2024)

Examples:
  export MASTER_URL="https://replit-ai-skeleton--pikapk.replit.app"

  ./scripts/node-manage.sh list
  ./scripts/node-manage.sh add https://sub1--user2.replit.app
  ./scripts/node-manage.sh add https://sub2--user3.replit.app sk-custom-key my-label
  ./scripts/node-manage.sh rm  https://sub1--user2.replit.app
  ./scripts/node-manage.sh test claude-sonnet-4-6
  ./scripts/node-manage.sh test gpt-5-mini
  ./scripts/node-manage.sh models
EOF
}

# --- main ---

case "${1:-help}" in
  add)    shift; cmd_add "$@" ;;
  rm|remove|del|delete) shift; cmd_rm "$@" ;;
  list|ls|pool|status)  cmd_list ;;
  test)   shift; cmd_test "$@" ;;
  models) cmd_models ;;
  help|--help|-h) cmd_help ;;
  *)      die "Unknown command: $1. Run with 'help' for usage." ;;
esac
