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
import { type DeployerAccountLike, type ProviderLike } from "@starknet-agentic/onboarding-utils";
import type { NetworkConfig } from "../config.js";
export interface DeployAccountResult {
    accountAddress: string;
    agentId: string;
    publicKey: string;
    privateKey: string;
    deployTxHash: string;
}
export declare function deployAccount(args: {
    provider: ProviderLike;
    deployerAccount: DeployerAccountLike;
    networkConfig: NetworkConfig;
    network: string;
    tokenUri: string;
    gasfree?: boolean;
    paymasterUrl?: string;
    paymasterApiKey?: string;
    salt?: string;
}): Promise<DeployAccountResult>;
