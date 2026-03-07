"use client";

import { ReactNode } from "react";
import { sepolia } from "@starknet-react/chains";
import {
  StarknetConfig,
  publicProvider,
  argent,
  braavos,
  voyager,
} from "@starknet-react/core";

// Create connectors statically to avoid useInjectedConnectors hook
// which uses useMemo internally and conflicts with wallet extension
// SES lockdown (causes React error #310).
const connectors = [argent(), braavos()];

export default function StarknetProvider({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <StarknetConfig
      chains={[sepolia]}
      provider={publicProvider()}
      connectors={connectors}
      explorer={voyager}
    >
      {children}
    </StarknetConfig>
  );
}
