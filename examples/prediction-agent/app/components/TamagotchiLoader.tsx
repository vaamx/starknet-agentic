"use client";

interface TamagotchiLoaderProps {
  text?: string;
  size?: "default" | "large";
}

export default function TamagotchiLoader({
  text = "Scanning the hive...",
  size = "default",
}: TamagotchiLoaderProps) {
  const isLarge = size === "large";
  const badgeSize = isLarge ? 72 : 48;
  const shellWidth = isLarge ? 54 : 36;
  const shellHeight = isLarge ? 48 : 32;
  const shellMarginTop = isLarge ? 9 : 6;
  const shellRadius = isLarge ? 13 : 10;
  const screenWidth = isLarge ? 36 : 24;
  const screenHeight = isLarge ? 26 : 18;
  const screenRadius = isLarge ? 6 : 4;

  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4">
      <div className="tama-badge tama-focus tama-loading" style={{ width: badgeSize, height: badgeSize }}>
        <span className="tama-antenna" aria-hidden="true" />
        <span
          className="tama-shell"
          style={{ width: shellWidth, height: shellHeight, marginTop: shellMarginTop, borderRadius: shellRadius }}
        >
          <span className="tama-screen" style={{ width: screenWidth, height: screenHeight, borderRadius: screenRadius }}>
            <span className="tama-eye tama-eye-left tama-scan-eye" />
            <span className="tama-eye tama-eye-right tama-scan-eye" />
            <span className="tama-mouth" />
          </span>
        </span>
      </div>
      <p className="max-w-[85vw] text-center break-words text-sm text-white/40 font-mono animate-pulse">{text}</p>
    </div>
  );
}
