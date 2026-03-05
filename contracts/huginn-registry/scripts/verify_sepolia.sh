#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

RPC_URL="${STARKNET_RPC_URL:-https://starknet-sepolia.public.blastapi.io}"
HUGINN_REGISTRY_ADDRESS="${HUGINN_REGISTRY_ADDRESS:-}"
EXPECTED_VERIFIER_ADDRESS="${HUGINN_VERIFIER_ADDRESS:-}"

if [[ -z "$HUGINN_REGISTRY_ADDRESS" ]]; then
  if [[ -f "$PROJECT_DIR/deployments/sepolia.json" ]]; then
    HUGINN_REGISTRY_ADDRESS=$(grep -Eo '"registryAddress"\s*:\s*"0x[0-9a-fA-F]+' "$PROJECT_DIR/deployments/sepolia.json" | head -1 | sed -E 's/.*"(0x[0-9a-fA-F]+)$/\1/')
  fi
fi

if [[ -z "$HUGINN_REGISTRY_ADDRESS" ]]; then
  echo "❌ HUGINN_REGISTRY_ADDRESS is required (or deployments/sepolia.json must exist)."
  exit 1
fi

if ! command -v sncast >/dev/null 2>&1; then
  echo "❌ Missing required binary: sncast"
  exit 1
fi

if [[ ! "$HUGINN_REGISTRY_ADDRESS" =~ ^0x[0-9a-fA-F]+$ ]]; then
  echo "❌ HUGINN_REGISTRY_ADDRESS must be a 0x-prefixed Starknet address"
  exit 1
fi

echo "🔎 Verifying HuginnRegistry deployment on Sepolia"
echo "📡 RPC URL: $RPC_URL"
echo "🏛️  Registry: $HUGINN_REGISTRY_ADDRESS"

VERIFIER_OUTPUT=$(sncast \
  --url "$RPC_URL" \
  call \
  --contract-address "$HUGINN_REGISTRY_ADDRESS" \
  --function get_verifier 2>&1)

ONCHAIN_VERIFIER=$(echo "$VERIFIER_OUTPUT" | grep -Eo '0x[0-9a-fA-F]+' | head -1)
if [[ -z "$ONCHAIN_VERIFIER" ]]; then
  echo "❌ Failed to read get_verifier()"
  echo "$VERIFIER_OUTPUT"
  exit 1
fi

echo "✅ get_verifier() => $ONCHAIN_VERIFIER"

EXISTS_OUTPUT=$(sncast \
  --url "$RPC_URL" \
  call \
  --contract-address "$HUGINN_REGISTRY_ADDRESS" \
  --function proof_exists \
  --calldata 0 0 2>&1)

PROOF_EXISTS_SAMPLE=$(echo "$EXISTS_OUTPUT" | grep -Eo '0x[0-9a-fA-F]+' | head -1)
if [[ -z "$PROOF_EXISTS_SAMPLE" ]]; then
  echo "❌ Failed to call proof_exists()"
  echo "$EXISTS_OUTPUT"
  exit 1
fi

echo "✅ proof_exists(0) call succeeded (sample return: $PROOF_EXISTS_SAMPLE)"

if [[ -n "$EXPECTED_VERIFIER_ADDRESS" ]]; then
  onchain_lc=$(echo "$ONCHAIN_VERIFIER" | tr '[:upper:]' '[:lower:]')
  expected_lc=$(echo "$EXPECTED_VERIFIER_ADDRESS" | tr '[:upper:]' '[:lower:]')
  if [[ "$onchain_lc" != "$expected_lc" ]]; then
    echo "❌ Verifier mismatch"
    echo "   expected: $EXPECTED_VERIFIER_ADDRESS"
    echo "   on-chain: $ONCHAIN_VERIFIER"
    exit 1
  fi
  echo "✅ Verifier matches expected address"
fi

echo ""
echo "🎉 HuginnRegistry verification checks passed"
