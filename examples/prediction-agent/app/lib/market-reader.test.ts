import { beforeEach, describe, expect, it } from "vitest";
import { shortString } from "starknet";
import {
  MARKET_QUESTIONS,
  decodeQuestionHash,
  registerQuestion,
  resolveMarketQuestion,
} from "./market-reader";

function clearQuestions() {
  for (const key of Object.keys(MARKET_QUESTIONS)) {
    delete MARKET_QUESTIONS[Number(key)];
  }
}

describe("market-reader question resolution", () => {
  beforeEach(() => {
    clearQuestions();
  });

  it("decodes short-string felt question hashes", () => {
    const encoded = shortString.encodeShortString("ETH above 5k Mar26");
    const decoded = decodeQuestionHash(encoded);
    expect(decoded).toBe("ETH above 5k Mar26");
  });

  it("prefers registered off-chain questions", () => {
    registerQuestion(7, "   Real question text   ");
    const resolved = resolveMarketQuestion(7, "0x0");
    expect(resolved).toBe("Real question text");
  });

  it("hydrates question cache from on-chain hash when mapping is missing", () => {
    const encoded = shortString.encodeShortString("Will STRK exceed $2?");
    const resolved = resolveMarketQuestion(42, encoded);
    expect(resolved).toBe("Will STRK exceed $2?");
    expect(MARKET_QUESTIONS[42]).toBe("Will STRK exceed $2?");
  });

  it("falls back to market label when hash is undecodable", () => {
    const resolved = resolveMarketQuestion(99, "0x0");
    expect(resolved).toBe("Market #99");
  });
});
