"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Markets" },
  { href: "/fleet", label: "Fleet" },
] as const;

export default function NavBar() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-[60] flex items-center gap-6 border-b border-white/[0.07] bg-[#0d111c]/90 px-4 py-2.5 backdrop-blur-md sm:px-6">
      <Link
        href="/"
        className="flex items-center gap-2 font-heading text-sm font-bold tracking-tight text-white"
      >
        <span className="text-neo-brand">&#x2B22;</span>
        <span>Starknet Agentic</span>
      </Link>

      <div className="flex items-center gap-1">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-md px-3 py-1.5 font-heading text-xs font-medium tracking-wide transition-colors ${
                isActive
                  ? "bg-neo-brand/15 text-neo-brand"
                  : "text-muted hover:bg-white/[0.05] hover:text-white"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>

      <div className="ml-auto" />
    </nav>
  );
}
