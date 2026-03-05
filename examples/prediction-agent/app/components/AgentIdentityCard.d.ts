interface AgentIdentityCardProps {
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
export default function AgentIdentityCard({ agent, avgBrier, predictionCount, rank, identity, }: AgentIdentityCardProps): import("react").JSX.Element;
export {};
