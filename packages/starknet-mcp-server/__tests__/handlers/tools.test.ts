import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Token addresses
const TOKENS = {
  ETH: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
  STRK: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  USDC: "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
  USDT: "0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8",
};

// Mock environment variables before any imports
const mockEnv = {
  STARKNET_RPC_URL: "https://starknet-sepolia.example.com",
  STARKNET_ACCOUNT_ADDRESS: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  STARKNET_SIGNER_MODE: "direct",
  // Non-secret placeholder; tests only require a syntactically-valid string.
  STARKNET_PRIVATE_KEY: "0x1",
  KEYRING_PROXY_URL: "http://127.0.0.1:8545",
  KEYRING_HMAC_SECRET: "test-hmac-secret",
  KEYRING_CLIENT_ID: "mcp-test-suite",
  AVNU_BASE_URL: "https://sepolia.api.avnu.fi",
  AVNU_PAYMASTER_URL: "https://sepolia.paymaster.avnu.fi",
  ERC8004_IDENTITY_REGISTRY_ADDRESS:
    "0x1111111111111111111111111111111111111111111111111111111111111111",
  ERC8004_REPUTATION_REGISTRY_ADDRESS:
    "0x2222222222222222222222222222222222222222222222222222222222222222",
  ERC8004_VALIDATION_REGISTRY_ADDRESS:
    "0x3333333333333333333333333333333333333333333333333333333333333333",
};

// Mock starknet before importing the module
const mockExecute = vi.fn();
const mockEstimateInvokeFee = vi.fn();
const mockEstimatePaymasterTransactionFee = vi.fn();
const mockExecutePaymasterTransaction = vi.fn();
const mockWaitForTransaction = vi.fn();
const mockCallContract = vi.fn();
const mockBalanceOf = vi.fn();
const mockAccountConstructor = vi.fn().mockImplementation(function MockAccount() {
  return {
  address: mockEnv.STARKNET_ACCOUNT_ADDRESS,
  execute: mockExecute,
  estimateInvokeFee: mockEstimateInvokeFee,
  estimatePaymasterTransactionFee: mockEstimatePaymasterTransactionFee,
  executePaymasterTransaction: mockExecutePaymasterTransaction,
  };
});
const mockValidateAndParseAddress = vi.fn((addr: string) =>
  addr.toLowerCase().padStart(66, "0x".padEnd(66, "0"))
);

vi.mock("starknet", () => ({
  Account: mockAccountConstructor,
  RpcProvider: vi.fn().mockImplementation(function MockRpcProvider() {
    return {
      callContract: mockCallContract,
      waitForTransaction: mockWaitForTransaction,
    };
  }),
  PaymasterRpc: vi.fn().mockImplementation(function MockPaymasterRpc(opts) {
    return opts || {};
  }),
  Contract: vi.fn().mockImplementation(function MockContract() {
    return {
      balanceOf: mockBalanceOf,
      get_balances: vi.fn(),
    };
  }),
  CallData: {
    compile: vi.fn((data) => Object.values(data)),
  },
  cairo: {
    uint256: vi.fn((n) => ({ low: n.toString(), high: "0" })),
  },
  num: {
    toHex: vi.fn((value) => {
      if (typeof value === "string" && value.startsWith("0x")) {
        return value;
      }
      return `0x${BigInt(value).toString(16)}`;
    }),
  },
  SignerInterface: class {},
  ETransactionVersion: {
    V3: "0x3",
  },
  validateAndParseAddress: mockValidateAndParseAddress,
  uint256: {
    uint256ToBN: vi.fn((val) => {
      if (typeof val === "bigint") return val;
      return BigInt(val.low) + (BigInt(val.high) << 128n);
    }),
  },
  byteArray: {
    byteArrayFromString: vi.fn((v: string) => ({
      data: [`encoded:${v}`],
      pending_word: "0x0",
      pending_word_len: 0,
    })),
    stringFromByteArray: vi.fn((ba) => "TEST"),
  },
  // Minimal selector helper used by receipt parsers.
  hash: {
    getSelectorFromName: vi.fn((name: string) => `selector:${name}`),
  },
}));

// Mock avnu-sdk
const mockGetQuotes = vi.fn();
const mockQuoteToCalls = vi.fn();

vi.mock("@avnu/avnu-sdk", () => ({
  getQuotes: mockGetQuotes,
  quoteToCalls: mockQuoteToCalls,
  fetchTokenByAddress: vi.fn(),
  fetchVerifiedTokenBySymbol: vi.fn(),
}));

// Mock x402-starknet
const mockCreateStarknetPaymentSignatureHeader = vi.fn();

vi.mock("@starknet-agentic/x402-starknet", () => ({
  createStarknetPaymentSignatureHeader: mockCreateStarknetPaymentSignatureHeader,
}));

// Mock MCP SDK
const mockServerConnect = vi.fn();
let capturedToolHandler: ((request: any) => Promise<any>) | null = null;
let capturedListHandler: (() => Promise<any>) | null = null;

vi.mock("@modelcontextprotocol/sdk/server/index.js", () => ({
  Server: vi.fn().mockImplementation(function MockServer() {
    return {
      setRequestHandler: vi.fn((schema: any, handler: any) => {
        if (schema.method === "tools/list") {
          capturedListHandler = handler;
        } else if (schema.method === "tools/call") {
          capturedToolHandler = handler;
        }
      }),
      connect: mockServerConnect,
    };
  }),
}));

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: vi.fn(),
}));

vi.mock("@modelcontextprotocol/sdk/types.js", () => ({
  CallToolRequestSchema: { method: "tools/call" },
  ListToolsRequestSchema: { method: "tools/list" },
}));

// Helper to call a tool
async function callTool(name: string, args: Record<string, any>) {
  if (!capturedToolHandler) {
    throw new Error("Tool handler not captured - did the module load correctly?");
  }
  return capturedToolHandler({
    params: { name, arguments: args },
  });
}

// Helper to parse tool response
function parseResponse(response: any) {
  const text = response.content[0]?.text;
  return text ? JSON.parse(text) : null;
}

