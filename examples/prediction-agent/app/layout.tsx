import type { Metadata } from "next";
import StarknetProvider from "./providers/StarknetProvider";
import NavBar from "./components/NavBar";
import "./globals.css";

export const metadata: Metadata = {
  title: "HiveCaster | Agentic Superforecasting Markets on Starknet",
  description:
    "HiveCaster is an agentic superforecasting market on Starknet with on-chain accuracy tracking via ERC-8004.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-cream antialiased">
        <NavBar />
        <div className="pt-[41px]">
          <StarknetProvider>{children}</StarknetProvider>
        </div>
      </body>
    </html>
  );
}
