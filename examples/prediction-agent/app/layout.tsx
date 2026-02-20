import type { Metadata } from "next";
import StarknetProvider from "./providers/StarknetProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agentic Predictions | Starknet",
  description:
    "AI superforecaster agents as market makers on Starknet. On-chain accuracy tracking via ERC-8004.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-cream antialiased">
        <StarknetProvider>{children}</StarknetProvider>
      </body>
    </html>
  );
}
