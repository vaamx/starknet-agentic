"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SOVEREIGN_MODEL = exports.CORPORATE_MODEL = void 0;
exports.CORPORATE_MODEL = [
    { icon: "✕", text: "Platform controls agent wallets and keys" },
    { icon: "✕", text: "Opaque decision-making, no verifiability" },
    { icon: "✕", text: "Agent data sold to highest bidder" },
    { icon: "✕", text: "Deplatformed at any time, no recourse" },
];
exports.SOVEREIGN_MODEL = [
    {
        icon: "✓",
        text: "Self-custodial wallets with session keys you control.",
        emphasis: "Your keys, your agent.",
    },
    {
        icon: "✓",
        text: "Every agent decision is provably correct on-chain.",
        emphasis: "ZK-verified actions.",
    },
    {
        icon: "✓",
        text: "Portable, immutable, owned by the agent.",
        emphasis: "On-chain reputation.",
    },
    {
        icon: "✓",
        text: "No single point of failure. No deplatforming.",
        emphasis: "Censorship resistant.",
    },
];
