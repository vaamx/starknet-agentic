/**
 * BitsageCloudClient — SDK client for the BitsagE Cloud compute marketplace.
 *
 * Handles STRK escrow deposits, machine lifecycle, and heartbeats.
 * Automatically handles X-402 payment challenges for authenticated endpoints.
 */

import { Account, RpcProvider, CallData, uint256 } from "starknet";
import { withX402 } from "./x402.js";
import type {
  Machine,
  MachineConfig,
  MachineStatus,
  CreditBalance,
  HeartbeatResult,
  MachineTier,
} from "./types.js";
import { MACHINE_PRICING, BitsageInsufficientBalanceError } from "./types.js";

export interface BitsageCloudClientOptions {
  /** Base URL of the BitsagE Cloud API (e.g. "https://api.bitsage.cloud") */
  baseUrl: string;
  /** Starknet RPC endpoint */
  rpcUrl: string;
  /** Agent's Starknet account address */
  accountAddress: string;
  /** Agent's Starknet private key */
  privateKey: string;
  /** BitsagE escrow contract address on Starknet */
  escrowAddress?: string;
  /** STRK token address (defaults to Starknet mainnet STRK) */
  strkAddress?: string;
}

const DEFAULT_STRK =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

export class BitsageCloudClient {
  private readonly baseUrl: string;
  private readonly rpcUrl: string;
  private readonly accountAddress: string;
  private readonly privateKey: string;
  private readonly escrowAddress: string;
  private readonly strkAddress: string;

  constructor(opts: BitsageCloudClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.rpcUrl = opts.rpcUrl;
    this.accountAddress = opts.accountAddress;
    this.privateKey = opts.privateKey;
    this.escrowAddress = opts.escrowAddress ?? "";
    this.strkAddress = opts.strkAddress ?? DEFAULT_STRK;
  }

  // ── Credits ──────────────────────────────────────────────────────────────

  /**
   * Deposit STRK into the BitsagE escrow contract.
   * Requires the agent account to have approved the escrow contract first.
   *
   * @param strkAmount - Amount in human-readable STRK (e.g. 100 = 100 STRK).
   * @returns Transaction hash.
   */
  async depositCredits(strkAmount: number): Promise<string> {
    if (!this.escrowAddress) throw new Error("escrowAddress not configured");
    const provider = new RpcProvider({ nodeUrl: this.rpcUrl });
    const account = new Account({ provider, address: this.accountAddress, signer: this.privateKey });

    const amountWei = BigInt(Math.round(strkAmount * 1e18));
    const amountU256 = uint256.bnToUint256(amountWei);

    const calls = [
      // Approve escrow to spend STRK
      {
        contractAddress: this.strkAddress,
        entrypoint: "approve",
        calldata: CallData.compile({
          spender: this.escrowAddress,
          amount: amountU256,
        }),
      },
      // Deposit into escrow
      {
        contractAddress: this.escrowAddress,
        entrypoint: "deposit",
        calldata: CallData.compile({ amount: amountU256 }),
      },
    ];

    const result = await account.execute(calls);
    return result.transaction_hash;
  }

  /**
   * Get the agent's current credit balance from the on-chain escrow.
   * Uses the API endpoint which reads from the contract, but also provides
   * the estimated hours remaining at each tier.
   */
  async getCreditBalance(): Promise<CreditBalance> {
    const url = `${this.baseUrl}/credits/${this.accountAddress}`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "bitsage-cloud-sdk" },
    });
    if (!resp.ok) {
      throw new Error(`Failed to get balance: ${resp.status}`);
    }
    return resp.json() as Promise<CreditBalance>;
  }

  // ── Machines ─────────────────────────────────────────────────────────────

  /**
   * Create a new compute machine for this agent.
   * If X-402 is enabled on the server, the call is automatically signed.
   */
  async createMachine(config: MachineConfig): Promise<Machine> {
    return withX402<Machine>(
      (headers) =>
        fetch(`${this.baseUrl}/machines/create`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "bitsage-cloud-sdk",
            ...headers,
          },
          body: JSON.stringify(config),
        }),
      { rpcUrl: this.rpcUrl, accountAddress: this.accountAddress, privateKey: this.privateKey }
    );
  }

  /**
   * Send a heartbeat for a running machine.
   * Deducts compute cost from escrow. Returns ok:false + terminated:true if balance exhausted.
   */
  async heartbeatMachine(id: string): Promise<HeartbeatResult> {
    return withX402<HeartbeatResult>(
      (headers) =>
        fetch(`${this.baseUrl}/machines/${id}/heartbeat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "bitsage-cloud-sdk",
            ...headers,
          },
        }),
      { rpcUrl: this.rpcUrl, accountAddress: this.accountAddress, privateKey: this.privateKey }
    );
  }

  /**
   * Get the current state of a machine.
   */
  async getMachine(id: string): Promise<Machine> {
    const resp = await fetch(`${this.baseUrl}/machines/${id}`, {
      headers: { "User-Agent": "bitsage-cloud-sdk" },
    });
    if (!resp.ok) throw new Error(`getMachine failed: ${resp.status}`);
    return resp.json() as Promise<Machine>;
  }

  /**
   * Terminate a machine immediately.
   */
  async destroyMachine(id: string): Promise<void> {
    const resp = await fetch(`${this.baseUrl}/machines/${id}`, {
      method: "DELETE",
      headers: { "User-Agent": "bitsage-cloud-sdk" },
    });
    if (!resp.ok) throw new Error(`destroyMachine failed: ${resp.status}`);
  }

  /**
   * List all machines associated with this agent address.
   */
  async listMachines(): Promise<Machine[]> {
    const resp = await fetch(`${this.baseUrl}/machines?agent=${this.accountAddress}`, {
      headers: { "User-Agent": "bitsage-cloud-sdk" },
    });
    if (!resp.ok) throw new Error(`listMachines failed: ${resp.status}`);
    return resp.json() as Promise<Machine[]>;
  }
}

export { BitsageInsufficientBalanceError };
