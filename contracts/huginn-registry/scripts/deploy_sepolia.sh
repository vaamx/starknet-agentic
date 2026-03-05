#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ACCOUNTS_FILE="${STARKNET_ACCOUNTS_FILE:-$HOME/.starknet_accounts/starknet_open_zeppelin_accounts.json}"

# Required env vars
RPC_URL="${STARKNET_RPC_URL:-}"
DEPLOYER_ADDRESS="${DEPLOYER_ADDRESS:-}"
DEPLOYER_PRIVATE_KEY="${DEPLOYER_PRIVATE_KEY:-}"
HUGINN_VERIFIER_ADDRESS="${HUGINN_VERIFIER_ADDRESS:-}"
DEPLOYER_ACCOUNT_NAME="${DEPLOYER_ACCOUNT_NAME:-huginn_sepolia_deployer}"
EXPLORER_BASE_URL="${STARKNET_EXPLORER_BASE_URL:-https://sepolia.voyager.online}"

if [[ -z "$RPC_URL" || -z "$DEPLOYER_ADDRESS" || -z "$DEPLOYER_PRIVATE_KEY" || -z "$HUGINN_VERIFIER_ADDRESS" ]]; then
  cat <<MSG
❌ Missing required environment variables.

Required:
  STARKNET_RPC_URL
  DEPLOYER_ADDRESS
  DEPLOYER_PRIVATE_KEY
  HUGINN_VERIFIER_ADDRESS

Optional:
  DEPLOYER_ACCOUNT_NAME (default: huginn_sepolia_deployer)
  STARKNET_ACCOUNTS_FILE (default: ~/.starknet_accounts/starknet_open_zeppelin_accounts.json)
  STARKNET_EXPLORER_BASE_URL (default: https://sepolia.voyager.online)

Tip:
  cp contracts/huginn-registry/scripts/.env.example contracts/huginn-registry/scripts/.env
  source contracts/huginn-registry/scripts/.env
MSG
  exit 1
fi

for bin in scarb sncast; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "❌ Missing required binary: $bin"
    exit 1
  fi
done

if [[ ! "$DEPLOYER_ADDRESS" =~ ^0x[0-9a-fA-F]+$ ]]; then
  echo "❌ DEPLOYER_ADDRESS must be a 0x-prefixed Starknet address"
  exit 1
fi

if [[ ! "$HUGINN_VERIFIER_ADDRESS" =~ ^0x[0-9a-fA-F]+$ ]]; then
  echo "❌ HUGINN_VERIFIER_ADDRESS must be a 0x-prefixed Starknet address"
  exit 1
fi

echo "🚀 Deploying HuginnRegistry to Starknet Sepolia"
echo "📡 RPC URL: $RPC_URL"
echo "👤 Deployer: $DEPLOYER_ADDRESS"
echo "🧠 Verifier: $HUGINN_VERIFIER_ADDRESS"
echo ""

mkdir -p "$(dirname "$ACCOUNTS_FILE")" "$PROJECT_DIR/deployments"

# Import account into sncast accounts file (idempotent).
set +e
IMPORT_OUTPUT=$(sncast account import \
  --name "$DEPLOYER_ACCOUNT_NAME" \
  --address "$DEPLOYER_ADDRESS" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --type oz \
  --accounts-file "$ACCOUNTS_FILE" 2>&1)
IMPORT_EXIT=$?
set -e

if [[ $IMPORT_EXIT -ne 0 ]]; then
  if echo "$IMPORT_OUTPUT" | grep -qi "already"; then
    echo "ℹ️  Account profile already exists: $DEPLOYER_ACCOUNT_NAME"
  else
    echo "❌ Failed to import deployer account"
    echo "$IMPORT_OUTPUT"
    exit 1
  fi
else
  echo "✅ Account profile ready: $DEPLOYER_ACCOUNT_NAME"
fi

echo ""
echo "📦 Building Cairo contract"
(
  cd "$PROJECT_DIR"
  scarb build
)

echo ""
echo "📝 Declaring HuginnRegistry"
set +e
DECLARE_OUTPUT=$(sncast \
  --url "$RPC_URL" \
  --account "$DEPLOYER_ACCOUNT_NAME" \
  --accounts-file "$ACCOUNTS_FILE" \
  declare --contract-name HuginnRegistry 2>&1)
DECLARE_EXIT=$?
set -e

if [[ $DECLARE_EXIT -ne 0 ]] && ! echo "$DECLARE_OUTPUT" | grep -qi "already declared"; then
  echo "❌ Declare failed"
  echo "$DECLARE_OUTPUT"
  exit 1
fi

CLASS_HASH=$(echo "$DECLARE_OUTPUT" | grep -Eo 'class_hash: 0x[0-9a-fA-F]+' | awk '{print $2}' | head -1)
if [[ -z "$CLASS_HASH" ]]; then
  CLASS_HASH=$(echo "$DECLARE_OUTPUT" | grep -Eo '0x[0-9a-fA-F]{64}' | head -1)
fi

if [[ -z "$CLASS_HASH" ]]; then
  echo "❌ Could not extract class hash from declare output"
  echo "$DECLARE_OUTPUT"
  exit 1
fi

echo "✅ Class hash: $CLASS_HASH"

echo ""
echo "🏗️  Deploying HuginnRegistry"
set +e
DEPLOY_OUTPUT=$(sncast \
  --url "$RPC_URL" \
  --account "$DEPLOYER_ACCOUNT_NAME" \
  --accounts-file "$ACCOUNTS_FILE" \
  deploy \
  --class-hash "$CLASS_HASH" \
  --constructor-calldata "$HUGINN_VERIFIER_ADDRESS" 2>&1)
DEPLOY_EXIT=$?
set -e

if [[ $DEPLOY_EXIT -ne 0 ]]; then
  echo "❌ Deploy failed"
  echo "$DEPLOY_OUTPUT"
  exit 1
fi

CONTRACT_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep -Eo 'contract_address: 0x[0-9a-fA-F]+' | awk '{print $2}' | head -1)
if [[ -z "$CONTRACT_ADDRESS" ]]; then
  CONTRACT_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep -Eo '0x[0-9a-fA-F]{64}' | tail -1)
