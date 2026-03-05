"use client";

import TamagotchiBadge from "./dashboard/TamagotchiBadge";

export default function NavBar() {
  return (
    <nav className="fixed left-0 right-0 top-0 z-[60] flex items-center border-b border-white/[0.07] bg-[#0d111c]/95 px-4 py-2.5 backdrop-blur-md sm:px-6">
      <a
        href="/"
        className="w-11 h-11 bg-neo-brand/15 border border-neo-brand/30 flex items-center justify-center rounded-xl no-underline"
        aria-label="Go to Markets"
      >
        <TamagotchiBadge
          autonomousMode
          marketDataSource="onchain"
          marketDataStale={false}
          activeAgents={5}
          nextTickIn={null}
        />
      </a>
    </nav>
  );
}
