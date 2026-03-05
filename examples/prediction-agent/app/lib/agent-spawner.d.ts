/**
 * Agent Spawner — Registry for human-created agents.
 *
 * Allows users to spawn custom forecasting agents with configurable
 * personas, budgets, and data source preferences.
 */
import { type AgentPersona } from "./agent-personas";
export interface AgentBudget {
    totalBudget: bigint;
    spent: bigint;
    maxBetSize: bigint;
}
export interface SpawnedAgent {
    id: string;
    name: string;
    persona: AgentPersona;
    budget: AgentBudget;
    createdAt: number;
    status: "running" | "paused" | "stopped";
    stats: {
        predictions: number;
        bets: number;
        pnl: bigint;
    };
}
export interface SpawnAgentConfig {
    name: string;
    personaId?: string;
    customSystemPrompt?: string;
    budgetStrk?: number;
    maxBetStrk?: number;
    preferredSources?: string[];
}
declare class AgentSpawnerRegistry {
    private agents;
    spawn(config: SpawnAgentConfig): SpawnedAgent;
    stop(agentId: string): void;
    pause(agentId: string): void;
    resume(agentId: string): void;
    remove(agentId: string): void;
    list(): SpawnedAgent[];
    getAgent(id: string): SpawnedAgent | null;
    private createCustomPersona;
}
/** Singleton spawner instance */
export declare const agentSpawner: AgentSpawnerRegistry;
/** Serializable agent representation for API responses */
export declare function serializeAgent(agent: SpawnedAgent): Record<string, unknown>;
export {};
