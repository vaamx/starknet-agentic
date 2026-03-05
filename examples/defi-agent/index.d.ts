/**
 * DeFi Agent Example
 *
 * A complete example showing how to build an autonomous DeFi agent on Starknet
 * using the starknet-agentic infrastructure stack.
 *
 * This agent:
 * 1. Monitors token prices
 * 2. Executes swaps when profitable opportunities arise
 * 3. Maintains on-chain identity and reputation
 * 4. Communicates via A2A protocol
 */
declare class DeFiAgent {
    private provider;
    private account;
    private isRunning;
    private tradeCount;
    constructor();
    /**
     * Start the agent
     */
    start(): Promise<void>;
    /**
     * Stop the agent
     */
    stop(): void;
    /**
     * Check wallet balance
     */
    private checkBalance;
    /**
     * Main monitoring loop
     */
    private monitorLoop;
    /**
     * Check for profitable trading opportunities
     */
    private checkOpportunities;
    /**
     * Find arbitrage opportunity between two tokens
     */
    private findArbitrage;
    /**
     * Execute arbitrage trade
     */
    private executeArbitrage;
    /**
     * Helper: Sleep for ms
     */
    private sleep;
    /**
     * Get agent stats
     */
    getStats(): {
        trades: number;
        address: any;
        isRunning: boolean;
    };
}
export default DeFiAgent;
