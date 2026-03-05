/**
 * Autonomous Agent Loop — Core engine for continuous agent operation.
 *
 * Runs a periodic cycle where agents research, forecast, and bet on markets.
 * Maintains an action log and emits events for connected UI clients.
 */
export interface AgentAction {
    id: string;
    timestamp: number;
    agentId: string;
    agentName: string;
    type: "research" | "prediction" | "bet" | "discovery" | "error";
    marketId?: number;
    question?: string;
    detail: string;
    probability?: number;
    betAmount?: string;
    betOutcome?: "YES" | "NO";
    sourcesUsed?: string[];
}
export interface LoopStatus {
    isRunning: boolean;
    tickCount: number;
    lastTickAt: number | null;
    nextTickAt: number | null;
    activeAgentCount: number;
    intervalMs: number;
}
type LoopListener = (action: AgentAction) => void;
declare class AgentLoop {
    private isRunning;
    private intervalId?;
    private actionLog;
    private tickCount;
    private lastTickAt;
    private intervalMs;
    private listeners;
    private actionCounter;
    private analyzedMarkets;
    start(intervalMs?: number): void;
    stop(): void;
    getStatus(): LoopStatus;
    getActionLog(limit?: number): AgentAction[];
    subscribe(listener: LoopListener): () => void;
    private emit;
    private createAction;
    private tick;
    private runAgentOnMarkets;
}
/** Singleton agent loop instance */
export declare const agentLoop: AgentLoop;
export {};
