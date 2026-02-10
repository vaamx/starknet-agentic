import { mockFundingProvider } from "./mock-provider.js";
import { skippedFundingProvider } from "./skipped-provider.js";
import type { FundingProvider, FundingProviderName } from "./types.js";

export function getFundingProvider(name: FundingProviderName): FundingProvider {
  switch (name) {
    case "mock":
      return mockFundingProvider;
    case "skipped":
      return skippedFundingProvider;
    default: {
      const unreachable: never = name;
      throw new Error(`Unsupported funding provider: ${String(unreachable)}`);
    }
  }
}
