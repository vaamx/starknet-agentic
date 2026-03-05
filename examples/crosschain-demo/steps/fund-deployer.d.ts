import type { FundResult, FundingConfig, FundingProvider, FundingProviderSelection } from "../funding/types.js";
interface BalanceReader {
    callContract(args: {
        contractAddress: string;
        entrypoint: string;
        calldata: string[];
    }): Promise<string[]>;
}
interface FundDeployerArgs {
    provider: BalanceReader;
    network: string;
    deployerAddress: string;
    providerSelection: FundingProviderSelection;
    config: FundingConfig;
    resolveProvider?: (name: "mock" | "skipped" | "starkgate-l1") => FundingProvider;
}
export declare function readTokenBalanceWei(args: {
    provider: BalanceReader;
    network: string;
    accountAddress: string;
    token: "ETH";
}): Promise<bigint>;
export declare function fundDeployer(args: FundDeployerArgs): Promise<{
    funding: FundResult;
    balanceWei: bigint;
}>;
export {};
