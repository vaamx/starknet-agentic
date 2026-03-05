import { describe, expect, it } from "vitest";
import { reviewMarketQuestion } from "./market-quality";

describe("market quality review", () => {
  it("scores strong binary, time-bound markets higher", () => {
    const strong = reviewMarketQuestion(
      "Will ETH close above $6,000 by December 31, 2026?"
    );
    const weak = reviewMarketQuestion("ETH will do great soon");

    expect(strong.score).toBeGreaterThan(75);
    expect(weak.score).toBeLessThan(strong.score);
    expect(weak.issues.length).toBeGreaterThan(0);
  });

  it("detects category hints", () => {
    const review = reviewMarketQuestion(
      "Will the Fed cut rates by at least 25 bps in Q4 2026?"
    );

    expect(review.categoryHint).toBe("macro");
  });
});
