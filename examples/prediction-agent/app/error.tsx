"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-cream p-6">
      <div className="neo-card max-w-md w-full p-8 text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-neo-red/15 border border-neo-red/25 flex items-center justify-center mx-auto">
          <svg className="w-6 h-6 text-neo-red" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </div>
        <h2 className="font-heading font-bold text-lg text-white">Something went wrong</h2>
        <p className="text-sm text-white/50">
          {error.message || "An unexpected error occurred."}
        </p>
        <div className="flex gap-3 justify-center pt-2">
          <button
            onClick={reset}
            className="px-4 py-2 rounded-lg bg-neo-brand/20 border border-neo-brand/30 text-neo-brand text-sm font-semibold hover:bg-neo-brand/30 transition-colors"
          >
            Try Again
          </button>
          <a
            href="/"
            className="px-4 py-2 rounded-lg bg-white/[0.06] border border-white/10 text-white/60 text-sm font-semibold hover:bg-white/[0.1] transition-colors"
          >
            Go Home
          </a>
        </div>
      </div>
    </div>
  );
}
