import { NextRequest, NextResponse } from "next/server";
import { registerQuestion } from "@/lib/market-reader";
import { RpcProvider } from "starknet";
import { config } from "@/lib/config";
import { requireWalletSession } from "@/lib/wallet-session";

const provider = new RpcProvider({ nodeUrl: config.STARKNET_RPC_URL });

export async function POST(req: NextRequest) {
  try {
    const auth = requireWalletSession(req);
    if (!auth.ok) return auth.response;
    const body = await req.json();
    const { txHash, question } = body;

    if (!txHash || typeof txHash !== "string") {
      return NextResponse.json({ error: "txHash is required" }, { status: 400 });
    }
    if (!question || typeof question !== "string") {
      return NextResponse.json({ error: "question is required" }, { status: 400 });
    }

    // Try to extract the market ID from the transaction receipt events
    let marketId: number | undefined;
    try {
      const receipt = await provider.waitForTransaction(txHash);
      const factoryAddress = config.MARKET_FACTORY_ADDRESS;
      const events = (receipt as any).events ?? [];
      for (const evt of events) {
        if (
          evt.from_address === factoryAddress &&
          evt.keys?.length >= 2 &&
          evt.data?.length >= 1
        ) {
          marketId = Number(BigInt(evt.keys[1]));
          break;
        }
      }
    } catch {
      // Receipt parsing failed — caller can retry later
    }

    if (marketId !== undefined) {
      registerQuestion(marketId, question.trim());
    }

    return NextResponse.json({
      registered: marketId !== undefined,
      marketId: marketId ?? null,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
