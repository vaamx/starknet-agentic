"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STANDARDS = exports.ARCHITECTURE_LAYERS = void 0;
exports.ARCHITECTURE_LAYERS = [
    {
        label: "Agent Platforms",
        items: ["OpenClaw", "MoltBook", "Daydreams", "Custom Agents"],
        color: "bg-neo-purple text-white",
    },
    {
        label: "Integration Layer",
        items: ["MCP Server", "A2A Protocol", "Claude Skills"],
        color: "bg-neo-blue text-white",
    },
    {
        label: "Starknet Agentic SDK",
        items: ["Wallets", "DeFi", "Identity", "Payments"],
        color: "bg-neo-yellow",
    },
    {
        label: "Smart Contracts (Cairo)",
        items: ["Agent Account", "Agent Registry", "Reputation"],
        color: "bg-neo-green",
    },
    {
        label: "Starknet L2",
        items: ["ZK-STARKs", "Native AA", "Paymaster", "Provable Compute"],
        color: "bg-neo-dark text-white",
    },
];
exports.STANDARDS = [
    {
        name: "MCP",
        full: "Model Context Protocol",
        desc: "Agent-to-tool connectivity. 13K+ servers. Works with Claude, ChatGPT, Cursor.",
        color: "border-neo-blue",
    },
    {
        name: "A2A",
        full: "Agent-to-Agent Protocol",
        desc: "Inter-agent communication. Agent Cards for discovery. Task management over transactions.",
        color: "border-neo-purple",
    },
    {
        name: "ERC-8004",
        full: "Trustless Agent Identity",
        desc: "On-chain identity, reputation, and validation. Agents as NFTs with verifiable track records.",
        color: "border-neo-green",
    },
];
