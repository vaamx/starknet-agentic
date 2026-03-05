interface AgentPrediction {
    agent: string;
    predictedProb: number;
    brierScore: number;
    predictionCount: number;
}
interface MarketCardProps {
    id: number;
    question: string;
    impliedProbYes: number;
    impliedProbNo: number;
    totalPool: string;
    status: number;
    resolutionTime: number;
    agentConsensus?: number;
    predictions?: AgentPrediction[];
    onAnalyze: (marketId: number) => void;
    onBet: (marketId: number) => void;
}
export default function MarketCard({ id, question, impliedProbYes, totalPool, status, resolutionTime, agentConsensus, predictions, onAnalyze, onBet, }: MarketCardProps): import("react").JSX.Element;
export {};
