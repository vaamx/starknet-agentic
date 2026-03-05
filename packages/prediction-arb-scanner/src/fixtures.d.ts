export declare const polymarketFixture: {
    readonly venue: "polymarket";
    readonly marketId: "poly-123";
    readonly url: "https://polymarket.com/market/example";
    readonly eventTitle: "STRK Token Price above $1 by 2026-12-31?";
    readonly endTimeMs: 1798675200000;
    readonly outcomeKey: "YES";
    readonly bestBid: 0.42;
    readonly bestAsk: 0.44;
    readonly depth: {
        readonly bids: readonly [{
            readonly price: 0.42;
            readonly sizeUsd: 250;
        }];
        readonly asks: readonly [{
            readonly price: 0.44;
            readonly sizeUsd: 250;
        }];
        readonly topOfBookUsd: 500;
    };
    readonly timestampMs: 1770100000000;
};
export declare const raizeFixture: {
    readonly venue: "raize";
    readonly marketId: "raize-789";
    readonly url: "https://raize.club/";
    readonly eventTitle: "STRK token price above $1 by 2026-12-31";
    readonly endTimeMs: 1798675200000;
    readonly outcomeKey: "YES";
    readonly bestBid: 0.49;
    readonly bestAsk: 0.51;
    readonly depth: {
        readonly bids: readonly [{
            readonly price: 0.49;
            readonly sizeUsd: 150;
        }];
        readonly asks: readonly [{
            readonly price: 0.51;
            readonly sizeUsd: 150;
        }];
        readonly topOfBookUsd: 300;
    };
    readonly timestampMs: 1770100000000;
};
export declare const limitlessFixture: {
    readonly venue: "limitless";
    readonly marketId: "lim-456";
    readonly url: "https://limitless.exchange/";
    readonly eventTitle: "STRK price > $1 on 2026-12-31";
    readonly endTimeMs: 1798675200000;
    readonly outcomeKey: "YES";
    readonly bestBid: 0.47;
    readonly bestAsk: 0.48;
    readonly depth: {
        readonly bids: readonly [{
            readonly price: 0.47;
            readonly sizeUsd: 200;
        }];
        readonly asks: readonly [{
            readonly price: 0.48;
            readonly sizeUsd: 200;
        }];
        readonly topOfBookUsd: 400;
    };
    readonly timestampMs: 1770100000000;
};
