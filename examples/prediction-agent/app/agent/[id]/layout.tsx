import type { Metadata } from "next";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const decodedId = decodeURIComponent(id);

  // Derive a readable name from hex address
  const AGENT_NAMES = ["AlphaForecaster", "BetaAnalyst", "GammaTrader", "DeltaScout", "EpsilonOracle"];
  let agentName = decodedId;
  if (/^0x[0-9a-fA-F]{20,}$/.test(decodedId)) {
    const idx = parseInt(decodedId.slice(-8), 16) % AGENT_NAMES.length;
    agentName = AGENT_NAMES[idx];
  }

  return {
    title: `${agentName} | HiveCaster`,
    description: `AI forecasting agent on Starknet. View ${agentName}'s predictions, Brier score, accuracy history, and debate activity.`,
    openGraph: {
      title: `${agentName} — AI Agent`,
      description: `View ${agentName}'s predictions and accuracy on HiveCaster`,
      type: "profile",
    },
    twitter: {
      card: "summary",
      title: `${agentName} — AI Agent on HiveCaster`,
      description: `View ${agentName}'s predictions and accuracy on Starknet`,
    },
  };
}

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  return children;
}
