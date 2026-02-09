import { RpcProvider, Account, ETransactionVersion } from "starknet";
import { STARKNET_NETWORKS, TOKENS, type StarknetNetworkConfig } from "../config.js";

export interface PreflightResult {
  provider: RpcProvider;
  account: Account;
  networkConfig: StarknetNetworkConfig;
  network: string;
  chainId: string;
  balances: Record<string, string>;
}

export async function preflight(env: {
  network: string;
  rpcUrl?: string;
  accountAddress: string;
  privateKey: string;
}): Promise<PreflightResult> {
  const { network, accountAddress, privateKey } = env;
  const networkConfig = STARKNET_NETWORKS[network];

  if (!networkConfig) {
    throw new Error(
      `Unknown network "${network}". Available: ${Object.keys(STARKNET_NETWORKS).join(", ")}`,
    );
  }

  if (!networkConfig.factory || !networkConfig.registry) {
    throw new Error(
      `Factory or registry address not set for network "${network}". Update examples/crosschain-demo/config.ts first.`,
    );
  }

  const rpcUrl = env.rpcUrl || networkConfig.rpc;
  const provider = new RpcProvider({ nodeUrl: rpcUrl });
  const chainId = String(await provider.getChainId());

  const isSepoliaChain = chainId === "0x534e5f5345504f4c4941" || chainId === "SN_SEPOLIA";
  if (network === "sepolia" && !isSepoliaChain) {
    throw new Error(`Network is "sepolia" but chain returned ${chainId}. Check STARKNET_RPC_URL.`);
  }

  const account = new Account({
    provider,
    address: accountAddress,
    signer: privateKey,
    transactionVersion: ETransactionVersion.V3,
  });

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
      balances[symbol] = "error";
    }
  }

  return {
    provider,
    account,
    networkConfig,
    network,
    chainId,
    balances,
  };
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
