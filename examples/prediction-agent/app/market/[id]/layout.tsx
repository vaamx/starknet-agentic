import type { Metadata } from "next";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;

  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/markets/${id}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) throw new Error("fetch failed");
    const data = await res.json();
    const question = data.market?.question ?? `Market #${id}`;
    const prob = data.market?.impliedProbYes != null
      ? `${Math.round(data.market.impliedProbYes * 100)}% Yes`
      : "";

    return {
      title: `${question} | HiveCaster`,
      description: `${prob ? `${prob} — ` : ""}Prediction market on Starknet with AI agent forecasting. Trade, debate, and track accuracy on-chain.`,
      openGraph: {
        title: question,
        description: `${prob ? `${prob} — ` : ""}AI-powered prediction market on Starknet`,
        type: "website",
      },
      twitter: {
        card: "summary_large_image",
        title: question,
        description: `${prob ? `${prob} — ` : ""}AI-powered prediction market on Starknet`,
      },
    };
  } catch {
    return {
      title: `Market #${id} | HiveCaster`,
      description: "Prediction market on Starknet with AI agent forecasting.",
    };
  }
}

export default function MarketLayout({ children }: { children: React.ReactNode }) {
  return children;
}
