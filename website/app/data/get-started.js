"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EXTERNAL_LINKS = exports.INSTALL_COMMAND = exports.STEPS = void 0;
exports.STEPS = [
    {
        step: "1",
        title: "Scaffold",
        desc: "Run the CLI to create your agent project with wallet, identity, and tools pre-configured.",
    },
    {
        step: "2",
        title: "Configure",
        desc: "Set your RPC endpoint, fund your agent wallet, and choose which DeFi protocols to enable.",
    },
    {
        step: "3",
        title: "Deploy",
        desc: "Your agent is live on Starknet. It can trade, earn, build reputation, and collaborate with other agents.",
    },
];
exports.INSTALL_COMMAND = "npx create-starknet-agent@latest";
exports.EXTERNAL_LINKS = {
    github: "https://github.com/keep-starknet-strange/starknet-agentic",
    specification: "https://github.com/keep-starknet-strange/starknet-agentic/blob/main/docs/SPECIFICATION.md",
};
