"use strict";
/**
 * Placeholder example script for Starkzap wallet execution.
 * Fill in env values and adapt in the Starkzap repository context.
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
    const rpcUrl = requireEnv("RPC_URL");
    const privateKey = requireEnv("PRIVATE_KEY");
    const sdk = new starkzap_1.StarkSDK({
        rpcUrl,
        chainId: starkzap_1.ChainId.SEPOLIA,
    });
    const wallet = await sdk.connectWallet({
        account: { signer: new starkzap_1.StarkSigner(privateKey) },
        feeMode: "user_pays",
    });
    await wallet.ensureReady({ deploy: "if_needed" });
    // Replace with real calldata in Starkzap repo usage.
    console.log("Wallet is ready:", wallet.address);
}
main().catch((error) => {
    console.error("wallet-execute-example failed:", error);
    process.exit(1);
});
