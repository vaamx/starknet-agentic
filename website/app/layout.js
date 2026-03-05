"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.metadata = void 0;
exports.default = RootLayout;
const google_1 = require("next/font/google");
require("./globals.css");
const spaceGrotesk = (0, google_1.Space_Grotesk)({
    subsets: ["latin"],
    variable: "--font-space-grotesk",
    display: "swap",
});
const dmSans = (0, google_1.DM_Sans)({
    subsets: ["latin"],
    variable: "--font-dm-sans",
    display: "swap",
});
const jetbrainsMono = (0, google_1.JetBrains_Mono)({
    subsets: ["latin"],
    variable: "--font-jetbrains-mono",
    display: "swap",
});
exports.metadata = {
    title: "Starknet Agentic | The Sovereign Agentic Era",
    description: "Build sovereign AI agents on Starknet. Verifiable computation, on-chain identity, trustless collaboration. The infrastructure layer for the agentic economy.",
    keywords: [
        "starknet",
        "ai agents",
        "autonomous agents",
        "zk proofs",
        "agentic economy",
        "verifiable computation",
        "on-chain identity",
        "defi",
        "cairo",
    ],
    openGraph: {
        title: "Starknet Agentic | The Sovereign Agentic Era",
        description: "Build sovereign AI agents on Starknet. Verifiable computation, on-chain identity, trustless collaboration.",
        url: "https://starknet-agentic.com",
        siteName: "Starknet Agentic",
        type: "website",
    },
    twitter: {
        card: "summary_large_image",
        title: "Starknet Agentic | The Sovereign Agentic Era",
        description: "Build sovereign AI agents on Starknet. Verifiable computation, on-chain identity, trustless collaboration.",
    },
};
function RootLayout({ children, }) {
    return (<html lang="en" className={`${spaceGrotesk.variable} ${dmSans.variable} ${jetbrainsMono.variable}`}>
      <body className="antialiased">{children}</body>
    </html>);
}
