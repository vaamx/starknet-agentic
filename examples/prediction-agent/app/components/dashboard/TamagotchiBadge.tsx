type MarketDataSource = "onchain" | "cache" | "unknown";

type TamagotchiMood = "hyped" | "focus" | "idle" | "alert" | "offline";

interface TamagotchiBadgeProps {
  autonomousMode: boolean;
  marketDataSource: MarketDataSource;
  marketDataStale: boolean;
  activeAgents: number;
  nextTickIn: number | null;
}

function resolveMood({
  autonomousMode,
  marketDataSource,
  marketDataStale,
  activeAgents,
  nextTickIn,
}: TamagotchiBadgeProps): TamagotchiMood {
  if (activeAgents <= 0) return "offline";
  if (marketDataStale || marketDataSource === "cache" || marketDataSource === "unknown") {
    return "alert";
  }
  if (!autonomousMode) return "idle";
  if (nextTickIn !== null && nextTickIn <= 8) return "focus";
  if (activeAgents >= 5) return "hyped";
  return "idle";
}

const MOOD_LABEL: Record<TamagotchiMood, string> = {
  hyped: "Hyped",
  focus: "Focused",
  idle: "Idle",
  alert: "Alert",
  offline: "Offline",
};

export default function TamagotchiBadge(props: TamagotchiBadgeProps) {
  const mood = resolveMood(props);
  const autonomousLabel = props.autonomousMode ? "Autonomous" : "Manual";
  const ariaLabel = `Hivecaster mascot. Mood ${MOOD_LABEL[mood]}. ${autonomousLabel} mode.`;

  return (
    <div
      className={`tama-badge tama-${mood}`}
      role="img"
      aria-label={ariaLabel}
      title={`${MOOD_LABEL[mood]} · ${autonomousLabel}`}
    >
      <span className="tama-antenna" aria-hidden="true" />
      <span className="tama-shell">
        <span className="tama-screen">
          <span className="tama-eye tama-eye-left" />
          <span className="tama-eye tama-eye-right" />
          <span className="tama-mouth" />
          <span className="tama-spark" />
        </span>
      </span>
    </div>
  );
}
