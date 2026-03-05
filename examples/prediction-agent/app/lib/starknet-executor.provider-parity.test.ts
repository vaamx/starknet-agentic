import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockExecute,
  mockWaitForTransaction,
  mockWalletPreflight,
  mockWalletExecute,
} = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockWaitForTransaction: vi.fn(),
  mockWalletPreflight: vi.fn(),
  mockWalletExecute: vi.fn(),
}));

vi.mock("./config", () => ({
  config: {
    STARKNET_RPC_URL: "http://localhost:5050",
    STARKNET_CHAIN_ID: "SN_SEPOLIA",
    EXECUTION_SURFACE: "direct",
    EXECUTION_PROFILE: "hardened",
    STARKZAP_FALLBACK_TO_DIRECT: "false",
    AGENT_PRIVATE_KEY: "0xabc",
    AGENT_ADDRESS: "0x123",
    MARKET_FACTORY_ADDRESS: "0xfactory",
    ACCURACY_TRACKER_ADDRESS: "0xtracker",
    COLLATERAL_TOKEN_ADDRESS: "0xcol",
  },
}));

vi.mock("starknet", () => ({
  Account: vi.fn(function Account() {
    return {
      execute: mockExecute,
    };
  }),
  RpcProvider: vi.fn(function RpcProvider() {
    return {
      waitForTransaction: mockWaitForTransaction,
    };
  }),
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
  StarkSigner: vi.fn(function StarkSigner() {
    return {};
  }),
  StarkSDK: vi.fn(function StarkSDK() {
    return {
      connectWallet: vi.fn().mockResolvedValue({
        ensureReady: vi.fn().mockResolvedValue(undefined),
        preflight: mockWalletPreflight,
        execute: mockWalletExecute,
      }),
    };
  }),
}));

import {
  placeBet,
  recordPrediction,
  resolveMarket,
  claimWinnings,
  createMarket,
  finalizeMarket,
} from "./starknet-executor.ts";

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
    expect(["POLICY_BLOCKED", "PROVIDER_UNAVAILABLE"]).toContain(
      starkzap.errorCode
    );
  });

  it("maps forbidden selector errors consistently for direct and starkzap", async () => {
    mockExecute.mockRejectedValue(new Error("forbidden selector: bet"));
    mockWalletExecute.mockRejectedValue(new Error("forbidden selector: bet"));

    const direct = await placeBet("0xmarket", 1, 10n, "0xcol", "direct");
    const starkzap = await placeBet("0xmarket", 1, 10n, "0xcol", "starkzap");

    expect(direct.errorCode).toBe("FORBIDDEN_SELECTOR");
    expect(["FORBIDDEN_SELECTOR", "PROVIDER_UNAVAILABLE"]).toContain(
      starkzap.errorCode
    );
  });

  it("maps revoked session-key errors consistently for direct and starkzap", async () => {
    mockExecute.mockRejectedValue(new Error("session key revoked"));
    mockWalletExecute.mockRejectedValue(new Error("session key revoked"));

    const direct = await claimWinnings("0xmarket", "direct");
    const starkzap = await claimWinnings("0xmarket", "starkzap");

    expect(direct.errorCode).toBe("SESSION_KEY_REVOKED");
    expect(["SESSION_KEY_REVOKED", "PROVIDER_UNAVAILABLE"]).toContain(
      starkzap.errorCode
    );
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

  it("blocks admin lifecycle operations on starkzap in hardened profile", async () => {
    const results = await Promise.all([
      createMarket(
        "0x1",
        Math.floor(Date.now() / 1000) + 3600,
        "0xoracle",
        200,
        "starkzap"
      ),
      resolveMarket("0xmarket", 1, "starkzap"),
      finalizeMarket(0, 1, "starkzap"),
    ]);

    for (const result of results) {
      expect(result.status).toBe("error");
      expect(result.errorCode).toBe("UNSUPPORTED_SURFACE");
      expect(result.executionSurface).toBe("starkzap");
      expect(result.error).toContain("EXECUTION_PROFILE");
    }
    expect(mockWalletExecute).not.toHaveBeenCalled();
  });
});
