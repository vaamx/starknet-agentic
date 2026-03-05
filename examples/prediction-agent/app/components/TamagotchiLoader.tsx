"use client";

import TamagotchiSVG from "./TamagotchiSVG";

interface TamagotchiLoaderProps {
  text?: string;
  size?: "default" | "large";
}

export default function TamagotchiLoader({
  text = "Scanning the hive...",
  size = "default",
}: TamagotchiLoaderProps) {
  const svgSize = size === "large" ? 64 : 44;

  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4">
      <div className="tama-svg-loading">
        <TamagotchiSVG mood="focus" size={svgSize} />
      </div>
      <p className="max-w-[85vw] text-center break-words text-sm text-white/40 font-mono animate-pulse">{text}</p>
    </div>
  );
}
