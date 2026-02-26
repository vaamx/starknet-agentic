"use client";

function brierGrade(score: number): { label: string; cls: string } {
  if (score < 0.1) return { label: "S", cls: "bg-neo-green text-neo-dark" };
  if (score < 0.15) return { label: "A", cls: "bg-neo-blue text-white" };
  if (score < 0.2) return { label: "B", cls: "bg-neo-cyan text-neo-dark" };
  if (score < 0.3) return { label: "C", cls: "bg-neo-orange text-neo-dark" };
  return { label: "D", cls: "bg-neo-red text-white" };
}

export default function BrierGradeBadge({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-white/[0.06] text-[10px] font-bold text-white/30">
        –
      </span>
    );
  }

  const { label, cls } = brierGrade(score);
  return (
    <span
      className={`inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold ${cls}`}
      title={`Brier: ${score.toFixed(3)}`}
    >
      {label}
    </span>
  );
}
