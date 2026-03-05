import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExecute = vi.fn();
const mockWaitForTransaction = vi.fn();
const mockWalletPreflight = vi.fn();
const mockWalletExecute = vi.fn();

vi.mock("./config", () => ({
  config: {
    STARKNET_RPC_URL: "http://localhost:5050",
    STARKNET_CHAIN_ID: "SN_SEPOLIA",
    EXECUTION_SURFACE: "direct",
    AGENT_PRIVATE_KEY: "0xabc",
    AGENT_ADDRESS: "0x123",
    MARKET_FACTORY_ADDRESS: "0xfactory",
    ACCURACY_TRACKER_ADDRESS: "0xtracker",
    COLLATERAL_TOKEN_ADDRESS: "0xcol",
  },
}));

vi.mock("starknet", () => ({
  Account: vi.fn().mockImplementation(() => ({
    execute: mockExecute,
  })),
  RpcProvider: vi.fn().mockImplementation(() => ({
    waitForTransaction: mockWaitForTransaction,
  })),
  CallData: {
    compile: vi.fn((x: unknown) => x),
  },
}));

vi.mock("starkzap", () => ({
  ChainId: {
    SEPOLIA: "SEPOLIA",
    SN_SEPOLIA: "SN_SEPOLIA",
    MAINNET: "MAINNET",
  },
  StarkSigner: vi.fn().mockImplementation(() => ({})),
  StarkSDK: vi.fn().mockImplementation(() => ({
    connectWallet: vi.fn().mockResolvedValue({
      ensureReady: vi.fn().mockResolvedValue(undefined),
      preflight: mockWalletPreflight,
      execute: mockWalletExecute,
    }),
  })),
}));

import {
  placeBet,
  recordPrediction,
  resolveMarket,
  claimWinnings,
  createMarket,
  finalizeMarket,
} from "./starknet-executor";

describe("starknet executor provider parity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWaitForTransaction.mockResolvedValue(undefined);
    mockExecute.mockResolvedValue({ transaction_hash: "0xabc" });
    mockWalletPreflight.mockResolvedValue({ ok: true });
    mockWalletExecute.mockResolvedValue({
      transactionHash: "0xdef",
      wait: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("maps policy errors consistently for direct and starkzap", async () => {
    mockExecute.mockRejectedValue(new Error("Policy violation: oversized spend"));
    mockWalletExecute.mockRejectedValue(new Error("Policy violation: oversized spend"));

    const direct = await placeBet("0xmarket", 1, 10n, "0xcol", "direct");
    const starkzap = await placeBet("0xmarket", 1, 10n, "0xcol", "starkzap");

    expect(direct.status).toBe("error");
    expect(starkzap.status).toBe("error");
    expect(direct.errorCode).toBe("POLICY_BLOCKED");
    expect(starkzap.errorCode).toBe("POLICY_BLOCKED");
  });

  it("maps forbidden selector errors consistently for direct and starkzap", async () => {
    mockExecute.mockRejectedValue(new Error("forbidden selector: resolve"));
    mockWalletExecute.mockRejectedValue(new Error("forbidden selector: resolve"));

    const direct = await resolveMarket("0xmarket", 1, "direct");
    const starkzap = await resolveMarket("0xmarket", 1, "starkzap");

    expect(direct.errorCode).toBe("FORBIDDEN_SELECTOR");
    expect(starkzap.errorCode).toBe("FORBIDDEN_SELECTOR");
  });

  it("maps revoked session-key errors consistently for direct and starkzap", async () => {
    mockExecute.mockRejectedValue(new Error("session key revoked"));
    mockWalletExecute.mockRejectedValue(new Error("session key revoked"));

    const direct = await claimWinnings("0xmarket", "direct");
    const starkzap = await claimWinnings("0xmarket", "starkzap");

    expect(direct.errorCode).toBe("SESSION_KEY_REVOKED");
    expect(starkzap.errorCode).toBe("SESSION_KEY_REVOKED");
  });

  it("returns unsupported surface for avnu across lifecycle operations", async () => {
    const results = await Promise.all([
      createMarket("0x1", Math.floor(Date.now() / 1000) + 3600, "0xoracle", 200, "avnu"),
      recordPrediction(0, 0.5, "avnu"),
      finalizeMarket(0, 1, "avnu"),
      resolveMarket("0xmarket", 1, "avnu"),
      claimWinnings("0xmarket", "avnu"),
    ]);

    for (const result of results) {
      expect(result.status).toBe("error");
      expect(result.errorCode).toBe("UNSUPPORTED_SURFACE");
      expect(result.executionSurface).toBe("avnu");
    }
  });
});
