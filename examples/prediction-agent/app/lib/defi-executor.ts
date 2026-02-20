import { getQuotes, quoteToCalls, type QuoteRequest } from "@avnu/avnu-sdk";
import { CallData } from "starknet";
import { config } from "./config";
import { getSignerMode, getActiveAccount, enforceAllowlist } from "./starknet-executor";

const TOKEN_ADDRESSES: Record<string, string> = {
  ETH: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
  STRK: config.COLLATERAL_TOKEN_ADDRESS,
  USDC: "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
};

const TOKEN_DECIMALS: Record<string, number> = {
  ETH: 18,
  STRK: 18,
  USDC: 6,
};

export interface DefiSwapResult {
  txHash: string;
  status: "success" | "error";
  error?: string;
}

export interface DefiQuoteResult {
  ok: boolean;
  error?: string;
  quote?: any;
}

function resolveTokenAddress(token: string): string {
  if (token.startsWith("0x")) return token;
  const key = token.toUpperCase();
  return TOKEN_ADDRESSES[key] ?? token;
}

function resolveTokenDecimals(token: string): number {
  const key = token.toUpperCase();
  return TOKEN_DECIMALS[key] ?? 18;
}

function toAmountWei(amount: number, decimals: number): bigint {
  const scaled = Math.round(amount * Math.pow(10, decimals));
  return BigInt(scaled);
}

function buildAllowanceCall(
  tokenAddress: string,
  spender: string,
  amount: bigint
) {
  const entrypoint = config.AGENT_ALLOWANCE_SELECTOR || "increase_allowance";
  const calldata =
    entrypoint === "increaseAllowance"
      ? CallData.compile({
          spender,
          addedValue: { low: amount, high: 0n },
        })
      : entrypoint === "increase_allowance"
        ? CallData.compile({
            spender,
            added_value: { low: amount, high: 0n },
          })
        : CallData.compile({
            spender,
            amount: { low: amount, high: 0n },
          });

  return {
    contractAddress: tokenAddress,
    entrypoint,
    calldata,
  };
}

export async function getAvnuQuote(
  sellToken: string,
  buyToken: string,
  amount: number
): Promise<DefiQuoteResult> {
  try {
    const account = getActiveAccount();
    if (!account) {
      return { ok: false, error: "No agent account configured" };
    }

    const sellAddress = resolveTokenAddress(sellToken);
    const buyAddress = resolveTokenAddress(buyToken);
    const decimals = resolveTokenDecimals(sellToken);
    const sellAmount = toAmountWei(amount, decimals);

    const quoteParams: QuoteRequest = {
      sellTokenAddress: sellAddress,
      buyTokenAddress: buyAddress,
      sellAmount,
      takerAddress: account.address,
    };

    const quotes = await getQuotes(quoteParams, {
      baseUrl: config.AVNU_BASE_URL || "https://starknet.api.avnu.fi",
    });

    if (!quotes || quotes.length === 0) {
      return { ok: false, error: "No quotes returned" };
    }

    return { ok: true, quote: quotes[0] };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Quote failed" };
  }
}

export async function executeAvnuSwap(params: {
  sellToken: string;
  buyToken: string;
  amount: number;
  slippage?: number;
}): Promise<DefiSwapResult> {
  const account = getActiveAccount();
  if (!account) {
    return { txHash: "", status: "error", error: "No agent account configured" };
  }

  try {
    const maxAmount = Number(config.AGENT_DEFI_MAX_STRK ?? "10");
    if (Number.isFinite(maxAmount) && params.amount > maxAmount) {
      return {
        txHash: "",
        status: "error",
        error: `Swap amount exceeds limit (${maxAmount}).`,
      };
    }

    const sellAddress = resolveTokenAddress(params.sellToken);
    const buyAddress = resolveTokenAddress(params.buyToken);
    const decimals = resolveTokenDecimals(params.sellToken);
    const sellAmount = toAmountWei(params.amount, decimals);

    const quoteParams: QuoteRequest = {
      sellTokenAddress: sellAddress,
      buyTokenAddress: buyAddress,
      sellAmount,
      takerAddress: account.address,
    };

    const quotes = await getQuotes(quoteParams, {
      baseUrl: config.AVNU_BASE_URL || "https://starknet.api.avnu.fi",
    });
    if (!quotes || quotes.length === 0) {
      return { txHash: "", status: "error", error: "No quotes available" };
    }

    const bestQuote = quotes[0];
    const signerMode = getSignerMode();

    const { calls } = await quoteToCalls(
      {
        quoteId: bestQuote.quoteId,
        takerAddress: account.address,
        slippage: params.slippage ?? 0.01,
        executeApprove: signerMode !== "session",
      },
      {
        baseUrl: config.AVNU_BASE_URL || "https://starknet.api.avnu.fi",
      }
    );

    let finalCalls = calls;

    if (signerMode === "session") {
      const router = calls[0]?.contractAddress;
      if (!router) {
        return { txHash: "", status: "error", error: "No router call in quote" };
      }
      const allowance = buildAllowanceCall(sellAddress, router, sellAmount);
      finalCalls = [allowance, ...calls];
    }

    enforceAllowlist(finalCalls);
    const result = await account.execute(finalCalls);

    return { txHash: result.transaction_hash, status: "success" };
  } catch (err: any) {
    return { txHash: "", status: "error", error: err?.message ?? "Swap failed" };
  }
}
