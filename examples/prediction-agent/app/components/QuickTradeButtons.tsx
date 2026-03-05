"use client";

interface QuickTradeButtonsProps {
  yesPercent: number;
  noPercent: number;
  volume: string;
  onYes: () => void;
  onNo: () => void;
}

export default function QuickTradeButtons({
  yesPercent,
  noPercent,
  volume,
  onYes,
  onNo,
}: QuickTradeButtonsProps) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onYes}
        className="pill-btn-yes flex-1 group"
      >
        <span className="flex items-center justify-center gap-1.5">
          <span>Yes</span>
          <span className="font-mono text-xs opacity-80">{yesPercent}%</span>
        </span>
      </button>
      <button
        type="button"
        onClick={onNo}
        className="pill-btn-no flex-1 group"
      >
        <span className="flex items-center justify-center gap-1.5">
          <span>No</span>
          <span className="font-mono text-xs opacity-80">{noPercent}%</span>
        </span>
      </button>
      <span className="text-xs font-mono text-white/40 shrink-0 hidden sm:block">
        {volume} STRK
      </span>
    </div>
  );
}
