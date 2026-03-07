"use client";

import Link from "next/link";
import TamagotchiBadge from "./dashboard/TamagotchiBadge";

const FOOTER_NAV = [
  { href: "/markets", label: "Markets" },
  { href: "/fleet", label: "Fleet" },
  { href: "/souk", label: "AgentSouk" },
];

const FOOTER_RESOURCES = [
  { href: "/api/swagger", label: "API Docs", external: true },
  { href: "https://docs.starknet.io", label: "Starknet Docs", external: true },
  { href: "https://github.com/bitsage-network/starknet-agentic", label: "GitHub", external: true },
];

export default function Footer() {
  const brandName = process.env.NEXT_PUBLIC_SWARM_NAME?.trim() || "HiveCaster";
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-white/[0.06] bg-[#0c0f17]">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-5 lg:px-6">
        {/* Main footer grid */}
        <div className="grid grid-cols-2 gap-8 py-10 sm:grid-cols-3 lg:grid-cols-4">
          {/* Brand column */}
          <div className="col-span-2 sm:col-span-1 lg:col-span-1">
            <Link href="/" className="group inline-flex items-center gap-2.5 no-underline">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-400/8 transition-colors group-hover:border-cyan-200/35">
                <TamagotchiBadge
                  autonomousMode={true}
                  marketDataSource="unknown"
                  marketDataStale={false}
                  activeAgents={1}
                  nextTickIn={null}
                  size={16}
                />
              </div>
              <span className="font-heading text-lg font-bold text-white/90">
                {brandName}
              </span>
            </Link>
            <p className="mt-3 max-w-[240px] text-[12px] leading-relaxed text-white/35">
              Agentic superforecasting prediction markets on Starknet with
              on-chain accuracy tracking via ERC-8004.
            </p>
            <div className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[10px] font-medium text-white/40">
              <span className="h-1.5 w-1.5 rounded-full bg-neo-green/60" />
              Built on Starknet
            </div>
          </div>

          {/* Navigation */}
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/30">
              Platform
            </h3>
            <ul className="mt-3 space-y-2">
              {FOOTER_NAV.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-[13px] text-white/50 no-underline transition-colors hover:text-white/80"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/30">
              Resources
            </h3>
            <ul className="mt-3 space-y-2">
              {FOOTER_RESOURCES.map((item) => (
                <li key={item.href}>
                  {item.external ? (
                    <a
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[13px] text-white/50 no-underline transition-colors hover:text-white/80"
                    >
                      {item.label}
                      <svg className="h-3 w-3 text-white/25" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" />
                      </svg>
                    </a>
                  ) : (
                    <Link
                      href={item.href}
                      className="text-[13px] text-white/50 no-underline transition-colors hover:text-white/80"
                    >
                      {item.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {/* Protocol */}
          <div className="col-span-2 sm:col-span-3 lg:col-span-1">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/30">
              Protocol
            </h3>
            <div className="mt-3 space-y-2.5">
              <div className="flex items-center gap-2.5 text-[12px] text-white/40">
                <span className="flex h-5 w-5 items-center justify-center rounded-md bg-neo-blue/10 border border-neo-blue/20 text-[9px] font-bold text-neo-blue">
                  M
                </span>
                MCP Server
              </div>
              <div className="flex items-center gap-2.5 text-[12px] text-white/40">
                <span className="flex h-5 w-5 items-center justify-center rounded-md bg-neo-green/10 border border-neo-green/20 text-[9px] font-bold text-neo-green">
                  A
                </span>
                A2A Protocol
              </div>
              <div className="flex items-center gap-2.5 text-[12px] text-white/40">
                <span className="flex h-5 w-5 items-center justify-center rounded-md bg-neo-purple/10 border border-neo-purple/20 text-[9px] font-bold text-neo-purple">
                  E
                </span>
                ERC-8004 Identity
              </div>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="flex flex-col items-center justify-between gap-3 border-t border-white/[0.05] py-5 sm:flex-row">
          <p className="text-[11px] text-white/25">
            &copy; {year} {brandName}. Sepolia testnet &mdash; not financial advice.
          </p>
          <div className="flex items-center gap-4 text-[11px] text-white/25">
            <span className="font-mono">v0.1.0-beta</span>
            <span className="h-3 w-px bg-white/10" />
            <span>Starknet Sepolia</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
