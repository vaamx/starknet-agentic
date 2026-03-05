import { Account, RpcProvider, CallData } from "starknet";
import { config } from "./config";
import { toScaled } from "./accuracy";

export type ExecutionSurface = "direct" | "starkzap" | "avnu";

export type TxErrorCode =
  | "NO_ACCOUNT"
  | "TRACKER_NOT_DEPLOYED"
  | "UNSUPPORTED_SURFACE"
  | "PROVIDER_UNAVAILABLE"
  | "EXECUTION_FAILED";

export interface TxResult {
  txHash: string;
  status: "success" | "error";
  executionSurface: ExecutionSurface;
  errorCode?: TxErrorCode;
  error?: string;
}

const provider = new RpcProvider({ nodeUrl: config.STARKNET_RPC_URL });

function resolveExecutionSurface(
  executionSurface?: ExecutionSurface
): ExecutionSurface {
  return executionSurface ?? config.EXECUTION_SURFACE;
}

function getAccount(): Account | null {
  if (!config.AGENT_PRIVATE_KEY || !config.AGENT_ADDRESS) return null;
  return new Account(provider, config.AGENT_ADDRESS, config.AGENT_PRIVATE_KEY);
}

function unsupportedSurfaceResult(
  executionSurface: ExecutionSurface,
  operation: "placeBet" | "recordPrediction" | "claimWinnings"
): TxResult {
  return {
    txHash: "",
    status: "error",
    executionSurface,
    errorCode: "UNSUPPORTED_SURFACE",
    error: `${operation} is not yet implemented for execution surface "${executionSurface}".`,
  };
}

async function loadStarkzapSdk(): Promise<any> {
  try {
    // Avoid static import so prediction-agent can run without hard requiring starkzap.
    const dynamicImport = new Function(
      "moduleName",
      "return import(moduleName)"
    ) as (moduleName: string) => Promise<any>;
    return await dynamicImport("starkzap");
  } catch {
    throw new Error(
      'Starkzap SDK is unavailable. Install it in examples/prediction-agent (e.g. `npm i starkzap`) and retry.'
    );
  }
}

function resolveStarkzapChainId(chainIdEnum: Record<string, unknown>): unknown {
  const chain = config.STARKNET_CHAIN_ID.toUpperCase();
  if (chain.includes("SEPOLIA")) {
    return chainIdEnum.SEPOLIA ?? chainIdEnum.SN_SEPOLIA;
  }
  return chainIdEnum.MAINNET ?? chainIdEnum.SN_MAIN;
}

async function placeBetDirect(
  marketAddress: string,
  outcome: 0 | 1,
  amount: bigint,
  collateralToken: string
): Promise<TxResult> {
  const account = getAccount();
  if (!account) {
    return {
      txHash: "",
      status: "error",
      executionSurface: "direct",
      errorCode: "NO_ACCOUNT",
      error: "No agent account configured",
    };
  }

  try {
    const approveTx = {
      contractAddress: collateralToken,
      entrypoint: "approve",
      calldata: CallData.compile({
        spender: marketAddress,
        amount: { low: amount, high: 0n },
      }),
    };

    const betTx = {
      contractAddress: marketAddress,
      entrypoint: "bet",
      calldata: CallData.compile({
        outcome,
        amount: { low: amount, high: 0n },
      }),
    };

    const result = await account.execute([approveTx, betTx]);
    await provider.waitForTransaction(result.transaction_hash);

    return {
      txHash: result.transaction_hash,
      status: "success",
      executionSurface: "direct",
    };
  } catch (err: any) {
    return {
      txHash: "",
      status: "error",
      executionSurface: "direct",
      errorCode: "EXECUTION_FAILED",
      error: err?.message ?? "Execution failed",
    };
  }
}

