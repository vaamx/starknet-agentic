import type { Metadata } from "next";
import StarknetProvider from "./providers/StarknetProvider";
import NavBar from "./components/NavBar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hivecaster | AI Superforecasters on Starknet",
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
        <StarknetProvider>
          <NavBar />
          {children}
        </StarknetProvider>
      </body>
    </html>
  );
}
