import TamagotchiSVG from "../TamagotchiSVG";
import type { TamagotchiMood } from "../TamagotchiSVG";

type MarketDataSource = "onchain" | "cache" | "unknown";

interface TamagotchiBadgeProps {
  autonomousMode: boolean;
  marketDataSource: MarketDataSource;
  marketDataStale: boolean;
  activeAgents: number;
  nextTickIn: number | null;
  size?: number;
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

  return (
    <TamagotchiSVG
      mood={mood}
      size={props.size ?? 32}
      className={`tama-badge-wrap`}
    />
  );
}
