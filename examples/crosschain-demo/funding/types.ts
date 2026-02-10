export type FundingProviderSelection = "auto" | "mock" | "skipped";
export type FundingProviderName = "mock" | "skipped";
export type FundingStatus = "mock" | "skipped";

export interface FundingConfig {
  minDeployerBalanceWei: bigint;
}

export interface FundParams {
  targetAddress: string;
  amountWei: bigint;
  token: "ETH";
  network: string;
}

export interface FundResult {
  provider: FundingProviderName;
  status: FundingStatus;
  source_chain: string;
  source_tx_hash?: string;
  confirmed_at?: string;
  skipped_reason?: "already_funded";
  amount_wei?: string;
  token?: "ETH";
}

export interface FundingProvider {
  name: FundingProviderName;
  preflight(config: FundingConfig): Promise<void>;
  fund(params: FundParams): Promise<FundResult>;
}