fi

TX_HASH=$(echo "$DEPLOY_OUTPUT" | grep -Eo 'transaction_hash: 0x[0-9a-fA-F]+' | awk '{print $2}' | head -1)
if [[ -z "$TX_HASH" ]]; then
  TX_HASH=$(echo "$DEPLOY_OUTPUT" | grep -Eo '0x[0-9a-fA-F]{64}' | head -1)
fi

if [[ -z "$CONTRACT_ADDRESS" ]]; then
  echo "❌ Could not extract contract address from deploy output"
  echo "$DEPLOY_OUTPUT"
  exit 1
fi

OUTPUT_PATH="$PROJECT_DIR/deployments/sepolia.json"
cat > "$OUTPUT_PATH" <<JSON
{
  "network": "sepolia",
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "rpcUrl": "$RPC_URL",
  "deployerAddress": "$DEPLOYER_ADDRESS",
  "verifierAddress": "$HUGINN_VERIFIER_ADDRESS",
  "classHash": "$CLASS_HASH",
  "registryAddress": "$CONTRACT_ADDRESS",
  "transactionHash": "${TX_HASH:-unknown}"
}
JSON

echo ""
echo "✅ HuginnRegistry deployed"
echo "   Registry: $CONTRACT_ADDRESS"
echo "   Verifier: $HUGINN_VERIFIER_ADDRESS"
echo "   Class hash: $CLASS_HASH"
echo "   Deployment metadata: $OUTPUT_PATH"
echo ""
echo "🔍 Explorer"
echo "   $EXPLORER_BASE_URL/contract/$CONTRACT_ADDRESS"
echo "   $EXPLORER_BASE_URL/tx/${TX_HASH:-}"
echo ""
echo "🧩 Next steps"
echo "   1. Run: contracts/huginn-registry/scripts/verify_sepolia.sh"
echo "   2. Set: HUGINN_REGISTRY_ADDRESS=$CONTRACT_ADDRESS"
echo "   3. Update: skills/huginn-onboard/SKILL.md + env docs"
