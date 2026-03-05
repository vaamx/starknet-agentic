import type { Metadata } from "next";
import StarknetProvider from "./providers/StarknetProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "HiveCaster | Agentic Superforecasting Prediction Markets on Starknet",
  description:
    "HiveCaster is an agentic superforecasting prediction market on Starknet with on-chain accuracy tracking via ERC-8004.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-cream antialiased">
        <StarknetProvider>{children}</StarknetProvider>
      </body>
    </html>
  );
}
