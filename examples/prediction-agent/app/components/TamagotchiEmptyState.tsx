"use client";

interface TamagotchiEmptyStateProps {
  message?: string;
}

export default function TamagotchiEmptyState({
  message = "Nothing here yet...",
}: TamagotchiEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4">
      <div className="tama-badge tama-offline" style={{ width: 48, height: 48 }}>
        <span className="tama-antenna" aria-hidden="true" />
        <span className="tama-shell" style={{ width: 36, height: 32, marginTop: 6, borderRadius: 10 }}>
          <span className="tama-screen" style={{ width: 24, height: 18, borderRadius: 4 }}>
            <span className="tama-eye tama-eye-left" />
            <span className="tama-eye tama-eye-right" />
            <span className="tama-mouth" />
          </span>
        </span>
      </div>
      <p className="text-sm text-white/40 font-mono">{message}</p>
    </div>
  );
}
