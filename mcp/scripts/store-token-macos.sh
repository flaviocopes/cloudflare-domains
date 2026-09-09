#!/usr/bin/env bash

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This helper uses macOS Keychain. On another OS, configure CLOUDFLARE_API_TOKEN through your MCP client or secret manager." >&2
  exit 1
fi

KEYCHAIN_SERVICE="${CLOUDFLARE_KEYCHAIN_SERVICE:-cloudflare.domain-registrar-mcp}"
KEYCHAIN_ACCOUNT="${CLOUDFLARE_KEYCHAIN_ACCOUNT:-${USER:-}}"
LOGIN_KEYCHAIN="${HOME}/Library/Keychains/login.keychain-db"

if [[ -z "$KEYCHAIN_ACCOUNT" ]]; then
  echo "Set CLOUDFLARE_KEYCHAIN_ACCOUNT to your macOS username." >&2
  exit 1
fi

if [[ ! -f "$LOGIN_KEYCHAIN" ]]; then
  echo "Could not find the login Keychain at $LOGIN_KEYCHAIN" >&2
  exit 1
fi

read -r -s -p "Cloudflare Registrar API token: " REGISTRAR_TOKEN
echo

if [[ -z "$REGISTRAR_TOKEN" ]]; then
  echo "The token cannot be empty." >&2
  exit 1
fi

security add-generic-password \
  -U \
  -a "$KEYCHAIN_ACCOUNT" \
  -s "$KEYCHAIN_SERVICE" \
  -w "$REGISTRAR_TOKEN" \
  "$LOGIN_KEYCHAIN" >/dev/null

unset REGISTRAR_TOKEN

echo "Stored the token in the login Keychain."
echo "Service: $KEYCHAIN_SERVICE"
echo "Account: $KEYCHAIN_ACCOUNT"
