"use client";

import TamagotchiBadge from "./dashboard/TamagotchiBadge";

type MobileTab = "markets" | "agents" | "activity";

interface MobileTabBarProps {
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
  activityCount?: number;
  autonomousMode?: boolean;
  marketDataSource?: "onchain" | "cache" | "unknown";
  marketDataStale?: boolean;
  activeAgents?: number;
  nextTickIn?: number | null;
}

export default function MobileTabBar({
  activeTab,
  onTabChange,
  activityCount = 0,
  autonomousMode = false,
  marketDataSource = "unknown",
  marketDataStale = false,
  activeAgents = 0,
  nextTickIn = null,
}: MobileTabBarProps) {
  const tabs: { id: MobileTab; label: string; icon: React.ReactNode }[] = [
    {
      id: "markets",
      label: "Markets",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
        </svg>
      ),
    },
    {
      id: "agents",
      label: "Agents",
      icon: (
        <div className="w-5 h-5 flex items-center justify-center scale-[0.8]">
          <TamagotchiBadge
            autonomousMode={autonomousMode}
            marketDataSource={marketDataSource}
            marketDataStale={marketDataStale}
            activeAgents={activeAgents}
            nextTickIn={nextTickIn}
          />
        </div>
      ),
    },
    {
      id: "activity",
      label: "Activity",
      icon: (
        <span className="relative">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
          </svg>
          {activityCount > 0 && (
            <span className="absolute -top-1 -right-1 w-2 h-2 bg-neo-brand rounded-full" />
          )}
        </span>
      ),
    },
  ];

  return (
    <nav className="fixed bottom-0 inset-x-0 z-50 bg-[#0d111c]/95 backdrop-blur-md border-t border-white/[0.07] lg:hidden safe-area-bottom">
      <div className="flex items-center justify-around py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={`flex flex-col items-center gap-0.5 px-4 py-1 transition-colors ${
                isActive ? "text-neo-brand" : "text-white/40"
              }`}
            >
              {tab.icon}
              <span className="text-[10px] font-medium">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
