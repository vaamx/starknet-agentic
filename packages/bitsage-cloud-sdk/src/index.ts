/**
 * @starknet-agentic/bitsage-cloud-sdk
 *
 * SDK for BitsagE Cloud — STRK-native compute marketplace for sovereign agents.
 *
 * @example
 * ```typescript
 * import { BitsageCloudClient } from "@starknet-agentic/bitsage-cloud-sdk";
 *
 * const sdk = new BitsageCloudClient({
 *   baseUrl: "https://api.bitsage.cloud",
 *   rpcUrl: "https://rpc.starknet-testnet.lava.build",
 *   accountAddress: "0x...",
 *   privateKey: "0x...",
 * });
 *
 * const balance = await sdk.getCreditBalance();
 * const machine = await sdk.createMachine({ agentAddress: "0x...", tier: "nano" });
 * await sdk.heartbeatMachine(machine.id);
 * ```
 */

export { BitsageCloudClient, type BitsageCloudClientOptions } from "./client.js";
export {
  MACHINE_PRICING,
  HEARTBEAT_INTERVAL_SECS,
  heartbeatCostWei,
  BitsageInsufficientBalanceError,
  type Machine,
  type MachineConfig,
  type MachineStatus,
  type MachineTier,
  type CreditBalance,
  type HeartbeatResult,
} from "./types.js";
export { withX402 } from "./x402.js";
