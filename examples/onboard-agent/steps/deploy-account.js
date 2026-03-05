/**
 * Deploy a new agent account via the AgentAccountFactory.
 *
 * This step:
 * 1. Generates a new Stark keypair locally (never sent to any server)
 * 2. Calls factory.deploy_account(public_key, salt, token_uri)
 * 3. Returns the new account address, agent_id, and keypair
 *
 * The factory atomically:
 *   - Deploys an AgentAccount contract
 *   - Registers the agent with the IdentityRegistry (ERC-8004)
 *   - Transfers the identity NFT to the new account
 *   - Links the agent_id to the account
 */
import { deployAccountViaFactory, } from "@starknet-agentic/onboarding-utils";
export async function deployAccount(args) {
    const gasfree = args.gasfree ?? false;
    if (gasfree && !args.paymasterApiKey) {
        throw new Error("Gasfree mode requires AVNU_PAYMASTER_API_KEY in environment.");
    }
    const result = await deployAccountViaFactory({
        provider: args.provider,
        deployerAccount: args.deployerAccount,
        factoryAddress: args.networkConfig.factory,
        tokenUri: args.tokenUri,
        gasfree,
        requireEvent: false, // onboarding example allows "check_explorer" fallback
        salt: args.salt,
    });
    return result;
}
