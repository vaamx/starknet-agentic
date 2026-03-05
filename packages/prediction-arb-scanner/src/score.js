export function computeSpreadBps(bestBid, bestAsk) {
    if (bestBid == null || bestAsk == null)
        return undefined;
    if (bestBid <= 0 || bestAsk <= 0)
        return undefined;
    if (bestBid > bestAsk)
        return undefined;
    const mid = (bestBid + bestAsk) / 2;
    if (mid === 0)
        return undefined;
    return ((bestAsk - bestBid) / mid) * 10000;
}
export function computeMid(bestBid, bestAsk) {
    if (bestBid == null || bestAsk == null)
        return undefined;
    if (bestBid > bestAsk)
        return undefined;
    return (bestBid + bestAsk) / 2;
}
export function computeEdgeBpsGross(aMid, bMid) {
    return Math.abs(aMid - bMid) * 10000;
}
