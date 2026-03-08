export default function RootLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
      <div className="flex flex-col items-center gap-4">
        <div className="relative w-10 h-10">
          <div className="absolute inset-0 rounded-full border-2 border-white/[0.06]" />
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-neo-brand animate-spin" />
        </div>
        <p className="text-xs text-white/25 font-mono tracking-wider">Loading...</p>
      </div>
    </div>
  );
}
