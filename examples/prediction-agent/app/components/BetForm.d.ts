interface BetFormProps {
    marketId: number;
    question: string;
    yesPool: string;
    noPool: string;
    totalPool: string;
    feeBps: number;
    impliedProbYes: number;
    onClose: () => void;
}
export default function BetForm({ marketId, question, yesPool, noPool, totalPool, feeBps, impliedProbYes, onClose, }: BetFormProps): import("react").JSX.Element;
export {};
