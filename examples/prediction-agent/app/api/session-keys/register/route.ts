import { NextRequest, NextResponse } from "next/server";
import { CallData, RpcProvider } from "starknet";
import { config } from "@/lib/config";
import { buildSessionPolicyInput, toSessionPolicyCalldata } from "@/lib/session-policy";
import { getOwnerAccount } from "@/lib/starknet-executor";

const provider = new RpcProvider({ nodeUrl: config.STARKNET_RPC_URL });

function parseLimitToWei(value: unknown): bigint | null {
  if (value === null || value === undefined) return null;
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return BigInt(Math.round(num * 1e18));
}

export async function POST(request: NextRequest) {
  if (!config.SESSION_KEY_ADMIN_TOKEN) {
    return NextResponse.json(
      { error: "SESSION_KEY_ADMIN_TOKEN not configured" },
      { status: 400 }
    );
  }

  const token = request.headers.get("x-admin-token");
  if (!token || token !== config.SESSION_KEY_ADMIN_TOKEN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!config.AGENT_ADDRESS || !config.AGENT_SESSION_PUBLIC_KEY) {
    return NextResponse.json(
      { error: "AGENT_ADDRESS or AGENT_SESSION_PUBLIC_KEY missing" },
      { status: 400 }
    );
  }

  const account = getOwnerAccount();
  if (!account) {
    return NextResponse.json(
      { error: "Owner signer not configured (AGENT_PRIVATE_KEY missing)" },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const overrides = buildSessionPolicyInput({
    validAfter: typeof body.validAfter === "number" ? body.validAfter : undefined,
    validUntil: typeof body.validUntil === "number" ? body.validUntil : undefined,
    spendingLimitWei: parseLimitToWei(body.spendingLimitStrk) ?? undefined,
    spendingToken: typeof body.spendingToken === "string" ? body.spendingToken : undefined,
    allowedContract: typeof body.allowedContract === "string" ? body.allowedContract : undefined,
    maxCallsPerTx: typeof body.maxCallsPerTx === "number" ? body.maxCallsPerTx : undefined,
    spendingPeriodSecs:
      typeof body.spendingPeriodSecs === "number" ? body.spendingPeriodSecs : undefined,
  });

  let sessionKey: bigint;
  try {
    sessionKey = BigInt(config.AGENT_SESSION_PUBLIC_KEY);
  } catch {
    return NextResponse.json(
      { error: "Invalid AGENT_SESSION_PUBLIC_KEY" },
      { status: 400 }
    );
  }

  try {
    const tx = {
      contractAddress: config.AGENT_ADDRESS,
      entrypoint: "register_session_key",
      calldata: CallData.compile({
        key: sessionKey,
        policy: toSessionPolicyCalldata(overrides),
      }),
    };

    const result = await account.execute([tx]);
    await provider.waitForTransaction(result.transaction_hash);

    return NextResponse.json({
      status: "success",
      txHash: result.transaction_hash,
      policy: {
        validAfter: overrides.validAfter,
        validUntil: overrides.validUntil,
        spendingLimitWei: overrides.spendingLimitWei.toString(),
        spendingToken: overrides.spendingToken,
        allowedContract: overrides.allowedContract,
        maxCallsPerTx: overrides.maxCallsPerTx,
        spendingPeriodSecs: overrides.spendingPeriodSecs,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to register session key" },
      { status: 500 }
    );
  }
}
