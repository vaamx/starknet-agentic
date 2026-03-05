export type ExecutionSurface = "direct" | "starkzap" | "avnu";
export type TxErrorCode = "NO_ACCOUNT" | "TRACKER_NOT_DEPLOYED" | "UNSUPPORTED_SURFACE" | "EXECUTION_FAILED";
export interface TxResult {
    txHash: string;
    status: "success" | "error";
    executionSurface: ExecutionSurface;
    errorCode?: TxErrorCode;
    error?: string;
}
export declare function placeBet(marketAddress: string, outcome: 0 | 1, amount: bigint, collateralToken: string, executionSurface?: ExecutionSurface): Promise<TxResult>;
export declare function recordPrediction(marketId: number, probability: number, executionSurface?: ExecutionSurface): Promise<TxResult>;
export declare function claimWinnings(marketAddress: string, executionSurface?: ExecutionSurface): Promise<TxResult>;
export declare function isAgentConfigured(): boolean;
export declare function getAgentAddress(): string | null;
