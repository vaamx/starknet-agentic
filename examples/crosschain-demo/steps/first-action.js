import { firstActionBalances } from "@starknet-agentic/onboarding-utils";
import { TOKENS } from "../config.js";
export async function firstAction(args) {
    return await firstActionBalances({
        provider: args.provider,
        tokens: TOKENS[args.network] || {},
        accountAddress: args.accountAddress,
        privateKey: args.privateKey,
        verifyTx: args.verifyTx,
    });
}
