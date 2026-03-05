import { deployAccountViaFactory, } from "@starknet-agentic/onboarding-utils";
export async function deployAccount(args) {
    const gasfree = args.gasfree ?? false;
    if (gasfree && !args.paymasterApiKey) {
        throw new Error("Gasfree mode requires AVNU_PAYMASTER_API_KEY.");
    }
    return await deployAccountViaFactory({
        provider: args.provider,
        deployerAccount: args.deployerAccount,
        factoryAddress: args.networkConfig.factory,
        tokenUri: args.tokenUri,
        gasfree,
        requireEvent: true,
        salt: args.salt,
    });
}
