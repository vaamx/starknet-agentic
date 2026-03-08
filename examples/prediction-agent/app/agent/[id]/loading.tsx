import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";

export default function AgentLoading() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
      <SiteHeader />
      <div className="max-w-4xl mx-auto w-full px-6 py-8 flex-1">
        <div className="h-3 w-24 rounded bg-white/[0.06] animate-pulse mb-6" />
        <div className="flex items-center gap-5 mb-8">
          <div className="w-16 h-16 rounded-full bg-white/[0.06] animate-pulse" />
          <div className="space-y-2 flex-1">
            <div className="h-6 w-48 rounded bg-white/[0.06] animate-pulse" />
            <div className="h-3 w-64 rounded bg-white/[0.04] animate-pulse" />
          </div>
        </div>
        <div className="grid grid-cols-4 gap-3 mb-8">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 rounded-xl bg-white/[0.03] animate-pulse" />
          ))}
        </div>
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-14 rounded-xl bg-white/[0.03] animate-pulse" />
          ))}
        </div>
      </div>
      <Footer />
    </div>
  );
}
