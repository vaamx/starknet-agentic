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
  createMarket,
  placeBet,
  resolveMarket,
  recordPrediction,
} from "./starknet-executor.ts";

describe("policy-envelope adversarial harness (prediction-agent execution path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWaitForTransaction.mockResolvedValue(undefined);
    mockWalletPreflight.mockResolvedValue({ ok: true });
    mockWalletExecute.mockResolvedValue({
      transactionHash: "0xdef",
      wait: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("oversized spend maps to POLICY_BLOCKED", async () => {
    mockExecute.mockRejectedValue(
      new Error("Policy violation: oversized spend denied")
    );

    const result = await placeBet("0xmarket", 1, 1000n, "0xcol", "direct");
    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("POLICY_BLOCKED");
  });

  it("revoked key maps to SESSION_KEY_REVOKED", async () => {
    mockWalletExecute.mockRejectedValue(new Error("session key revoked by owner"));

    const result = await recordPrediction(1, 0.62, "starkzap");
    expect(result.status).toBe("error");
    expect(["SESSION_KEY_REVOKED", "PROVIDER_UNAVAILABLE"]).toContain(
      result.errorCode
    );
  });

  it("forbidden selector maps to FORBIDDEN_SELECTOR", async () => {
    mockExecute.mockRejectedValue(new Error("forbidden selector: finalize_market"));

    const resolveResult = await resolveMarket("0xmarket", 1, "direct");
    const createResult = await createMarket(
      "0x12",
      Math.floor(Date.now() / 1000) + 3600,
      "0xoracle",
      200,
      "direct"
    );

    expect(resolveResult.errorCode).toBe("FORBIDDEN_SELECTOR");
    expect(createResult.errorCode).toBe("FORBIDDEN_SELECTOR");
  });
});
