import type { Quote, AvnuCalls } from "@avnu/avnu-sdk";
export declare const TOKENS: {
    ETH: string;
    STRK: string;
    USDC: string;
    USDT: string;
};
export declare const mockQuote: Quote;
export declare const mockEmptyQuotes: Quote[];
export declare const mockSwapResult: {
    transactionHash: string;
};
export declare const mockQuoteToCalls: AvnuCalls;
export declare function createMockAvnu(): {
    getQuotes: any;
    quoteToCalls: any;
    executeSwap: any;
};
export declare function createMockAvnuNoQuotes(): {
    getQuotes: any;
    quoteToCalls: any;
    executeSwap: any;
};
export declare function createMockAvnuWithError(errorMessage: string): {
    getQuotes: any;
    quoteToCalls: any;
    executeSwap: any;
};
