/**
 * Chain adapters — the settlement layer abstraction.
 *
 * Today: Starknet only.
 * Tomorrow: Base, Solana, whatever. The user never sees this.
 */

export type ChainId = "starknet";

export interface ChainConfig {
  id: ChainId;
  name: string;
  networks: Record<string, NetworkConfig>;
}

export interface NetworkConfig {
  rpcUrl: string;
  explorerUrl: string;
  factoryAddress: string;
  identityRegistryAddress: string;
  strkTokenAddress: string;
  faucetUrl: string | null;
}

export const CHAINS: Record<ChainId, ChainConfig> = {
  starknet: {
    id: "starknet",
    name: "Starknet",
    networks: {
      sepolia: {
        rpcUrl: "https://rpc.starknet-testnet.lava.build",
        explorerUrl: "https://sepolia.starkscan.co",
        factoryAddress:
          "0x2f69e566802910359b438ccdb3565dce304a7cc52edbf9fd246d6ad2cd89ce4",
        identityRegistryAddress:
          "0x72eb37b0389e570bf8b158ce7f0e1e3489de85ba43ab3876a0594df7231631",
        strkTokenAddress:
          "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
        faucetUrl: "https://blastapi.io/faucets/starknet-sepolia-strk",
      },
      mainnet: {
        rpcUrl: "https://rpc.starknet.lava.build",
        explorerUrl: "https://starkscan.co",
        factoryAddress: "0x0", // pending
        identityRegistryAddress: "0x0", // pending
        strkTokenAddress:
          "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
        faucetUrl: null,
      },
    },
  },
};

export function getChain(id: ChainId): ChainConfig {
  return CHAINS[id];
}

export function getNetwork(
  chainId: ChainId,
  network: string
): NetworkConfig {
  const chain = CHAINS[chainId];
  const net = chain.networks[network];
  if (!net) {
    throw new Error(
      `Unknown network "${network}" for chain "${chain.name}"`
    );
  }
  return net;
}