function extractMcpToolsFromSkill(skillPath: string): string[] {
  const skill = readFileSync(skillPath, "utf8");
  const sectionMatch = skill.match(/## MCP Tools Used[\s\S]*?(?:\n## |\n# |$)/);
  if (!sectionMatch) {
    throw new Error(`Missing '## MCP Tools Used' section in ${skillPath}`);
  }
  const tools = new Set<string>();
  for (const match of sectionMatch[0].matchAll(/`(starknet_[a-z0-9_]+)`/g)) {
    tools.add(match[1]!);
  }
  return [...tools];
}

// Structured log output (process.stderr.write) is suppressed during module
// imports in beforeEach blocks to keep test output clean.

describe("MCP Tool Handlers", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockEstimatePaymasterTransactionFee.mockResolvedValue({
      suggested_max_fee_in_gas_token: "0",
    });
    capturedToolHandler = null;
    capturedListHandler = null;

    // Set environment variables
    for (const [key, value] of Object.entries(mockEnv)) {
      process.env[key] = value;
    }

    // Suppress server startup log output
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    // Reset module cache and re-import to capture handlers
    vi.resetModules();

    // Import the server module to trigger handler registration
    await import("../../src/index.js");

    // Restore stderr for test assertions
    stderrSpy.mockRestore();
  });

  afterEach(() => {
    // Clean up environment
    for (const key of Object.keys(mockEnv)) {
      delete process.env[key];
    }
  });

  describe("starknet_get_balance", () => {
    it("returns formatted balance for known token", async () => {
      mockBalanceOf.mockResolvedValue({
        balance: { low: BigInt("1000000000000000000"), high: BigInt(0) },
      });

      const response = await callTool("starknet_get_balance", {
        token: "ETH",
      });

      const result = parseResponse(response);
      expect(result.token).toBe("ETH");
      expect(result.tokenAddress).toBe(TOKENS.ETH);
      expect(result.balance).toBe("1");
      expect(result.raw).toBe("1000000000000000000");
      expect(result.decimals).toBe(18);
    });

    it("uses default address when not provided", async () => {
      mockBalanceOf.mockResolvedValue({
        balance: { low: BigInt("500000"), high: BigInt(0) },
      });

      const response = await callTool("starknet_get_balance", {
        token: "USDC",
      });

      const result = parseResponse(response);
      expect(result.address).toBe(mockEnv.STARKNET_ACCOUNT_ADDRESS);
      expect(result.balance).toBe("0.5");
      expect(result.decimals).toBe(6);
    });

    it("accepts custom address", async () => {
      const customAddress = "0x0987654321098765432109876543210987654321098765432109876543210987";
      mockBalanceOf.mockResolvedValue(BigInt("2000000000000000000"));

      const response = await callTool("starknet_get_balance", {
        address: customAddress,
        token: "STRK",
      });

      const result = parseResponse(response);
      expect(result.address).toBe(customAddress);
    });

    it("handles zero balance", async () => {
      mockBalanceOf.mockResolvedValue(BigInt(0));

      const response = await callTool("starknet_get_balance", {
        token: "ETH",
      });

      const result = parseResponse(response);
      expect(result.balance).toBe("0");
      expect(result.raw).toBe("0");
    });

    it("returns error for unknown token", async () => {
      const response = await callTool("starknet_get_balance", {
        token: "UNKNOWN_TOKEN",
      });

      expect(response.isError).toBe(true);
      const result = parseResponse(response);
      expect(result.error).toBe(true);
      expect(result.tool).toBe("starknet_get_balance");
    });
  });

  describe("starknet_register_agent", () => {
    it("is listed when ERC8004_IDENTITY_REGISTRY_ADDRESS is configured", async () => {
      if (!capturedListHandler) {
        throw new Error("List handler not captured - did the module load correctly?");
      }
      const resp = await capturedListHandler();
      const toolNames = resp.tools.map((t: any) => t.name);
      expect(toolNames).toContain("starknet_register_agent");
    });

    it("registers with token_uri and parses agent_id from receipt event keys (Registered)", async () => {
      mockExecute.mockResolvedValue({ transaction_hash: "0xabc" });
      mockWaitForTransaction.mockResolvedValue({
        events: [
          {
            from_address: mockEnv.ERC8004_IDENTITY_REGISTRY_ADDRESS,
            // Registered has agent_id as a #[key] u256, so it is encoded in event keys.
            keys: ["selector:Registered", "0x01", "0x00"],
            data: ["0xdead"],
          },
        ],
      });

      const response = await callTool("starknet_register_agent", {
        token_uri: "ipfs://demo",
        gasfree: false,
      });

      const result = parseResponse(response);
      expect(result.success).toBe(true);
      expect(result.transactionHash).toBe("0xabc");
      expect(result.agentId).toBe("1");

      // Ensure the tool invoked IdentityRegistry with the expected entrypoint.
      expect(mockExecute).toHaveBeenCalled();
      const callArg = mockExecute.mock.calls[0][0];
      expect(callArg.entrypoint).toBe("register_with_token_uri");
      expect(callArg.contractAddress).toBe(mockEnv.ERC8004_IDENTITY_REGISTRY_ADDRESS);
      expect(Array.isArray(callArg.calldata)).toBe(true);
      expect(callArg.calldata.length).toBeGreaterThan(0);
    });
  });

  describe("starknet_get_agent_info", () => {
    it("returns consolidated identity state and selected metadata", async () => {
      const starknet = await import("starknet");
      const decodeMock = (starknet as any).byteArray.stringFromByteArray as ReturnType<typeof vi.fn>;
      decodeMock
        .mockImplementationOnce(() => "Forecast Agent")
        .mockImplementationOnce(() => "active")
        .mockImplementationOnce(() => "ipfs://agent-info");

      mockCallContract
        .mockResolvedValueOnce(["0x1"]) // agent_exists
        .mockResolvedValueOnce([mockEnv.STARKNET_ACCOUNT_ADDRESS]) // owner_of
        .mockResolvedValueOnce([mockEnv.STARKNET_ACCOUNT_ADDRESS]) // get_agent_wallet
        .mockResolvedValueOnce(["0x0", "0x0", "0x0"]) // token_uri
        .mockResolvedValueOnce(["0x0", "0x0", "0x0"]) // metadata: agentName
        .mockResolvedValueOnce(["0x0", "0x0", "0x0"]); // metadata: status

      const response = await callTool("starknet_get_agent_info", {
        agent_id: "1",
        metadata_keys: ["agentName", "status"],
      });

      const result = parseResponse(response);
      expect(result.agentId).toBe("1");
      expect(result.exists).toBe(true);
      expect(result.identityRegistry).toBe(mockEnv.ERC8004_IDENTITY_REGISTRY_ADDRESS);
      expect(result.tokenUri).toBe("ipfs://agent-info");
      expect(result.metadata.agentName).toBe("Forecast Agent");
      expect(result.metadata.status).toBe("active");
    });

    it("returns exists=false for unknown agents", async () => {
      mockCallContract.mockResolvedValueOnce(["0x0"]);

      const response = await callTool("starknet_get_agent_info", {
        agent_id: "999",
      });

      const result = parseResponse(response);
      expect(result.exists).toBe(false);
      expect(result.agentId).toBe("999");
      expect(result.metadata).toEqual({});
    });

    it("rejects invalid metadata_keys type", async () => {
      const response = await callTool("starknet_get_agent_info", {
        agent_id: "1",
        metadata_keys: "agentName" as unknown as string[],
      });

      expect(response.isError).toBe(true);
      const result = parseResponse(response);
      expect(result.message).toContain("metadata_keys");
    });
  });

  describe("starknet_update_agent_metadata", () => {
    it("updates metadata via set_metadata entrypoint", async () => {
      mockExecute.mockResolvedValue({ transaction_hash: "0xmetaalias" });
      mockWaitForTransaction.mockResolvedValue({});

      const response = await callTool("starknet_update_agent_metadata", {
        agent_id: "1",
        key: "status",
        value: "paused",
      });

      const result = parseResponse(response);
      expect(result.success).toBe(true);
      expect(result.tool).toBe("starknet_update_agent_metadata");
      expect(result.key).toBe("status");
      expect(result.value).toBe("paused");

      const callArg = mockExecute.mock.calls[0][0];
      expect(callArg.entrypoint).toBe("set_metadata");
      expect(callArg.contractAddress).toBe(mockEnv.ERC8004_IDENTITY_REGISTRY_ADDRESS);
    });
  });

  describe("starknet_give_feedback", () => {
    it("submits feedback to ReputationRegistry", async () => {
      mockExecute.mockResolvedValue({ transaction_hash: "0xfeed123" });
      mockWaitForTransaction.mockResolvedValue({});

      const response = await callTool("starknet_give_feedback", {
        agent_id: "1",
        value: "85",
        value_decimals: 2,
        tag1: "accuracy",
        tag2: "weekly",
        feedback_uri: "ipfs://feedback-1",
      });

      const result = parseResponse(response);
      expect(result.success).toBe(true);
      expect(result.transactionHash).toBe("0xfeed123");
      expect(result.reputationRegistry).toBe(mockEnv.ERC8004_REPUTATION_REGISTRY_ADDRESS);
      expect(result.value).toBe("85");
      expect(result.valueDecimals).toBe(2);

      const callArg = mockExecute.mock.calls[0][0];
      expect(callArg.entrypoint).toBe("give_feedback");
      expect(callArg.contractAddress).toBe(mockEnv.ERC8004_REPUTATION_REGISTRY_ADDRESS);
    });

    it("rejects out-of-range value_decimals", async () => {
      const response = await callTool("starknet_give_feedback", {
        agent_id: "1",
        value: "1",
        value_decimals: 999,
      });

      expect(response.isError).toBe(true);
      const result = parseResponse(response);
      expect(result.message).toContain("value_decimals");
      expect(mockExecute).not.toHaveBeenCalled();
    });
  });

  describe("starknet_get_reputation", () => {
    it("reads aggregated summary from ReputationRegistry", async () => {
      mockCallContract.mockResolvedValueOnce(["0x2", "0x1f4", "0x2"]);

      const response = await callTool("starknet_get_reputation", {
        agent_id: "1",
        tag1: "accuracy",
      });

      const result = parseResponse(response);
      expect(result.agentId).toBe("1");
      expect(result.reputationRegistry).toBe(mockEnv.ERC8004_REPUTATION_REGISTRY_ADDRESS);
      expect(result.count).toBe("2");
      expect(result.summaryValueRaw).toBe("500");
      expect(result.valueDecimals).toBe(2);
      expect(result.summaryValue).toBe("5");
    });
  });

  describe("starknet_request_validation", () => {
    it("creates a validation request transaction", async () => {
      mockExecute.mockResolvedValue({ transaction_hash: "0xval123" });
      mockWaitForTransaction.mockResolvedValue({});

      const response = await callTool("starknet_request_validation", {
        validator_address: mockEnv.STARKNET_ACCOUNT_ADDRESS,
        agent_id: "1",
        request_uri: "ipfs://validation-req",
      });

      const result = parseResponse(response);
      expect(result.success).toBe(true);
      expect(result.transactionHash).toBe("0xval123");
      expect(result.validationRegistry).toBe(mockEnv.ERC8004_VALIDATION_REGISTRY_ADDRESS);
      expect(result.validatorAddress).toBe(mockEnv.STARKNET_ACCOUNT_ADDRESS);
      expect(result.agentId).toBe("1");

      const callArg = mockExecute.mock.calls[0][0];
      expect(callArg.entrypoint).toBe("validation_request");
      expect(callArg.contractAddress).toBe(mockEnv.ERC8004_VALIDATION_REGISTRY_ADDRESS);
    });

    it("rejects blank request_uri", async () => {
      const response = await callTool("starknet_request_validation", {
        validator_address: mockEnv.STARKNET_ACCOUNT_ADDRESS,
        agent_id: "1",
        request_uri: "   ",
      });

      expect(response.isError).toBe(true);
      const result = parseResponse(response);
      expect(result.message).toContain("request_uri");
      expect(mockExecute).not.toHaveBeenCalled();
    });
  });

  describe("starknet_get_balances", () => {
    it("returns multiple token balances", async () => {
      mockBalanceOf
        .mockResolvedValueOnce({ balance: { low: BigInt("1000000000000000000"), high: BigInt(0) } })
        .mockResolvedValueOnce({ balance: { low: BigInt("500000"), high: BigInt(0) } });

      const response = await callTool("starknet_get_balances", {
        tokens: ["ETH", "USDC"],
      });

      const result = parseResponse(response);
      expect(result.balances).toHaveLength(2);
      expect(result.tokensQueried).toBe(2);
    });

    it("returns error for empty tokens array", async () => {
      const response = await callTool("starknet_get_balances", {
        tokens: [],
      });

      expect(response.isError).toBe(true);
      const result = parseResponse(response);
      expect(result.message).toContain("At least one token is required");
    });

    it("returns error for duplicate tokens", async () => {
      const response = await callTool("starknet_get_balances", {
        tokens: ["ETH", "ETH"],
      });

      expect(response.isError).toBe(true);
      const result = parseResponse(response);
      expect(result.message).toContain("Duplicate tokens");
    });
  });

  describe("starknet_transfer", () => {
    const recipient = "0x0111111111111111111111111111111111111111111111111111111111111111";

    it("executes transfer without gasfree mode", async () => {
      mockExecute.mockResolvedValue({ transaction_hash: "0xabc123" });
      mockWaitForTransaction.mockResolvedValue({});

      const response = await callTool("starknet_transfer", {
        recipient,
        token: "ETH",
        amount: "1.5",
      });

      const result = parseResponse(response);
      expect(result.success).toBe(true);
      expect(result.transactionHash).toBe("0xabc123");
      expect(result.recipient).toBe(recipient);
      expect(result.token).toBe("ETH");
      expect(result.amount).toBe("1.5");
      expect(result.gasfree).toBe(false);
      expect(mockExecute).toHaveBeenCalled();
    });

    it("executes transfer with gasfree mode (no API key)", async () => {
      mockExecutePaymasterTransaction.mockResolvedValue({ transaction_hash: "0xpaymaster456" });
      mockWaitForTransaction.mockResolvedValue({});

      const response = await callTool("starknet_transfer", {
        recipient,
        token: "USDC",
        amount: "100",
        gasfree: true,
        gasToken: "STRK",
      });

      const result = parseResponse(response);
      expect(result.success).toBe(true);
      expect(result.transactionHash).toBe("0xpaymaster456");
      expect(result.gasfree).toBe(true);
      expect(mockExecutePaymasterTransaction).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          feeMode: expect.objectContaining({ mode: "default" }),
        }),
        expect.anything(),
      );
    });

    it("handles decimal amounts correctly", async () => {
      mockExecute.mockResolvedValue({ transaction_hash: "0xdef789" });
      mockWaitForTransaction.mockResolvedValue({});

      await callTool("starknet_transfer", {
        recipient,
        token: "USDC",
        amount: "0.5",
      });

      // USDC has 6 decimals, so 0.5 USDC = 500000 wei
      expect(mockExecute).toHaveBeenCalled();
    });

    it("returns error on transaction failure", async () => {
      mockExecute.mockRejectedValue(new Error("Transaction reverted"));

      const response = await callTool("starknet_transfer", {
        recipient,
        token: "ETH",
        amount: "1",
      });

      expect(response.isError).toBe(true);
      const result = parseResponse(response);
      expect(result.error).toBe(true);
    });
  });

  describe("starknet_call_contract", () => {
    const contractAddress = "0x0222222222222222222222222222222222222222222222222222222222222222";

    it("calls contract and returns result", async () => {
      mockCallContract.mockResolvedValue(["0x1", "0x2", "0x3"]);

      const response = await callTool("starknet_call_contract", {
        contractAddress,
        entrypoint: "get_owner",
      });

      const result = parseResponse(response);
      expect(result.result).toEqual(["0x1", "0x2", "0x3"]);
      expect(result.contractAddress).toBe(contractAddress);
      expect(result.entrypoint).toBe("get_owner");
    });

    it("passes calldata to contract", async () => {
      mockCallContract.mockResolvedValue({ result: ["0x100"] });

      await callTool("starknet_call_contract", {
        contractAddress,
        entrypoint: "balanceOf",
        calldata: ["0x123"],
      });

      expect(mockCallContract).toHaveBeenCalledWith({
        contractAddress,
        entrypoint: "balanceOf",
        calldata: ["0x123"],
      });
    });

    it("normalizes decimal calldata to 0x-prefixed felt", async () => {
      mockCallContract.mockResolvedValue({ result: ["0x1"] });

      await callTool("starknet_call_contract", {
        contractAddress,
        entrypoint: "balanceOf",
        calldata: ["100"],
      });

      expect(mockCallContract).toHaveBeenCalledWith({
        contractAddress,
        entrypoint: "balanceOf",
        calldata: ["0x64"],
      });
    });

    it("handles result wrapped in object", async () => {
      mockCallContract.mockResolvedValue({ result: ["0x42"] });

      const response = await callTool("starknet_call_contract", {
        contractAddress,
        entrypoint: "get_value",
      });

      const result = parseResponse(response);
      expect(result.result).toEqual(["0x42"]);
    });
  });

  describe("starknet_invoke_contract", () => {
    const contractAddress = "0x0333333333333333333333333333333333333333333333333333333333333333";

    it("invokes contract without gasfree mode", async () => {
      mockExecute.mockResolvedValue({ transaction_hash: "0xinvoke123" });
      mockWaitForTransaction.mockResolvedValue({});

      const response = await callTool("starknet_invoke_contract", {
        contractAddress,
        entrypoint: "set_value",
        calldata: ["0x42"],
      });

      const result = parseResponse(response);
      expect(result.success).toBe(true);
      expect(result.transactionHash).toBe("0xinvoke123");
      expect(result.contractAddress).toBe(contractAddress);
      expect(result.entrypoint).toBe("set_value");
      expect(result.gasfree).toBe(false);
    });

    it("invokes contract with gasfree mode", async () => {
      mockEstimatePaymasterTransactionFee.mockResolvedValue({
        suggested_max_fee_in_gas_token: "0x0",
      });
      mockExecutePaymasterTransaction.mockResolvedValue({
        transaction_hash: "0xgasfree789",
      });
      mockWaitForTransaction.mockResolvedValue({});

      const response = await callTool("starknet_invoke_contract", {
        contractAddress,
        entrypoint: "transfer",
        calldata: [
          "0x0111111111111111111111111111111111111111111111111111111111111111",
          "100",
        ],
        gasfree: true,
      });

      const result = parseResponse(response);
      expect(result.success).toBe(true);
      expect(mockExecutePaymasterTransaction).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          feeMode: expect.objectContaining({ mode: "default" }),
        }),
        expect.anything()
      );
    });
  });

  describe("starknet_build_calls", () => {
    const contractAddress = "0x0222222222222222222222222222222222222222222222222222222222222222";

    it("returns validated unsigned calls", async () => {
      const response = await callTool("starknet_build_calls", {
        calls: [
          {
            contractAddress,
            entrypoint: "transfer",
            calldata: ["0x123", "0x64"],
          },
        ],
      });

      const result = parseResponse(response);
      expect(result.calls).toHaveLength(1);
      expect(result.calls[0].contractAddress).toBe(contractAddress);
      expect(result.calls[0].entrypoint).toBe("transfer");
      expect(result.calls[0].calldata).toEqual(["0x123", "0x64"]);
      expect(result.callCount).toBe(1);
      expect(result.note).toContain("Unsigned");
      // Must NOT trigger execution
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("handles multiple calls (multicall)", async () => {
      const addr2 = "0x0333333333333333333333333333333333333333333333333333333333333333";
      const response = await callTool("starknet_build_calls", {
        calls: [
          { contractAddress, entrypoint: "approve", calldata: ["0xabc", "0x100"] },
          { contractAddress: addr2, entrypoint: "swap", calldata: ["0x1"] },
        ],
      });

      const result = parseResponse(response);
      expect(result.calls).toHaveLength(2);
      expect(result.callCount).toBe(2);
      expect(result.calls[0].entrypoint).toBe("approve");
      expect(result.calls[1].entrypoint).toBe("swap");
    });

    it("normalizes decimal calldata to hex", async () => {
      const response = await callTool("starknet_build_calls", {
        calls: [
          { contractAddress, entrypoint: "set_value", calldata: ["100"] },
        ],
      });

      const result = parseResponse(response);
      expect(result.calls[0].calldata).toEqual(["0x64"]);
    });

    it("rejects empty calls array", async () => {
      const response = await callTool("starknet_build_calls", {
        calls: [],
      });

      expect(response.isError).toBe(true);
      const result = parseResponse(response);
      expect(result.message).toContain("must not be empty");
    });

    it("rejects invalid contract address", async () => {
      mockValidateAndParseAddress.mockImplementationOnce(() => {
        throw new Error("Invalid address format");
      });

      const response = await callTool("starknet_build_calls", {
        calls: [
          { contractAddress: "bad", entrypoint: "foo" },
        ],
      });

      expect(response.isError).toBe(true);
      const result = parseResponse(response);
      expect(result.error).toBe(true);
    });

    it("rejects invalid calldata felt", async () => {
      const response = await callTool("starknet_build_calls", {
        calls: [
          { contractAddress, entrypoint: "foo", calldata: ["0xnotafelt"] },
        ],
      });

      expect(response.isError).toBe(true);
      const result = parseResponse(response);
      expect(result.error).toBe(true);
    });

    it("allows calls without calldata", async () => {
      const response = await callTool("starknet_build_calls", {
        calls: [
          { contractAddress, entrypoint: "get_count" },
        ],
      });

      const result = parseResponse(response);
      expect(result.calls).toHaveLength(1);
      expect(result.calls[0].calldata).toEqual([]);
    });
  });

  // ---- Input validation tests ----

  describe("input validation", () => {
    it("rejects invalid recipient address in starknet_transfer", async () => {
      mockValidateAndParseAddress.mockImplementationOnce(() => {
        throw new Error("Invalid address format");
      });

      const response = await callTool("starknet_transfer", {
        recipient: "not_an_address",
        token: "ETH",
        amount: "1",
      });

      expect(response.isError).toBe(true);
      const result = parseResponse(response);
      expect(result.error).toBe(true);
      expect(result.message).toMatch(/not a valid Starknet address/);
    });

    it("rejects invalid contractAddress in starknet_call_contract", async () => {
      mockValidateAndParseAddress.mockImplementationOnce(() => {
        throw new Error("Invalid address format");
      });

      const response = await callTool("starknet_call_contract", {
        contractAddress: "garbage",
        entrypoint: "get_owner",
      });

      expect(response.isError).toBe(true);
      const result = parseResponse(response);
      expect(result.error).toBe(true);
      expect(result.message).toMatch(/not a valid Starknet address/);
    });

    it("rejects invalid contractAddress in starknet_invoke_contract", async () => {
      mockValidateAndParseAddress.mockImplementationOnce(() => {
        throw new Error("Invalid address format");
      });

      const response = await callTool("starknet_invoke_contract", {
        contractAddress: "garbage",
        entrypoint: "set_value",
      });

      expect(response.isError).toBe(true);
      const result = parseResponse(response);
      expect(result.error).toBe(true);
      expect(result.message).toMatch(/not a valid Starknet address/);
    });

    it("rejects invalid calldata felt in starknet_call_contract", async () => {
      const response = await callTool("starknet_call_contract", {
        contractAddress: "0x0222222222222222222222222222222222222222222222222222222222222222",
        entrypoint: "balanceOf",
        calldata: ["0xrecipient"],
      });

      expect(response.isError).toBe(true);
      const result = parseResponse(response);
      expect(result.error).toBe(true);
      expect(result.message).toMatch(/calldata\[0\]/);
      expect(result.message).toMatch(/valid felt/);
    });

    it("rejects too-large calldata arrays in starknet_invoke_contract", async () => {
      const big = Array.from({ length: 300 }, () => "0x1");
      const response = await callTool("starknet_invoke_contract", {
        contractAddress: "0x0333333333333333333333333333333333333333333333333333333333333333",
        entrypoint: "set_value",
        calldata: big,
      });

      expect(response.isError).toBe(true);
      const result = parseResponse(response);
      expect(result.error).toBe(true);
      expect(result.message).toMatch(/calldata too large/i);
    });

    it("rejects malformed amount in starknet_transfer", async () => {
      const response = await callTool("starknet_transfer", {
        recipient: "0x0111111111111111111111111111111111111111111111111111111111111111",
        token: "ETH",
        amount: "1e18",
      });

      expect(response.isError).toBe(true);
      const result = parseResponse(response);
      expect(result.error).toBe(true);
      expect(result.message).toMatch(/Invalid amount/);
    });

    it("rejects negative amount in starknet_transfer", async () => {
      const response = await callTool("starknet_transfer", {
        recipient: "0x0111111111111111111111111111111111111111111111111111111111111111",
        token: "ETH",
        amount: "-5",
      });

      expect(response.isError).toBe(true);
      const result = parseResponse(response);
      expect(result.error).toBe(true);
      expect(result.message).toMatch(/Invalid amount/);
    });
  });

  describe("starknet_vesu_deposit", () => {
    const VTOKEN_STRK =
      "0x01a1b2c3d4e5f60708192a3b4c5d6e7f8090a1b2c3d4e5f60708192a3b4c5d6e";

    it("deposits to Vesu Prime pool successfully", async () => {
      mockCallContract.mockResolvedValueOnce([VTOKEN_STRK]);
      mockExecute.mockResolvedValue({ transaction_hash: "0xvesu123" });
      mockWaitForTransaction.mockResolvedValue({});

      const response = await callTool("starknet_vesu_deposit", {
        token: "STRK",
        amount: "10",
      });

      const result = parseResponse(response);
      expect(result.success).toBe(true);
      expect(result.transactionHash).toBe("0xvesu123");
      expect(result.token).toBe("STRK");
      expect(result.amount).toBe("10");
      expect(result.pool).toBe("prime");
      expect(mockExecute).toHaveBeenCalled();
    });

    it("uses custom pool when provided", async () => {
      mockCallContract.mockResolvedValueOnce([VTOKEN_STRK]);
      mockExecute.mockResolvedValue({ transaction_hash: "0xvesu456" });
      mockWaitForTransaction.mockResolvedValue({});

      const response = await callTool("starknet_vesu_deposit", {
        token: "USDC",
        amount: "100",
        pool: "0x0451fe483d5921a2919ddd81d0de6696669bccdacd859f72a4fba7656b97c3b5",
      });

      const result = parseResponse(response);
      expect(result.success).toBe(true);
      expect(mockCallContract).toHaveBeenCalledWith(
        expect.objectContaining({
          entrypoint: "v_token_for_asset",
        })
      );
    });

    it("returns error for invalid amount", async () => {
      const response = await callTool("starknet_vesu_deposit", {
        token: "STRK",
        amount: "1e18",
      });

      expect(response.isError).toBe(true);
      const result = parseResponse(response);
      expect(result.message).toMatch(/Invalid amount|Invalid decimal/);
    });

    it("returns error when vToken not found", async () => {
      mockCallContract.mockResolvedValueOnce([]);

      const response = await callTool("starknet_vesu_deposit", {
        token: "STRK",
        amount: "1",
      });

      expect(response.isError).toBe(true);
      const result = parseResponse(response);
      expect(result.message).toMatch(/vToken not found|not found/);
    });
  });

  describe("starknet_vesu_withdraw", () => {
    const VTOKEN_STRK =
      "0x01a1b2c3d4e5f60708192a3b4c5d6e7f8090a1b2c3d4e5f60708192a3b4c5d6e";

    it("withdraws from Vesu successfully", async () => {
      mockCallContract.mockResolvedValueOnce([VTOKEN_STRK]);
      mockExecute.mockResolvedValue({ transaction_hash: "0xwithdraw123" });
      mockWaitForTransaction.mockResolvedValue({});

      const response = await callTool("starknet_vesu_withdraw", {
        token: "STRK",
        amount: "5",
      });

      const result = parseResponse(response);
      expect(result.success).toBe(true);
      expect(result.transactionHash).toBe("0xwithdraw123");
      expect(result.token).toBe("STRK");
      expect(result.amount).toBe("5");
      expect(mockExecute).toHaveBeenCalled();
    });

    it("returns error for zero amount", async () => {
      const response = await callTool("starknet_vesu_withdraw", {
        token: "STRK",
        amount: "0",
      });

      expect(response.isError).toBe(true);
      const result = parseResponse(response);
      expect(result.message).toMatch(/Invalid amount|positive|zero/);
    });
  });

  describe("starknet_vesu_positions", () => {
    const VTOKEN_STRK =
      "0x01a1b2c3d4e5f60708192a3b4c5d6e7f8090a1b2c3d4e5f60708192a3b4c5d6e";

    it("returns lending positions for user", async () => {
      const oneEth = "0xde0b6b3a7640000"; // 1e18
      mockCallContract
        .mockResolvedValueOnce([VTOKEN_STRK])
        .mockResolvedValueOnce([oneEth, "0x0"])
        .mockResolvedValueOnce([oneEth, "0x0"]);

      const response = await callTool("starknet_vesu_positions", {
        tokens: ["STRK"],
      });

      const result = parseResponse(response);
      expect(result.positions).toBeDefined();
      expect(Array.isArray(result.positions)).toBe(true);
      expect(result.positions.length).toBeGreaterThan(0);
      expect(result.positions[0]).toHaveProperty("token");
      expect(result.positions[0]).toHaveProperty("tokenAddress");
      expect(result.positions[0]).toHaveProperty("shares");
      expect(result.positions[0]).toHaveProperty("assets");
    });

    it("returns error for empty tokens", async () => {
      const response = await callTool("starknet_vesu_positions", {
        tokens: [],
      });

      expect(response.isError).toBe(true);
      const result = parseResponse(response);
      expect(result.message).toMatch(/required|At least one/);
    });
  });

  describe("starknet_swap", () => {
    const mockQuote = {
      quoteId: "quote-123",
      sellTokenAddress: TOKENS.ETH,
      buyTokenAddress: TOKENS.USDC,
      sellAmount: BigInt(1e18),
      buyAmount: BigInt(3200e6),
      sellAmountInUsd: 3200,
      buyAmountInUsd: 3199.5,
      priceImpact: 15,
      gasFees: BigInt(0),
      gasFeesInUsd: 0.02,
      chainId: "SN_MAIN",
      routes: [
        { name: "Ekubo", percent: 0.8 },
        { name: "JediSwap", percent: 0.2 },
      ],
    };

    it("executes swap successfully", async () => {
      mockGetQuotes.mockResolvedValue([mockQuote]);
      mockQuoteToCalls.mockResolvedValue({
        calls: [
          { contractAddress: TOKENS.ETH, entrypoint: "approve", calldata: [] },
          { contractAddress: "0xrouter", entrypoint: "swap", calldata: [] },
        ],
        chainId: "SN_MAIN",
      });
      mockExecute.mockResolvedValue({ transaction_hash: "0xswap123" });
      mockWaitForTransaction.mockResolvedValue({});

      const response = await callTool("starknet_swap", {
        sellToken: "ETH",
        buyToken: "USDC",
        amount: "1",
      });

      const result = parseResponse(response);
      expect(result.success).toBe(true);
      expect(result.transactionHash).toBe("0xswap123");
      expect(result.sellToken).toBe("ETH");
      expect(result.buyToken).toBe("USDC");
    });

    it("returns error when no quotes available", async () => {
      mockGetQuotes.mockResolvedValue([]);

      const response = await callTool("starknet_swap", {
        sellToken: "ETH",
        buyToken: "USDC",
        amount: "1",
      });

      expect(response.isError).toBe(true);
      const result = parseResponse(response);
      expect(result.message).toContain("No swap routes available");
    });

    it("returns error for unknown token", async () => {
      const response = await callTool("starknet_swap", {
        sellToken: "ETH",
        buyToken: "UNKNOWN_TOKEN",
        amount: "1",
      });

      expect(response.isError).toBe(true);
      const result = parseResponse(response);
      expect(result.message).toContain("Failed to fetch token");
    });

    it("respects slippage parameter", async () => {
      mockGetQuotes.mockResolvedValue([mockQuote]);
      mockQuoteToCalls.mockResolvedValue({ calls: [], chainId: "SN_MAIN" });
      mockExecute.mockResolvedValue({ transaction_hash: "0x123" });
      mockWaitForTransaction.mockResolvedValue({});

      await callTool("starknet_swap", {
        sellToken: "ETH",
        buyToken: "USDC",
        amount: "1",
        slippage: 0.02,
      });

      expect(mockQuoteToCalls).toHaveBeenCalledWith(
        expect.objectContaining({ slippage: 0.02 }),
        expect.any(Object)
      );
    });
  });

  describe("starknet_get_quote", () => {
    const mockQuote = {
      quoteId: "quote-456",
      sellTokenAddress: TOKENS.ETH,
      buyTokenAddress: TOKENS.USDC,
      sellAmount: BigInt(1e18),
      buyAmount: BigInt(3200e6),
      sellAmountInUsd: 3200,
      buyAmountInUsd: 3199.5,
      priceImpact: 10,
      routes: [{ name: "Ekubo", percent: 1.0 }],
    };

    it("returns quote without executing", async () => {
      mockGetQuotes.mockResolvedValue([mockQuote]);

      const response = await callTool("starknet_get_quote", {
        sellToken: "ETH",
        buyToken: "USDC",
        amount: "1",
      });

      const result = parseResponse(response);
      expect(result.sellToken).toBe("ETH");
      expect(result.buyToken).toBe("USDC");
      expect(result.quoteId).toBe("quote-456");
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("formats price impact correctly", async () => {
      mockGetQuotes.mockResolvedValue([mockQuote]);

      const response = await callTool("starknet_get_quote", {
        sellToken: "ETH",
        buyToken: "USDC",
        amount: "1",
      });

      const result = parseResponse(response);
      expect(result.priceImpact).toBe("0.10%");
    });

    it("returns error when no quotes", async () => {
      mockGetQuotes.mockResolvedValue([]);

      const response = await callTool("starknet_get_quote", {
        sellToken: "ETH",
        buyToken: "UNKNOWN",
        amount: "1",
      });

      expect(response.isError).toBe(true);
    });
  });

  describe("starknet_estimate_fee", () => {
    it("returns fee estimation", async () => {
      mockEstimateInvokeFee.mockResolvedValue({
        overall_fee: BigInt("1000000000000000"),
        resourceBounds: {
          l1_gas: { max_amount: "1000", max_price_per_unit: "100000000" },
          l2_gas: { max_amount: "0", max_price_per_unit: "0" },
        },
        unit: "STRK",
      });

      const response = await callTool("starknet_estimate_fee", {
        contractAddress: "0x444",
        entrypoint: "test_function",
      });

      const result = parseResponse(response);
      expect(result.overallFee).toBe("0.001");
      expect(result.unit).toBe("STRK");
      expect(result.resourceBounds).toBeDefined();
    });

    it("passes calldata correctly", async () => {
      mockEstimateInvokeFee.mockResolvedValue({
        overall_fee: BigInt(0),
        resourceBounds: {},
      });

      await callTool("starknet_estimate_fee", {
        contractAddress: "0x555",
        entrypoint: "call_with_args",
        calldata: ["0x1", "0x2"],
      });

      expect(mockEstimateInvokeFee).toHaveBeenCalledWith(
        expect.objectContaining({
          entrypoint: "call_with_args",
          calldata: ["0x1", "0x2"],
        }),
      );
    });
  });

  describe("mini-pay MCP tools", () => {
    const recipient = "0x0111111111111111111111111111111111111111111111111111111111111111";

    it("creates a payment link", async () => {
      const response = await callTool("starknet_create_payment_link", {
        address: recipient,
        amount: "1.5",
        token: "USDC",
        memo: "coffee",
      });

      const result = parseResponse(response);
      expect(result.paymentLink).toContain("starknet:");
      expect(result.paymentLink).toContain("amount=1.5");
      expect(result.paymentLink).toContain("token=USDC");
      expect(result.paymentLink).toContain("memo=coffee");
      expect(result.address).toBe(recipient);
      expect(result.amountRaw).toBe("1500000");
    });

    it("parses a payment link", async () => {
      const response = await callTool("starknet_parse_payment_link", {
        paymentLink: `starknet:${recipient}?amount=2.25&token=USDC&memo=lunch`,
      });

      const result = parseResponse(response);
      expect(result.scheme).toBe("starknet");
      expect(result.address).toBe(recipient);
      expect(result.amount).toBe("2.25");
      expect(result.token).toBe("USDC");
      expect(result.memo).toBe("lunch");
      expect(result.amountRaw).toBe("2250000");
    });

    it("creates a stateless invoice and verifies paid status from transfer event", async () => {
      const invoiceResponse = await callTool("starknet_create_invoice", {
        recipient,
        amount: "1",
        token: "USDC",
        memo: "Invoice #1",
        expiresInSeconds: 3600,
      });

      const invoice = parseResponse(invoiceResponse);
      expect(invoice.invoiceId).toBeTruthy();
      expect(invoice.paymentLink).toContain("invoice=");
      expect(invoice.status).toBe("pending");

      mockWaitForTransaction.mockResolvedValue({
        execution_status: "SUCCEEDED",
        events: [
          {
            from_address: TOKENS.USDC,
            keys: ["selector:Transfer", "0xabc", recipient],
            data: ["0x0f4240", "0x0"], // 1_000_000 (1 USDC)
          },
        ],
      });

      const statusResponse = await callTool("starknet_get_invoice_status", {
        invoiceId: invoice.invoiceId,
        transactionHash: "0xpaid",
      });

      const status = parseResponse(statusResponse);
      expect(status.status).toBe("paid");
      expect(status.verification.matchedTransferCount).toBe(1);
      expect(status.verification.paidAmountRaw).toBe("1000000");
      expect(status.verification.requiredAmountRaw).toBe("1000000");
    });

    it("marks invoice underpaid when transfer amount is below requested amount", async () => {
      const invoiceResponse = await callTool("starknet_create_invoice", {
        recipient,
        amount: "1",
        token: "USDC",
      });
      const invoice = parseResponse(invoiceResponse);

      mockWaitForTransaction.mockResolvedValue({
        execution_status: "SUCCEEDED",
        events: [
          {
            from_address: TOKENS.USDC,
            keys: ["selector:Transfer", "0xabc", recipient],
            data: ["0x7a120", "0x0"], // 500_000 (0.5 USDC)
          },
        ],
      });

      const response = await callTool("starknet_get_invoice_status", {
        invoiceId: invoice.invoiceId,
        transactionHash: "0xunderpaid",
      });

      const result = parseResponse(response);
      expect(result.status).toBe("underpaid");
      expect(result.verification.paidAmountRaw).toBe("500000");
      expect(result.verification.requiredAmountRaw).toBe("1000000");
    });

    it("generates QR payload output", async () => {
      const response = await callTool("starknet_generate_qr", {
        content: "starknet:0xabc?amount=1&token=USDC",
      });

      const result = parseResponse(response);
      expect(result.format).toBe("data_url");
      expect(result.mimeType).toBe("image/svg+xml");
      expect(result.dataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
      expect(typeof result.qrBase64).toBe("string");
      expect(result.qrBase64.length).toBeGreaterThan(0);
    });
  });

  describe("x402_starknet_sign_payment_required", () => {
    it("signs payment and returns header", async () => {
      mockCreateStarknetPaymentSignatureHeader.mockResolvedValue({
        headerValue: "base64-encoded-signature",
        payload: { amount: "100", token: TOKENS.USDC },
      });

      const paymentHeader = Buffer.from(JSON.stringify({
        version: "1",
        amount: "100",
        token: TOKENS.USDC,
      })).toString("base64");

      const response = await callTool("x402_starknet_sign_payment_required", {
        paymentRequiredHeader: paymentHeader,
      });

      const result = parseResponse(response);
      expect(result.paymentSignatureHeader).toBe("base64-encoded-signature");
      expect(result.payload).toBeDefined();
    });

    it("uses env defaults when params not provided", async () => {
      mockCreateStarknetPaymentSignatureHeader.mockResolvedValue({
        headerValue: "sig",
        payload: {},
      });

      await callTool("x402_starknet_sign_payment_required", {
        paymentRequiredHeader: "test",
      });

      expect(mockCreateStarknetPaymentSignatureHeader).toHaveBeenCalledWith({
        paymentRequiredHeader: "test",
        rpcUrl: mockEnv.STARKNET_RPC_URL,
        accountAddress: mockEnv.STARKNET_ACCOUNT_ADDRESS,
        privateKey: mockEnv.STARKNET_PRIVATE_KEY,
      });
    });

    it("ignores extra params and always signs with env-configured account", async () => {
      mockCreateStarknetPaymentSignatureHeader.mockResolvedValue({
        headerValue: "sig",
        payload: {},
      });

      await callTool("x402_starknet_sign_payment_required", {
        paymentRequiredHeader: "test",
        // These are intentionally ignored to avoid signing arbitrary key material.
        rpcUrl: "https://custom.rpc.url",
        accountAddress: "0xcustom",
        privateKey: "0xprivate",
      });

      expect(mockCreateStarknetPaymentSignatureHeader).toHaveBeenCalledWith({
        paymentRequiredHeader: "test",
        rpcUrl: mockEnv.STARKNET_RPC_URL,
        accountAddress: mockEnv.STARKNET_ACCOUNT_ADDRESS,
        privateKey: mockEnv.STARKNET_PRIVATE_KEY,
      });
    });

    it("blocks x402 signing in proxy signer mode", async () => {
      process.env.STARKNET_SIGNER_MODE = "proxy";
      delete process.env.STARKNET_PRIVATE_KEY;

      vi.resetModules();
      await import("../../src/index.js");

      const response = await callTool("x402_starknet_sign_payment_required", {
        paymentRequiredHeader: "test",
      });

      expect(response.isError).toBe(true);
      const result = parseResponse(response);
      expect(result.message).toContain("disabled in STARKNET_SIGNER_MODE=proxy");
      expect(mockCreateStarknetPaymentSignatureHeader).not.toHaveBeenCalled();
    });
  });

  describe("starknet_deploy_agent_account", () => {
    beforeEach(async () => {
      process.env.AGENT_ACCOUNT_FACTORY_ADDRESS =
        "0x0fabcde01234567890abcdef01234567890abcdef01234567890abcdef01234";

      vi.resetModules();
      await import("../../src/index.js");
    });

    afterEach(() => {
      delete process.env.AGENT_ACCOUNT_FACTORY_ADDRESS;
    });

    it("deploys via factory and returns tx receipt-derived data", async () => {
      mockExecute.mockResolvedValue({ transaction_hash: "0xdeploy123" });
      mockWaitForTransaction.mockResolvedValue({
        events: [
          {
            from_address: process.env.AGENT_ACCOUNT_FACTORY_ADDRESS,
            keys: ["selector:AccountDeployed"],
            // account, public_key, agent_id.low, agent_id.high, registry
            data: ["0xabc", "0x1234", "0x2a", "0x0", "0xregistry"],
          },
        ],
      });

      const response = await callTool("starknet_deploy_agent_account", {
        public_key: "0x1234",
        token_uri: "ipfs://agent.json",
      });

      const result = parseResponse(response);
      expect(result.success).toBe(true);
      expect(result.transactionHash).toBe("0xdeploy123");
      expect(result.accountAddress).toBe("0xabc");
      expect(result.agentId).toBe("42");
      expect(result.factoryAddress).toBe(process.env.AGENT_ACCOUNT_FACTORY_ADDRESS);

      expect(mockExecute).toHaveBeenCalledTimes(1);
      const callArg = mockExecute.mock.calls[0][0];
      expect(callArg.contractAddress).toBe(process.env.AGENT_ACCOUNT_FACTORY_ADDRESS);
      expect(callArg.entrypoint).toBe("deploy_account");
    });

    it("returns clear error for zero public key", async () => {
      const response = await callTool("starknet_deploy_agent_account", {
        public_key: "0x0",
        token_uri: "ipfs://agent.json",
      });

      expect(response.isError).toBe(true);
      const result = parseResponse(response);
      expect(result.message).toContain("public_key must be non-zero felt");
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("propagates tx reverts", async () => {
      mockExecute.mockRejectedValue(new Error("factory revert: duplicate salt"));

      const response = await callTool("starknet_deploy_agent_account", {
        public_key: "0x1234",
        token_uri: "ipfs://agent.json",
      });

      expect(response.isError).toBe(true);
      const result = parseResponse(response);
      expect(result.message).toContain("factory revert");
    });

    it("returns clear error when factory env is missing", async () => {
      delete process.env.AGENT_ACCOUNT_FACTORY_ADDRESS;
      vi.resetModules();
      await import("../../src/index.js");

      const response = await callTool("starknet_deploy_agent_account", {
        public_key: "0x1234",
        token_uri: "ipfs://agent.json",
      });

      expect(response.isError).toBe(true);
      const result = parseResponse(response);
      expect(result.message).toContain("AGENT_ACCOUNT_FACTORY_ADDRESS not configured");
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("uses sponsored paymaster params when gasfree=true and API key is set", async () => {
      process.env.AVNU_PAYMASTER_API_KEY = "test-sponsor-key";
      vi.resetModules();
      await import("../../src/index.js");

      mockEstimatePaymasterTransactionFee.mockResolvedValue({
        suggested_max_fee_in_gas_token: "0x0",
      });
      mockExecutePaymasterTransaction.mockResolvedValue({
        transaction_hash: "0xdeploy-sponsored",
      });
      mockWaitForTransaction.mockResolvedValue({
        events: [
          {
            from_address: process.env.AGENT_ACCOUNT_FACTORY_ADDRESS,
            data: ["0xabc", "0x1234", "0x2a", "0x0", "0xregistry"],
          },
        ],
      });

      const response = await callTool("starknet_deploy_agent_account", {
        public_key: "0x1234",
        token_uri: "ipfs://agent.json",
        gasfree: true,
      });

      const result = parseResponse(response);
      expect(result.success).toBe(true);
      expect(mockExecutePaymasterTransaction).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          feeMode: expect.objectContaining({ mode: "sponsored" }),
        }),
        expect.anything()
      );

      delete process.env.AVNU_PAYMASTER_API_KEY;
    });

    it("returns clear error for out-of-range public key", async () => {
      const tooLarge = (1n << 251n).toString(); // 2^251, one above max allowed
      const response = await callTool("starknet_deploy_agent_account", {
        public_key: tooLarge,
        token_uri: "ipfs://demo",
      });

      expect(response.isError).toBe(true);
      const result = parseResponse(response);
      expect(result.message).toContain("public_key must fit in 251 bits");
    });

    it("returns clear error for out-of-range salt", async () => {
      const tooLarge = (1n << 251n).toString();
      const response = await callTool("starknet_deploy_agent_account", {
        public_key: "1",
        token_uri: "ipfs://demo",
        salt: tooLarge,
      });

      expect(response.isError).toBe(true);
      const result = parseResponse(response);
      expect(result.message).toContain("salt must fit in 251 bits");
    });
  });

  describe("starknet_set_agent_metadata", () => {
    it("sets metadata and returns tx hash", async () => {
      mockExecute.mockResolvedValue({ transaction_hash: "0xmeta123" });
      mockWaitForTransaction.mockResolvedValue({});

      const response = await callTool("starknet_set_agent_metadata", {
        agent_id: "1",
        key: "agentName",
        value: "My Trading Bot",
      });

      const result = parseResponse(response);
      expect(result.success).toBe(true);
      expect(result.transactionHash).toBe("0xmeta123");
      expect(result.agentId).toBe("1");
      expect(result.key).toBe("agentName");
      expect(result.value).toBe("My Trading Bot");

      expect(mockExecute).toHaveBeenCalled();
      const callArg = mockExecute.mock.calls[0][0];
      expect(callArg.entrypoint).toBe("set_metadata");
      expect(callArg.contractAddress).toBe(mockEnv.ERC8004_IDENTITY_REGISTRY_ADDRESS);
    });

    it("rejects reserved agentWallet key", async () => {
      const response = await callTool("starknet_set_agent_metadata", {
        agent_id: "1",
        key: "agentWallet",
        value: "0xabc",
      });

      expect(response.isError).toBe(true);
      const result = parseResponse(response);
      expect(result.message).toContain("agentWallet");
      expect(result.message).toContain("reserved");
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("rejects empty key", async () => {
      const response = await callTool("starknet_set_agent_metadata", {
        agent_id: "1",
        key: "",
        value: "test",
      });

      expect(response.isError).toBe(true);
      const result = parseResponse(response);
      expect(result.message).toContain("key is required");
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("supports gasfree mode", async () => {
      mockEstimatePaymasterTransactionFee.mockResolvedValue({
        suggested_max_fee_in_gas_token: "0x0",
      });
      mockExecutePaymasterTransaction.mockResolvedValue({
        transaction_hash: "0xmetapaymaster",
      });
      mockWaitForTransaction.mockResolvedValue({});

      const response = await callTool("starknet_set_agent_metadata", {
        agent_id: "1",
        key: "capabilities",
        value: "swap,arbitrage",
        gasfree: true,
      });

      const result = parseResponse(response);
      expect(result.success).toBe(true);
      expect(result.transactionHash).toBe("0xmetapaymaster");
      expect(mockExecutePaymasterTransaction).toHaveBeenCalled();
    });
  });

  describe("starknet_get_agent_metadata", () => {
    it("reads metadata and returns decoded value", async () => {
      // ByteArray: [data_len, ...data_words, pending_word, pending_word_len]
      mockCallContract.mockResolvedValue([
        "0x0",  // data_len = 0
        "0x4d79205472616469",  // pending_word
        "0x8",  // pending_word_len
      ]);

      const response = await callTool("starknet_get_agent_metadata", {
        agent_id: "1",
        key: "agentName",
      });

      const result = parseResponse(response);
      expect(result.agentId).toBe("1");
      expect(result.key).toBe("agentName");
      // The mock stringFromByteArray returns "TEST"
      expect(result.value).toBe("TEST");
      expect(result.identityRegistry).toBe(mockEnv.ERC8004_IDENTITY_REGISTRY_ADDRESS);
    });

    it("rejects empty key", async () => {
      const response = await callTool("starknet_get_agent_metadata", {
        agent_id: "1",
        key: "",
      });

      expect(response.isError).toBe(true);
      const result = parseResponse(response);
      expect(result.message).toContain("key is required");
      expect(mockCallContract).not.toHaveBeenCalled();
    });

    it("passes correct entrypoint to contract", async () => {
      mockCallContract.mockResolvedValue(["0x0", "0x0", "0x0"]);

      await callTool("starknet_get_agent_metadata", {
        agent_id: "42",
        key: "status",
      });

      expect(mockCallContract).toHaveBeenCalledWith(
        expect.objectContaining({
          contractAddress: mockEnv.ERC8004_IDENTITY_REGISTRY_ADDRESS,
          entrypoint: "get_metadata",
        })
      );
    });
  });

  describe("starknet_get_agent_passport", () => {
    it("reads and parses passport metadata", async () => {
      const starknet = await import("starknet");
      const decodeMock = (starknet as any).byteArray.stringFromByteArray as ReturnType<typeof vi.fn>;
      decodeMock
        .mockImplementationOnce(() => '["forecast"]') // caps
        .mockImplementationOnce(() => "https://starknet-agentic.dev/schemas/agent-passport.schema.json") // schema
        .mockImplementationOnce(() => '{"name":"forecast","category":"prediction","mcpTool":"starknet_call_contract"}'); // capability payload

      mockCallContract.mockResolvedValue(["0x0", "0x0", "0x0"]);

      const response = await callTool("starknet_get_agent_passport", {
        agent_id: "1",
      });

      const result = parseResponse(response);
      expect(result.agentId).toBe("1");
      expect(result.identityRegistry).toBe(mockEnv.ERC8004_IDENTITY_REGISTRY_ADDRESS);
      expect(result.caps).toEqual(["forecast"]);
      expect(result.capabilities).toHaveLength(1);
      expect(result.capabilities[0].name).toBe("forecast");
      expect(result.capabilities[0].category).toBe("prediction");
      expect(result.issues).toEqual([]);
    });

    it("returns missing payload issues for incomplete passport entries", async () => {
      const starknet = await import("starknet");
      const decodeMock = (starknet as any).byteArray.stringFromByteArray as ReturnType<typeof vi.fn>;
      decodeMock
        .mockImplementationOnce(() => '["forecast"]') // caps
        .mockImplementationOnce(() => ""); // schema

      mockCallContract
        .mockResolvedValueOnce(["0x0", "0x0", "0x0"]) // caps
        .mockResolvedValueOnce(["0x0", "0x0", "0x0"]) // schema
        .mockRejectedValueOnce(new Error("missing capability payload")); // capability

      const response = await callTool("starknet_get_agent_passport", {
        agent_id: "1",
      });

      const result = parseResponse(response);
      expect(result.caps).toEqual(["forecast"]);
      expect(result.capabilities).toEqual([]);
      expect(result.issues).toContain("Missing payload for capability:forecast");
    });
  });

  describe("skill ↔ MCP integration", () => {
    it("starknet-wallet skill MCP tools are exposed by the MCP server", async () => {
      if (!capturedListHandler) {
        throw new Error("List handler not captured - did the module load correctly?");
      }
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const repoRoot = path.resolve(__dirname, "../../../..");
      const skillPath = path.join(repoRoot, "skills/starknet-wallet/SKILL.md");

      const requiredTools = extractMcpToolsFromSkill(skillPath);
      const response = await capturedListHandler();
      const exposedTools = new Set(response.tools.map((tool: any) => tool.name));

      expect(requiredTools.length).toBeGreaterThan(0);
      for (const tool of requiredTools) {
        expect(exposedTools.has(tool)).toBe(true);
      }
    });

    it("starknet-defi skill MCP tools are exposed by the MCP server", async () => {
      if (!capturedListHandler) {
        throw new Error("List handler not captured - did the module load correctly?");
      }
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const repoRoot = path.resolve(__dirname, "../../../..");
      const skillPath = path.join(repoRoot, "skills/starknet-defi/SKILL.md");

      const requiredTools = extractMcpToolsFromSkill(skillPath);
      const response = await capturedListHandler();
      const exposedTools = new Set(response.tools.map((tool: any) => tool.name));

      expect(requiredTools.length).toBeGreaterThan(0);
      for (const tool of requiredTools) {
        expect(exposedTools.has(tool)).toBe(true);
      }
    });

    it("starknet-identity skill MCP tools are exposed by the MCP server", async () => {
      if (!capturedListHandler) {
        throw new Error("List handler not captured - did the module load correctly?");
      }
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const repoRoot = path.resolve(__dirname, "../../../..");
      const skillPath = path.join(repoRoot, "skills/starknet-identity/SKILL.md");

      const requiredTools = extractMcpToolsFromSkill(skillPath);
      const response = await capturedListHandler();
      const exposedTools = new Set(response.tools.map((tool: any) => tool.name));

      expect(requiredTools.length).toBeGreaterThan(0);
      for (const tool of requiredTools) {
        expect(exposedTools.has(tool)).toBe(true);
      }
    });

    it("starknet-mini-pay skill MCP tools are exposed by the MCP server", async () => {
      if (!capturedListHandler) {
        throw new Error("List handler not captured - did the module load correctly?");
      }
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const repoRoot = path.resolve(__dirname, "../../../..");
      const skillPath = path.join(repoRoot, "skills/starknet-mini-pay/SKILL.md");

      const requiredTools = extractMcpToolsFromSkill(skillPath);
      const response = await capturedListHandler();
      const exposedTools = new Set(response.tools.map((tool: any) => tool.name));

      expect(requiredTools.length).toBeGreaterThan(0);
      for (const tool of requiredTools) {
        expect(exposedTools.has(tool)).toBe(true);
      }
    });

    it("standalone skills declare explicit standalone execution rationale", async () => {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const repoRoot = path.resolve(__dirname, "../../../..");

      const anonymousWallet = readFileSync(
        path.join(repoRoot, "skills/starknet-anonymous-wallet/SKILL.md"),
        "utf8"
      );
      const huginnOnboard = readFileSync(
        path.join(repoRoot, "skills/huginn-onboard/SKILL.md"),
        "utf8"
      );

      expect(anonymousWallet).toMatch(/## Standalone Execution/i);
      expect(huginnOnboard).toMatch(/## Standalone Execution/i);
    });
  });

  describe("unknown tool", () => {
    it("returns error for unknown tool", async () => {
      const response = await callTool("unknown_tool", {});

      expect(response.isError).toBe(true);
      const result = parseResponse(response);
      expect(result.message).toContain("Unknown tool");
    });
  });

  describe("error formatting", () => {
    it("formats INSUFFICIENT_LIQUIDITY errors", async () => {
      mockGetQuotes.mockRejectedValue(new Error("INSUFFICIENT_LIQUIDITY"));

      const response = await callTool("starknet_swap", {
        sellToken: "ETH",
        buyToken: "USDC",
        amount: "1000000",
      });

      expect(response.isError).toBe(true);
      const result = parseResponse(response);
      expect(result.message).toContain("Insufficient liquidity");
    });

    it("formats SLIPPAGE errors", async () => {
      mockGetQuotes.mockResolvedValue([{ quoteId: "q1", buyAmount: BigInt(100) }]);
      mockQuoteToCalls.mockResolvedValue({ calls: [] });
      mockExecute.mockRejectedValue(new Error("SLIPPAGE exceeded"));

      const response = await callTool("starknet_swap", {
        sellToken: "ETH",
        buyToken: "USDC",
        amount: "1",
      });

      expect(response.isError).toBe(true);
      const result = parseResponse(response);
      expect(result.message).toContain("Slippage");
    });
  });
});

describe("MCP Startup Guardrails", () => {
  afterEach(() => {
    for (const key of Object.keys(mockEnv)) {
      delete process.env[key];
    }
    delete process.env.NODE_ENV;
  });

  it("fails startup in production when signer mode is direct", async () => {
    for (const [key, value] of Object.entries(mockEnv)) {
      process.env[key] = value;
    }
    process.env.NODE_ENV = "production";
    process.env.STARKNET_SIGNER_MODE = "direct";

    vi.resetModules();
    await expect(import("../../src/index.js")).rejects.toThrow(
      "Production mode requires STARKNET_SIGNER_MODE=proxy"
    );
  });

  it("starts in proxy signer mode without STARKNET_PRIVATE_KEY", async () => {
    for (const [key, value] of Object.entries(mockEnv)) {
      process.env[key] = value;
    }
    process.env.STARKNET_SIGNER_MODE = "proxy";
    delete process.env.STARKNET_PRIVATE_KEY;

    vi.resetModules();
    await import("../../src/index.js");

    expect(mockAccountConstructor).toHaveBeenCalled();
    const accountArgs = mockAccountConstructor.mock.calls.at(-1)?.[0];
    expect(typeof accountArgs?.signer).toBe("object");
    expect(typeof accountArgs?.signer?.signTransaction).toBe("function");
  });

  it("fails startup in proxy mode when keyring auth is missing", async () => {
    for (const [key, value] of Object.entries(mockEnv)) {
      process.env[key] = value;
    }
    process.env.STARKNET_SIGNER_MODE = "proxy";
    delete process.env.STARKNET_PRIVATE_KEY;
    delete process.env.KEYRING_HMAC_SECRET;

    vi.resetModules();
    await expect(import("../../src/index.js")).rejects.toThrow(
      "Missing keyring proxy configuration for STARKNET_SIGNER_MODE=proxy"
    );
  });

  it("fails startup in production proxy mode if direct private key is still set", async () => {
    for (const [key, value] of Object.entries(mockEnv)) {
      process.env[key] = value;
    }
    process.env.NODE_ENV = "production";
    process.env.STARKNET_SIGNER_MODE = "proxy";
    process.env.STARKNET_PRIVATE_KEY = "0x1";

    vi.resetModules();
    await expect(import("../../src/index.js")).rejects.toThrow(
      "STARKNET_PRIVATE_KEY must not be set in production when STARKNET_SIGNER_MODE=proxy"
    );
  });

  it("fails startup in production proxy mode when proxy URL is non-https and non-loopback", async () => {
    for (const [key, value] of Object.entries(mockEnv)) {
      process.env[key] = value;
    }
    process.env.NODE_ENV = "production";
    process.env.STARKNET_SIGNER_MODE = "proxy";
    process.env.KEYRING_PROXY_URL = "http://signer.internal:8545";
    delete process.env.STARKNET_PRIVATE_KEY;

    vi.resetModules();
    await expect(import("../../src/index.js")).rejects.toThrow(
      "Production proxy mode requires KEYRING_PROXY_URL to use https unless loopback is used"
    );
  });

  it("fails startup in production proxy mode when mTLS client cert config is missing", async () => {
    for (const [key, value] of Object.entries(mockEnv)) {
      process.env[key] = value;
    }
    process.env.NODE_ENV = "production";
    process.env.STARKNET_SIGNER_MODE = "proxy";
    process.env.KEYRING_PROXY_URL = "https://signer.internal:8545";
    delete process.env.STARKNET_PRIVATE_KEY;
    delete process.env.KEYRING_TLS_CLIENT_CERT_PATH;
    delete process.env.KEYRING_TLS_CLIENT_KEY_PATH;
    delete process.env.KEYRING_TLS_CA_PATH;

    vi.resetModules();
    await expect(import("../../src/index.js")).rejects.toThrow(
      "Production proxy mode requires KEYRING_TLS_CLIENT_CERT_PATH, KEYRING_TLS_CLIENT_KEY_PATH, and KEYRING_TLS_CA_PATH for mTLS"
    );
  });
});

describe("Tool list", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    capturedToolHandler = null;
    capturedListHandler = null;

    for (const [key, value] of Object.entries(mockEnv)) {
      process.env[key] = value;
    }

    // Suppress structured log output
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    vi.resetModules();
    await import("../../src/index.js");

    stderrSpy.mockRestore();
  });

  afterEach(() => {
    for (const key of Object.keys(mockEnv)) {
      delete process.env[key];
    }
  });

  it("lists all tools", async () => {
    if (!capturedListHandler) {
      throw new Error("List handler not captured");
    }

    const response = await capturedListHandler();

    expect(response.tools.length).toBeGreaterThanOrEqual(27);
    const toolNames = response.tools.map((t: any) => t.name);
    expect(toolNames).toContain("starknet_get_balance");
    expect(toolNames).toContain("starknet_get_balances");
    expect(toolNames).toContain("starknet_vesu_deposit");
    expect(toolNames).toContain("starknet_vesu_withdraw");
    expect(toolNames).toContain("starknet_vesu_positions");
    expect(toolNames).toContain("starknet_transfer");
    expect(toolNames).toContain("starknet_call_contract");
    expect(toolNames).toContain("starknet_invoke_contract");
    expect(toolNames).toContain("starknet_swap");
    expect(toolNames).toContain("starknet_get_quote");
    expect(toolNames).toContain("starknet_build_calls");
    expect(toolNames).toContain("starknet_register_session_key");
    expect(toolNames).toContain("starknet_revoke_session_key");
    expect(toolNames).toContain("starknet_get_session_data");
    expect(toolNames).toContain("starknet_build_transfer_calls");
    expect(toolNames).toContain("starknet_build_swap_calls");
    expect(toolNames).toContain("starknet_register_agent");
    expect(toolNames).toContain("starknet_get_agent_info");
    expect(toolNames).toContain("starknet_set_agent_metadata");
    expect(toolNames).toContain("starknet_update_agent_metadata");
    expect(toolNames).toContain("starknet_get_agent_metadata");
    expect(toolNames).toContain("starknet_get_agent_passport");
    expect(toolNames).toContain("starknet_give_feedback");
    expect(toolNames).toContain("starknet_get_reputation");
    expect(toolNames).toContain("starknet_request_validation");
    expect(toolNames).toContain("starknet_estimate_fee");
    expect(toolNames).toContain("starknet_create_payment_link");
    expect(toolNames).toContain("starknet_parse_payment_link");
    expect(toolNames).toContain("starknet_create_invoice");
    expect(toolNames).toContain("starknet_get_invoice_status");
    expect(toolNames).toContain("starknet_generate_qr");
    expect(toolNames).toContain("x402_starknet_sign_payment_required");
  });

  it("includes deploy tool when factory env is set", async () => {
    process.env.AGENT_ACCOUNT_FACTORY_ADDRESS =
      "0x0fabcde01234567890abcdef01234567890abcdef01234567890abcdef01234";

    let spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.resetModules();
    await import("../../src/index.js");
    spy.mockRestore();

    if (!capturedListHandler) {
      throw new Error("List handler not captured");
    }

    const response = await capturedListHandler();
    const toolNames = response.tools.map((t: any) => t.name);
    expect(toolNames).toContain("starknet_deploy_agent_account");
    expect(response.tools.length).toBeGreaterThanOrEqual(28);

    delete process.env.AGENT_ACCOUNT_FACTORY_ADDRESS;
  });

  it("does not list x402 signing tool in proxy mode", async () => {
    process.env.STARKNET_SIGNER_MODE = "proxy";
    delete process.env.STARKNET_PRIVATE_KEY;

    let spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.resetModules();
    await import("../../src/index.js");
    spy.mockRestore();

    if (!capturedListHandler) {
      throw new Error("List handler not captured");
    }

    const response = await capturedListHandler();
    const toolNames = response.tools.map((t: any) => t.name);
    expect(toolNames).not.toContain("x402_starknet_sign_payment_required");
  });
});
