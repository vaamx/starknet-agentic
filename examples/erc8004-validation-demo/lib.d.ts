import { type RpcProvider } from "starknet";
export type StarknetEvent = {
    keys: string[];
    data: string[];
    from_address?: string;
};
export type StarknetTxReceipt = {
    events?: StarknetEvent[];
};
export declare function toU256Calldata(value: bigint): string[];
export declare function parseU256FromFelts(low: string, high: string): bigint;
export declare function parseValidationRequestHashFromReceipt(args: {
    receipt: StarknetTxReceipt;
    expectedValidator?: string;
    expectedAgentId?: bigint;
}): bigint;
export declare function readTotalAgents(args: {
    provider: RpcProvider;
    identityRegistry: string;
}): Promise<bigint>;
export declare function readAgentExists(args: {
    provider: RpcProvider;
    identityRegistry: string;
    agentId: bigint;
}): Promise<boolean>;
export declare function readValidationSummary(args: {
    provider: RpcProvider;
    validationRegistry: string;
    agentId: bigint;
    tag: string;
}): Promise<{
    count: bigint;
    avg: bigint;
}>;