async function placeBetStarkzap(
  marketAddress: string,
  outcome: 0 | 1,
  amount: bigint,
  collateralToken: string
): Promise<TxResult> {
  if (!config.AGENT_PRIVATE_KEY) {
    return {
      txHash: "",
      status: "error",
      executionSurface: "starkzap",
      errorCode: "NO_ACCOUNT",
      error: "No agent private key configured",
    };
  }

  try {
    const sdkModule = await loadStarkzapSdk();
    const StarkSDK = sdkModule.StarkSDK;
    const StarkSigner = sdkModule.StarkSigner;
    const ChainId = sdkModule.ChainId;
    if (!StarkSDK || !StarkSigner || !ChainId) {
      throw new Error("Incomplete Starkzap SDK exports (StarkSDK/StarkSigner/ChainId)");
    }

    const chainId = resolveStarkzapChainId(ChainId as Record<string, unknown>);
    const sdk = new StarkSDK({
      rpcUrl: config.STARKNET_RPC_URL,
      chainId,
    });

    const wallet = await sdk.connectWallet({
      account: { signer: new StarkSigner(config.AGENT_PRIVATE_KEY) },
      feeMode: "user_pays",
    });

    await wallet.ensureReady({ deploy: "if_needed" });

    const approveTx = {
      contractAddress: collateralToken,
      entrypoint: "approve",
      calldata: CallData.compile({
        spender: marketAddress,
        amount: { low: amount, high: 0n },
      }),
    };

    const betTx = {
      contractAddress: marketAddress,
      entrypoint: "bet",
      calldata: CallData.compile({
        outcome,
        amount: { low: amount, high: 0n },
      }),
    };

    const calls = [approveTx, betTx];

    if (typeof wallet.preflight === "function") {
      const preflight = await wallet.preflight({
        calls,
        feeMode: "user_pays",
      });
      if (preflight && preflight.ok === false) {
        throw new Error(`starkzap preflight failed: ${preflight.reason ?? "unknown"}`);
      }
    }

    const execution = await wallet.execute(calls, { feeMode: "user_pays" });
    if (execution && typeof execution.wait === "function") {
      await execution.wait();
    }

    const txHash =
      execution?.transactionHash ??
      execution?.transaction_hash ??
      execution?.hash ??
      "";

    if (!txHash) {
      throw new Error("starkzap execute returned no transaction hash");
    }

    return {
      txHash,
      status: "success",
      executionSurface: "starkzap",
    };
  } catch (err: any) {
    const message = err?.message ?? "Execution failed";
    const providerUnavailable = /unavailable|install it|cannot find module|incomplete starkzap/i.test(
      message
    );
    return {
      txHash: "",
      status: "error",
      executionSurface: "starkzap",
      errorCode: providerUnavailable ? "PROVIDER_UNAVAILABLE" : "EXECUTION_FAILED",
      error: message,
    };
  }
}

async function recordPredictionDirect(
  marketId: number,
  probability: number
): Promise<TxResult> {
  const account = getAccount();
  if (!account) {
    return {
      txHash: "",
      status: "error",
      executionSurface: "direct",
      errorCode: "NO_ACCOUNT",
      error: "No agent account configured",
    };
  }

  const trackerAddress = config.ACCURACY_TRACKER_ADDRESS;
  if (trackerAddress === "0x0") {
    return {
      txHash: "",
      status: "error",
      executionSurface: "direct",
      errorCode: "TRACKER_NOT_DEPLOYED",
      error: "Accuracy tracker not deployed",
    };
  }

  try {
    const scaledProb = toScaled(probability);
    const tx = {
      contractAddress: trackerAddress,
      entrypoint: "record_prediction",
      calldata: CallData.compile({
        market_id: { low: BigInt(marketId), high: 0n },
        predicted_prob: { low: scaledProb, high: 0n },
      }),
    };

    const result = await account.execute([tx]);
    await provider.waitForTransaction(result.transaction_hash);

    return {
      txHash: result.transaction_hash,
      status: "success",
      executionSurface: "direct",
    };
  } catch (err: any) {
    return {
      txHash: "",
      status: "error",
      executionSurface: "direct",
      errorCode: "EXECUTION_FAILED",
      error: err?.message ?? "Execution failed",
    };
  }
}

async function claimWinningsDirect(marketAddress: string): Promise<TxResult> {
  const account = getAccount();
  if (!account) {
    return {
      txHash: "",
      status: "error",
      executionSurface: "direct",
      errorCode: "NO_ACCOUNT",
      error: "No agent account configured",
    };
  }

  try {
    const tx = {
      contractAddress: marketAddress,
      entrypoint: "claim",
      calldata: [],
    };

    const result = await account.execute([tx]);
    await provider.waitForTransaction(result.transaction_hash);

    return {
      txHash: result.transaction_hash,
      status: "success",
      executionSurface: "direct",
    };
  } catch (err: any) {
    return {
      txHash: "",
      status: "error",
      executionSurface: "direct",
      errorCode: "EXECUTION_FAILED",
      error: err?.message ?? "Execution failed",
    };
  }
}

export async function placeBet(
  marketAddress: string,
  outcome: 0 | 1,
  amount: bigint,
  collateralToken: string,
  executionSurface?: ExecutionSurface
): Promise<TxResult> {
  const surface = resolveExecutionSurface(executionSurface);
  if (surface === "direct") {
    return placeBetDirect(marketAddress, outcome, amount, collateralToken);
  }
  if (surface === "starkzap") {
    return placeBetStarkzap(marketAddress, outcome, amount, collateralToken);
  }
  return unsupportedSurfaceResult(surface, "placeBet");
}

export async function recordPrediction(
  marketId: number,
  probability: number,
  executionSurface?: ExecutionSurface
): Promise<TxResult> {
  const surface = resolveExecutionSurface(executionSurface);
  if (surface === "direct") {
    return recordPredictionDirect(marketId, probability);
  }
  return unsupportedSurfaceResult(surface, "recordPrediction");
}

export async function claimWinnings(
  marketAddress: string,
  executionSurface?: ExecutionSurface
): Promise<TxResult> {
  const surface = resolveExecutionSurface(executionSurface);
  if (surface === "direct") {
    return claimWinningsDirect(marketAddress);
  }
  return unsupportedSurfaceResult(surface, "claimWinnings");
}

export function isAgentConfigured(): boolean {
  return !!(config.AGENT_PRIVATE_KEY && config.AGENT_ADDRESS);
}

export function getAgentAddress(): string | null {
  return config.AGENT_ADDRESS ?? null;
}
