# HuginnRegistry Deployments

This directory is the source of truth for published HuginnRegistry deployment metadata.

- `sepolia.json`: Starknet Sepolia deployment record.

Update process:
1. Run `contracts/huginn-registry/scripts/deploy_sepolia.sh`.
2. Run `contracts/huginn-registry/scripts/verify_sepolia.sh`.
3. Commit the updated `sepolia.json` in the same PR that updates docs/skills with the address.

Do not store private keys or sensitive signer data in these files.
