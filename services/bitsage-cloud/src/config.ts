/**
 * BitsagE Cloud — Environment configuration with Zod validation.
 */

import { z } from "zod";

const configSchema = z.object({
  /** Fly.io API token for creating / stopping machines. */
  FLY_API_TOKEN: z.string().min(1),
  /** Fly.io app name where agent machines are deployed. */
  FLY_APP_NAME: z.string().min(1),
  /** BitsagE operator Starknet address (deducts from escrow). */
  BITSAGE_OPERATOR_ADDRESS: z.string().startsWith("0x"),
  /** BitsagE operator private key. */
  BITSAGE_OPERATOR_PRIVATE_KEY: z.string().startsWith("0x"),
  /** BitsagE escrow contract address on Starknet. */
  BITSAGE_ESCROW_ADDRESS: z.string().startsWith("0x"),
  /** Starknet RPC URL. */
  STARKNET_RPC_URL: z.string().url(),
  /**
   * Starknet network identifier used in SNIP-12 typed-data domain.
   * Must match the chain the escrow contract is deployed on.
   */
  STARKNET_NETWORK: z.enum(["SN_SEPOLIA", "SN_MAIN"]).default("SN_SEPOLIA"),
  /**
   * Enable X-402 payment verification.
   * Default: "true". Set to "false" in development/testing only.
   */
  X402_ENABLED: z.string().default("true"),
  /** API listen port. */
  PORT: z.string().default("8080"),
  /** SQLite database path. */
  DATABASE_URL: z.string().default("./bitsage.db"),
});

export type Config = z.infer<typeof configSchema>;

function parseConfig(): Config {
  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `[bitsage-cloud] Missing or invalid environment variables:\n${missing}\n\n` +
      "Copy .env.example to .env and fill in the required values."
    );
  }
  return result.data;
}

export const config: Config = parseConfig();
