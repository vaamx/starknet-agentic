"use client";

import TamagotchiSVG from "./TamagotchiSVG";

interface TamagotchiEmptyStateProps {
  message?: string;
}

export default function TamagotchiEmptyState({
  message = "Nothing here yet...",
}: TamagotchiEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4">
      <TamagotchiSVG mood="offline" size={44} />
      <p className="text-sm text-white/40 font-mono">{message}</p>
    </div>
  );
}
