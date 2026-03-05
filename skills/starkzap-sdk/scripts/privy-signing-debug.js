"use strict";
/**
 * Placeholder example for Privy signer diagnostics in Starkzap.
 * NOTE: This script depends on `starkzap` and is intended to run inside the Starkzap repository context.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const starkzap_1 = require("starkzap");
function requireEnv(name) {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`Missing ${name} env var`);
    }
    return value;
}
async function main() {
    const walletId = requireEnv("PRIVY_WALLET_ID");
    const publicKey = requireEnv("PRIVY_PUBLIC_KEY");
    const signerUrl = requireEnv("PRIVY_SIGNER_URL");
    const sdk = new starkzap_1.StarkSDK({ network: "sepolia" });
    await sdk.onboard({
        strategy: starkzap_1.OnboardStrategy.Privy,
        privy: {
            resolve: async () => ({
                walletId,
                publicKey,
                serverUrl: signerUrl,
            }),
        },
        feeMode: "sponsored",
    });
    console.log("Privy onboarding placeholder completed");
}
main().catch((error) => {
    console.error("privy-signing-debug failed:", error);
    process.exit(1);
});
