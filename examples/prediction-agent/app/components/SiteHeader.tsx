"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "@starknet-react/core";
import SimpleHeader from "./SimpleHeader";
import AuthModal, { type AuthModalMode } from "./AuthModal";

interface SessionUser {
  id: string;
  email: string;
  name: string;
}

interface SessionResponse {
  userAuthenticated?: boolean;
  user?: SessionUser;
  organization?: { id: string; name: string; slug: string } | null;
  role?: "owner" | "admin" | "analyst" | "viewer" | null;
}

interface SiteHeaderProps {
  searchQuery?: string;
  onSearchChange?: (value: string) => void;
}

export default function SiteHeader({
  searchQuery: externalSearch,
  onSearchChange: externalSearchChange,
}: SiteHeaderProps = {}) {
  const router = useRouter();
  const { isConnected } = useAccount();
  const [authUser, setAuthUser] = useState<SessionUser | null>(null);
  const [authRole, setAuthRole] = useState<SessionResponse["role"]>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [localSearch, setLocalSearch] = useState("");
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<AuthModalMode>("signin");

  const searchQuery = externalSearch ?? localSearch;
  const handleSearchChange = useCallback(
    (value: string) => {
      if (externalSearchChange) {
        externalSearchChange(value);
      } else {
        setLocalSearch(value);
      }
    },
    [externalSearchChange]
  );

  useEffect(() => {
    if (externalSearchChange) return;
    if (!localSearch.trim()) return;
    const timeout = setTimeout(() => {
      router.push(`/?q=${encodeURIComponent(localSearch.trim())}`);
    }, 600);
    return () => clearTimeout(timeout);
  }, [localSearch, externalSearchChange, router]);

  useEffect(() => {
    let cancelled = false;
    async function fetchSession() {
      try {
        const res = await fetch("/api/auth/session", {
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const data: SessionResponse = await res.json();
        if (cancelled) return;
        if (data.userAuthenticated && data.user) {
          setAuthUser(data.user);
          setAuthRole(data.role ?? null);
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    }
    fetchSession();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleOpenAuth = useCallback((mode: AuthModalMode) => {
    setAuthModalMode(mode);
    setAuthModalOpen(true);
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout?scope=all", {
        method: "POST",
        credentials: "include",
      });
    } catch {}
    setAuthUser(null);
    setAuthRole(null);
  }, []);

  const handleOpenCreator = useCallback(() => {
    if (!authUser && !isConnected) {
      setAuthModalMode("signup");
      setAuthModalOpen(true);
      return;
    }
    router.push("/?create=1");
  }, [authUser, isConnected, router]);

  const handleAuthSuccess = useCallback(async () => {
    setAuthModalOpen(false);
    try {
      const res = await fetch("/api/auth/session", {
        credentials: "include",
        cache: "no-store",
      });
      if (res.ok) {
        const data: SessionResponse = await res.json();
        if (data.userAuthenticated && data.user) {
          setAuthUser(data.user);
          setAuthRole(data.role ?? null);
        }
      }
    } catch {}
  }, []);

  return (
    <>
      <SimpleHeader
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
        onOpenCreator={handleOpenCreator}
        authUser={authUser}
        authRole={authRole}
        authLoading={authLoading}
        onOpenAuth={handleOpenAuth}
        onLogout={handleLogout}
      />
      <AuthModal
        open={authModalOpen}
        initialMode={authModalMode}
        onClose={() => setAuthModalOpen(false)}
        onAuthenticated={handleAuthSuccess}
      />
    </>
  );
}
