import {
  Account,
  CallData,
  ETransactionVersion,
  cairo,
  type RpcProvider,
} from "starknet";
import { TOKENS } from "../config.js";

export interface FirstActionResult {
  balances: Record<string, string>;
  verifyTxHash: string | null;
}

export async function firstAction(args: {
  provider: RpcProvider;
  accountAddress: string;
  privateKey: string;
  network: string;
  verifyTx: boolean;
}): Promise<FirstActionResult> {
  const { provider, accountAddress, privateKey, network, verifyTx } = args;

  const tokens = TOKENS[network] || {};
  const balances: Record<string, string> = {};

  for (const [symbol, tokenAddress] of Object.entries(tokens)) {
    try {
      const result = await provider.callContract({
        contractAddress: tokenAddress,
        entrypoint: "balance_of",
        calldata: [accountAddress],
      });

      const low = BigInt(result[0]);
      const high = BigInt(result[1]);
      const raw = low + (high << 128n);
      balances[symbol] = formatBalance(raw, 18);
    } catch {
      balances[symbol] = "0";
    }
  }

  let verifyTxHash: string | null = null;
  if (verifyTx) {
    const ethAddress =
      tokens.ETH ||
      "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

    const account = new Account({
      provider,
      address: accountAddress,
      signer: privateKey,
      transactionVersion: ETransactionVersion.V3,
    });

    const tx = await account.execute({
      contractAddress: ethAddress,
      entrypoint: "transfer",
      calldata: CallData.compile({
        recipient: accountAddress,
        amount: cairo.uint256(0),
      }),
    });

    await provider.waitForTransaction(tx.transaction_hash);
    verifyTxHash = tx.transaction_hash;
  }

  return { balances, verifyTxHash };
}

function formatBalance(raw: bigint, decimals: number): string {
  if (raw === 0n) {
    return "0";
  }

  const s = raw.toString();
  if (s.length <= decimals) {
    const frac = s.padStart(decimals, "0").replace(/0+$/, "");
    return frac ? `0.${frac}` : "0";
  }

  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}
