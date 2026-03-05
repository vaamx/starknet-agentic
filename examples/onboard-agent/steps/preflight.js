/**
 * Preflight checks: validate environment, RPC connectivity,
 * chain ID, and deployer balance.
 */
import { preflightStarknet } from "@starknet-agentic/onboarding-utils";
import { NETWORKS, TOKENS } from "../config.js";
export async function preflight(env) {
    const { network, accountAddress, privateKey } = env;
    // --- Network config ---
    const networkConfig = NETWORKS[network];
    if (!networkConfig) {
        throw new Error(`Unknown network "${network}". Available: ${Object.keys(NETWORKS).join(", ")}`);
    }
    if (!networkConfig.factory || !networkConfig.registry) {
        throw new Error(`Factory or registry address not set for network "${network}".\n` +
            "Deploy contracts first: see contracts/agent-account/scripts/deploy.js\n" +
            "Then update examples/onboard-agent/config.ts with the deployed addresses.");
    }
    const { provider, account, chainId, balances } = await preflightStarknet({
        network,
        networkConfig,
        tokens: TOKENS[network] || {},
        accountAddress,
        privateKey,
        paymasterUrl: env.paymasterUrl,
        paymasterApiKey: env.paymasterApiKey,
        rpcUrlOverride: env.rpcUrl,
    });
    console.log(`  Chain ID: ${chainId}`);
    console.log(`  Deployer account: ${accountAddress}`);
    for (const [symbol, bal] of Object.entries(balances)) {
        console.log(`  ${symbol} balance: ${bal}`);
    }
    // Warn if both balances are zero
    const hasAnyFunds = Object.values(balances).some((b) => {
        if (b === "error")
            return false;
        return parseFloat(b) > 0;
    });
    if (!hasAnyFunds) {
        console.log("\n  WARNING: Deployer account has no funds. The factory call will fail.");
        console.log("  Fund the account first. For Sepolia, use the Starknet faucet.");
    }
    return {
        provider,
        account,
        networkConfig,
        network,
        chainId,
        balances,
    };
}
