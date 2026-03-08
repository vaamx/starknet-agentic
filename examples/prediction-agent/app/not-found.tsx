import Link from "next/link";
import SiteHeader from "./components/SiteHeader";
import Footer from "./components/Footer";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
      <SiteHeader />
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="text-center max-w-md space-y-5">
          <div className="text-[72px] font-bold text-white/[0.04] leading-none select-none">404</div>
          <h1 className="text-xl font-bold text-white/80">Page not found</h1>
          <p className="text-sm text-white/30 leading-relaxed">
            The page you&apos;re looking for doesn&apos;t exist or has been moved.
          </p>
          <div className="flex gap-3 justify-center pt-2">
            <Link
              href="/markets"
              className="px-5 py-2.5 rounded-xl bg-neo-brand/20 border border-neo-brand/30 text-neo-brand text-sm font-semibold hover:bg-neo-brand/30 transition-colors no-underline"
            >
              Browse Markets
            </Link>
            <Link
              href="/"
              className="px-5 py-2.5 rounded-xl bg-white/[0.06] border border-white/10 text-white/60 text-sm font-semibold hover:bg-white/[0.1] transition-colors no-underline"
            >
              Go Home
            </Link>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
