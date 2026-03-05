interface StatProps {
  label: string;
  value: string;
  accent?: boolean;
}

export default function Stat({ label, value, accent }: StatProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-mono uppercase tracking-wider text-white/50">
        {label}
      </span>
      <span
        className={`font-mono font-bold text-sm tabular-nums ${
          accent ? "text-neo-green" : "text-white"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
