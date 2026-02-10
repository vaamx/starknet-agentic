import { mockFundingProvider } from "./mock-provider.js";
import { skippedFundingProvider } from "./skipped-provider.js";
import type { FundingProvider, FundingProviderName } from "./types.js";

export function getFundingProvider(name: FundingProviderName): FundingProvider {
  if (name === "mock") {
    return mockFundingProvider;
  }
  return skippedFundingProvider;
}

