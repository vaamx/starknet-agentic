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
    title: "Agentic Predictions | Starknet",
    description: "AI superforecaster agents as market makers on Starknet. On-chain accuracy tracking via ERC-8004.",
};
function RootLayout({ children, }) {
    return (<html lang="en" className={`${spaceGrotesk.variable} ${dmSans.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-screen bg-cream antialiased">{children}</body>
    </html>);
}
