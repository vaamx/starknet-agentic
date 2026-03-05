/**
 * Agent Personas — Multi-Agent Forecasting Simulation
 *
 * Each persona represents a different forecasting methodology,
 * producing diverse probability estimates that aggregate into
 * the reputation-weighted consensus.
 */
export interface AgentPersona {
    id: string;
    name: string;
    agentType: string;
    model: string;
    systemPrompt: string;
    /** Bias factor: positive = optimistic, negative = pessimistic */
    biasFactor: number;
    /** Confidence level: higher = more extreme predictions */
    confidence: number;
    /** Data sources this persona prefers for research */
    preferredSources?: string[];
}
export declare const AGENT_PERSONAS: AgentPersona[];
/** Get a persona by ID. */
export declare function getPersona(id: string): AgentPersona | undefined;
/** Get all persona IDs. */
export declare function getPersonaIds(): string[];
/**
 * Generate a simulated forecast from a persona (no API key required).
 * Uses the persona's bias and confidence to modify a base probability.
 */
export declare function simulatePersonaForecast(persona: AgentPersona, baseMarketProb: number, question: string): {
    probability: number;
    reasoning: string;
};
