interface LeaderboardEntry {
    agent: string;
    avgBrier: number;
    predictionCount: number;
    rank: number;
    identity?: {
        name: string;
        agentType: string;
        model: string;
        reputationScore: number;
        feedbackCount: number;
    } | null;
}
interface AgentLeaderboardProps {
    entries: LeaderboardEntry[];
    selectedAgent?: string | null;
    onSelectAgent?: (agent: string) => void;
}
export default function AgentLeaderboard({ entries, selectedAgent, onSelectAgent, }: AgentLeaderboardProps): import("react").JSX.Element;
export {};
