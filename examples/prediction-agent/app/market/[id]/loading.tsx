import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";

export default function MarketLoading() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
      <SiteHeader />
      <div className="max-w-[1200px] mx-auto w-full px-6 py-8 flex-1">
        <div className="flex gap-8">
          <div className="flex-1 space-y-6">
            <div className="h-3 w-32 rounded bg-white/[0.06] animate-pulse" />
            <div className="h-8 w-2/3 rounded bg-white/[0.06] animate-pulse" />
            <div className="h-[320px] rounded-xl bg-white/[0.03] animate-pulse" />
            <div className="h-px bg-white/[0.04]" />
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 rounded-xl bg-white/[0.03] animate-pulse" />
              ))}
            </div>
          </div>
          <div className="hidden lg:block w-[320px] shrink-0">
            <div className="h-[440px] rounded-2xl bg-white/[0.03] animate-pulse" />
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
