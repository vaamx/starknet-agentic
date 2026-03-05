import { preflightStarknet } from "@starknet-agentic/onboarding-utils";
import { STARKNET_NETWORKS, TOKENS } from "../config.js";
export async function preflight(env) {
    const { network, accountAddress, privateKey } = env;
    const networkConfig = STARKNET_NETWORKS[network];
    if (!networkConfig) {
        throw new Error(`Unknown network "${network}". Available: ${Object.keys(STARKNET_NETWORKS).join(", ")}`);
    }
    if (!networkConfig.factory || !networkConfig.registry) {
        throw new Error(`Factory or registry address not set for network "${network}". Update examples/crosschain-demo/config.ts first.`);
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
    return {
        provider,
        account,
        networkConfig,
        network,
        chainId,
        balances,
    };
}
