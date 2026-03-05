import { type Opportunity, type VenueBookSnapshot } from "./types.js";
export type InputSnapshot = {
    venue: "polymarket" | "limitless" | "raize";
    marketId: string;
    url?: string;
    eventTitle: string;
    endTimeMs?: number;
    outcomeKey: string;
    bestBid?: number;
    bestAsk?: number;
    depth: {
        bids: {
            price: number;
            sizeUsd: number;
        }[];
        asks: {
            price: number;
            sizeUsd: number;
        }[];
        topOfBookUsd?: number;
    };
    timestampMs: number;
};
export declare function buildVenueSnapshot(input: InputSnapshot): VenueBookSnapshot;
export declare function scanArbs(params: {
    snapshots: InputSnapshot[];
    minEdgeBps?: number;
}): Opportunity[];
