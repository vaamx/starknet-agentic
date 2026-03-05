import { NextRequest, NextResponse } from "next/server";
import { CallData, RpcProvider } from "starknet";
import { config } from "@/lib/config";
import { getOwnerAccount } from "@/lib/starknet-executor";

const provider = new RpcProvider({ nodeUrl: config.STARKNET_RPC_URL });

function parseAddressList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v) => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
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

  if (!config.AGENT_ADDRESS) {
    return NextResponse.json(
      { error: "AGENT_ADDRESS missing" },
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
  const add = parseAddressList(body.add);
  const remove = parseAddressList(body.remove);
  const allowAll =
    typeof body.allowAll === "boolean" ? body.allowAll : undefined;

  if (add.length === 0 && remove.length === 0 && allowAll === undefined) {
    return NextResponse.json(
      { error: "No allowlist changes provided" },
      { status: 400 }
    );
  }

  const calls = [];
  if (allowAll !== undefined) {
    calls.push({
      contractAddress: config.AGENT_ADDRESS,
      entrypoint: "set_allow_all_contracts",
      calldata: CallData.compile({ enabled: allowAll }),
    });
  }

  for (const addr of add) {
    calls.push({
      contractAddress: config.AGENT_ADDRESS,
      entrypoint: "add_allowed_contract",
      calldata: CallData.compile({ contract: addr }),
    });
  }

  for (const addr of remove) {
    calls.push({
      contractAddress: config.AGENT_ADDRESS,
      entrypoint: "remove_allowed_contract",
      calldata: CallData.compile({ contract: addr }),
    });
  }

  try {
    const result = await account.execute(calls);
    await provider.waitForTransaction(result.transaction_hash);

    return NextResponse.json({
      status: "success",
      txHash: result.transaction_hash,
      allowAll,
      added: add,
      removed: remove,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to update allowlist" },
      { status: 500 }
    );
  }
}
