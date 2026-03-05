/**
 * Network-specific contract addresses and RPC endpoints.
 *
 * Used by the `deploy` subcommand to bootstrap sovereign agents on Starknet.
 * Mainnet addresses default to "0x0" until mainnet deployment.
 */

export const FACTORY_ADDRESS = {
  sepolia: "0x2f69e566802910359b438ccdb3565dce304a7cc52edbf9fd246d6ad2cd89ce4",
  mainnet: "0x0",  // pending mainnet deployment
} as const;

export const IDENTITY_REGISTRY = {
  sepolia: "0x72eb37b0389e570bf8b158ce7f0e1e3489de85ba43ab3876a0594df7231631",
  mainnet: "0x0",
} as const;

export const HUGINN_REGISTRY = {
  sepolia: "0x0",  // pending Sepolia deployment
  mainnet: "0x0",
} as const;

export const STRK_ADDRESS = {
  sepolia: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  mainnet: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
} as const;

export const RPC_URL = {
  sepolia: "https://rpc.starknet-testnet.lava.build",
  mainnet: "https://rpc.starknet.lava.build",
} as const;

export type SupportedNetwork = "sepolia" | "mainnet";

/** Starknet block explorer URLs */
export const EXPLORER_URL = {
  sepolia: "https://sepolia.starkscan.co",
  mainnet: "https://starkscan.co",
} as const;

/** STRK faucet (testnet only) */
export const FAUCET_URL = {
  sepolia: "https://blastapi.io/faucets/starknet-sepolia-strk",
  mainnet: null,
} as const;

/** Starkgate bridge URL */
export const STARKGATE_URL = "https://starkgate.starknet.io/";
