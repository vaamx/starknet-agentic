"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useSignTypedData,
} from "@starknet-react/core";

const MANUAL_AUTH_SCOPES = ["spawn", "fund", "tick"] as const;
type ManualAuthScope = (typeof MANUAL_AUTH_SCOPES)[number];
const SCOPE_LABELS: Record<ManualAuthScope, string> = {
  spawn: "Sign spawn",
  fund: "Sign fund",
  tick: "Sign tick",
};

function formatRemaining(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "expired";
  const totalSecs = Math.floor(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function getConnectorIcon(connector: any): string | null {
  const icon = connector?.icon;
  if (!icon) return null;
  if (typeof icon === "string") return icon;
  if (typeof icon.light === "string" && icon.light) return icon.light;
  if (typeof icon.dark === "string" && icon.dark) return icon.dark;
  return null;
}

interface WalletConnectProps {
  showTrigger?: boolean;
}

export default function WalletConnect({ showTrigger = true }: WalletConnectProps) {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { signTypedDataAsync, isPending: isSigningTypedData } = useSignTypedData({});
  const [showDropdown, setShowDropdown] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [copied, setCopied] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authPending, setAuthPending] = useState(false);
  const [authWalletAddress, setAuthWalletAddress] = useState<string | null>(null);
  const [authExpiresAt, setAuthExpiresAt] = useState<number | null>(null);
  const [authScopes, setAuthScopes] = useState<ManualAuthScope[]>([]);
  const [authConfigured, setAuthConfigured] = useState(true);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const previousConnectedAddressRef = useRef<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());

  const shortAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : null;
  const normalizedAddress = address ? address.trim().toLowerCase() : null;
  const isSessionAuthed = Boolean(
    normalizedAddress && authWalletAddress === normalizedAddress
  );
  const remainingMs = authExpiresAt ? authExpiresAt - nowMs : 0;
  const authExpiringSoon = isSessionAuthed && remainingMs > 0 && remainingMs <= 5 * 60_000;
  const authScopeLabel = authScopes.length > 0 ? authScopes.join("/") : "none";
  const hasScope = (scope: ManualAuthScope) => isSessionAuthed && authScopes.includes(scope);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const apply = () => setIsMobile(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const openPanel = () => setShowDropdown(true);
    window.addEventListener("hc-wallet-connect-open", openPanel);
    return () => window.removeEventListener("hc-wallet-connect-open", openPanel);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    if (!showDropdown) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowDropdown(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showDropdown]);

  const availableConnectors = useMemo(() => {
    return connectors.filter((connector) => {
      try {
        return connector.available();
      } catch {
        return false;
      }
    });
  }, [connectors]);

  const unavailableConnectors = useMemo(() => {
    return connectors.filter((connector) => {
      try {
        return !connector.available();
      } catch {
        return true;
      }
    });
  }, [connectors]);

  const connectWith = async (connector: any) => {
    setConnectError(null);
    setAuthError(null);
    try {
      await Promise.resolve(connect({ connector }));
      setShowDropdown(false);
    } catch (err: any) {
      setConnectError(err?.message ?? "Failed to connect wallet");
    }
  };

  const refreshSession = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/session", {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      });
      if (!res.ok) {
        setAuthConfigured(true);
        setAuthWalletAddress(null);
        setAuthExpiresAt(null);
        setAuthScopes([]);
        setSessionChecked(true);
        return;
      }
      const payload = await res.json();
      const walletAddress =
        typeof payload?.walletAddress === "string"
          ? payload.walletAddress.trim().toLowerCase()
          : null;
      const expiresAt =
        typeof payload?.expiresAt === "number" && Number.isFinite(payload.expiresAt)
          ? payload.expiresAt
          : null;
      const scopes = Array.isArray(payload?.scopes)
        ? (payload.scopes as string[])
            .map((scope) => String(scope).trim().toLowerCase())
            .filter((scope): scope is ManualAuthScope =>
              (MANUAL_AUTH_SCOPES as readonly string[]).includes(scope)
            )
        : [];
      setAuthConfigured(payload?.configured !== false);
      setAuthWalletAddress(payload?.authenticated ? walletAddress : null);
      setAuthExpiresAt(payload?.authenticated ? expiresAt : null);
      setAuthScopes(payload?.authenticated ? scopes : []);
      setSessionChecked(true);
    } catch {
      setAuthConfigured(true);
      setAuthWalletAddress(null);
      setAuthExpiresAt(null);
      setAuthScopes([]);
      setSessionChecked(true);
    }
  }, []);

  function normalizeSignature(signature: unknown): string[] {
    if (Array.isArray(signature)) {
      return signature.map((item) => String(item));
    }
    if (signature && typeof signature === "object") {
      const obj = signature as Record<string, unknown>;
      const r = obj.r ?? obj.R;
      const s = obj.s ?? obj.S;
      if (r !== undefined && s !== undefined) {
        return [String(r), String(s)];
      }
    }
    if (typeof signature === "string" && signature.trim()) {
      return [signature.trim()];
    }
    return [];
  }

  const ensureWalletSession = useCallback(async (
    options?: { scopes?: ManualAuthScope[]; force?: boolean }
  ): Promise<boolean> => {
    if (!isConnected || !address) return false;
    const requestedScopes = (options?.scopes ?? [...MANUAL_AUTH_SCOPES])
      .filter((scope, index, all) => all.indexOf(scope) === index)
      .filter((scope): scope is ManualAuthScope =>
        (MANUAL_AUTH_SCOPES as readonly string[]).includes(scope)
      );
    const currentScopes =
      isSessionAuthed && authExpiresAt && authExpiresAt > Date.now() ? authScopes : [];
    const targetScopeSet = new Set<ManualAuthScope>([
      ...(options?.force ? [] : currentScopes),
      ...requestedScopes,
    ]);
    const targetScopes = MANUAL_AUTH_SCOPES.filter((scope) =>
      targetScopeSet.has(scope)
    );
    if (
      !options?.force &&
      isSessionAuthed &&
      authExpiresAt &&
      authExpiresAt > Date.now() &&
      targetScopes.every((scope) => authScopes.includes(scope))
    ) {
      return true;
    }
    setAuthPending(true);
    setAuthError(null);
    try {
      const challengeRes = await fetch("/api/auth/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          walletAddress: address,
          scopes: targetScopes,
        }),
      });
      const challengePayload = await challengeRes.json().catch(() => null);
      if (!challengeRes.ok) {
        throw new Error(challengePayload?.error || "Failed to request signature challenge");
      }

      const challengeId = challengePayload?.challenge?.id;
      const typedData = challengePayload?.challenge?.typedData;
      const challengeScopes = Array.isArray(challengePayload?.payload?.scopes)
        ? (challengePayload.payload.scopes as string[])
            .map((scope) => String(scope).trim().toLowerCase())
            .filter((scope): scope is ManualAuthScope =>
              (MANUAL_AUTH_SCOPES as readonly string[]).includes(scope)
            )
        : targetScopes;
      if (!challengeId || !typedData) {
        throw new Error("Challenge response is missing typedData");
      }

      const signatureRaw = await signTypedDataAsync(typedData);
      const signature = normalizeSignature(signatureRaw);
      if (signature.length === 0) {
        throw new Error("Wallet returned an empty signature");
      }

      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          walletAddress: address,
          scopes: challengeScopes,
          auth: {
            challengeId,
            walletAddress: address,
            signature,
          },
        }),
      });
      const verifyPayload = await verifyRes.json().catch(() => null);
      if (!verifyRes.ok) {
        throw new Error(verifyPayload?.error || "Wallet signature verification failed");
      }

      const walletAddress =
        typeof verifyPayload?.walletAddress === "string"
          ? verifyPayload.walletAddress.trim().toLowerCase()
          : address.trim().toLowerCase();
      const expiresAt =
        typeof verifyPayload?.expiresAt === "number" && Number.isFinite(verifyPayload.expiresAt)
          ? verifyPayload.expiresAt
          : null;
      const verifiedScopes = Array.isArray(verifyPayload?.scopes)
        ? (verifyPayload.scopes as string[])
            .map((scope) => String(scope).trim().toLowerCase())
            .filter((scope): scope is ManualAuthScope =>
              (MANUAL_AUTH_SCOPES as readonly string[]).includes(scope)
            )
        : challengeScopes;
      setAuthWalletAddress(walletAddress);
      setAuthExpiresAt(expiresAt);
      setAuthScopes(verifiedScopes);
      return true;
    } catch (err: any) {
      const message = err?.message ?? "Signature verification failed";
      setAuthError(message);
      return false;
    } finally {
      setAuthPending(false);
    }
  }, [address, isConnected, isSessionAuthed, authExpiresAt, authScopes, signTypedDataAsync]);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    if (!normalizedAddress) {
      previousConnectedAddressRef.current = null;
      return;
    }

    const previous = previousConnectedAddressRef.current;
    previousConnectedAddressRef.current = normalizedAddress;
    if (!previous || previous === normalizedAddress) return;

    // Session rotation on wallet change: invalidate old cookie first.
    setAuthWalletAddress(null);
    setAuthExpiresAt(null);
    setAuthScopes([]);
    setSessionChecked(false);
    void fetch("/api/auth/logout?scope=wallet", {
      method: "POST",
      credentials: "include",
    }).finally(() => {
      void refreshSession();
    });
  }, [normalizedAddress, refreshSession]);

  useEffect(() => {
    if (!isConnected || !normalizedAddress || !sessionChecked) return;
    if (!authWalletAddress || authWalletAddress === normalizedAddress) return;

    // Hard-rotate stale session if it belongs to a different wallet.
    setAuthWalletAddress(null);
    setAuthExpiresAt(null);
    setAuthScopes([]);
    void fetch("/api/auth/logout?scope=wallet", {
      method: "POST",
      credentials: "include",
    }).finally(() => {
      void refreshSession();
    });
  }, [isConnected, normalizedAddress, sessionChecked, authWalletAddress, refreshSession]);

  useEffect(() => {
    if (!isConnected || !normalizedAddress) {
      setAuthWalletAddress(null);
      setAuthExpiresAt(null);
      setAuthScopes([]);
      return;
    }
  }, [isConnected, normalizedAddress]);

  useEffect(() => {
    if (!isSessionAuthed || !authExpiresAt) return;
    if (authExpiresAt > nowMs) return;
    setAuthWalletAddress(null);
    setAuthExpiresAt(null);
    setAuthScopes([]);
  }, [isSessionAuthed, authExpiresAt, nowMs]);

  const copyValue = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const signScope = (scope: ManualAuthScope) => {
    void ensureWalletSession({ scopes: [scope] });
  };

  const signAllScopes = (force = false) => {
    void ensureWalletSession({
      scopes: [...MANUAL_AUTH_SCOPES],
      force,
    });
  };

  const renderConnectedPanel = () => (
    <>
      {/* Address card */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 mb-3">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${isSessionAuthed ? "bg-neo-green" : "bg-neo-yellow"}`} />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
              {isSessionAuthed ? "Verified" : "Connected"}
            </span>
          </div>
          {isSessionAuthed && authExpiresAt && (
            <span className={`text-[10px] font-mono ${authExpiringSoon ? "text-neo-yellow" : "text-white/30"}`}>
              {formatRemaining(remainingMs)} left
            </span>
          )}
        </div>
        <p className="font-mono text-xs break-all text-white/80 leading-relaxed">{address}</p>
        <div className="flex items-center gap-1.5 mt-2">
          <span className="text-[9px] text-white/30">Starknet Sepolia</span>
          <span className="text-white/10">|</span>
          <span className="text-[9px] text-white/30">Account Abstraction</span>
        </div>
      </div>

      {/* Auth status */}
      {!authConfigured ? (
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/[0.06] px-3 py-2 mb-3">
          <p className="text-[11px] text-rose-300">Manual signature auth is not configured on server</p>
        </div>
      ) : !isSessionAuthed ? (
        <div className="rounded-lg border border-neo-yellow/20 bg-neo-yellow/[0.06] px-3 py-2 mb-3">
          <p className="text-[11px] text-neo-yellow">Sign required scopes for manual actions</p>
        </div>
      ) : null}

      {/* Scope badges */}
      <div className="mb-3">
        <p className="text-[9px] font-semibold uppercase tracking-widest text-white/30 mb-1.5">Authorization Scopes</p>
        <div className="grid grid-cols-3 gap-1.5">
          {MANUAL_AUTH_SCOPES.map((scope) => (
            <button
              key={scope}
              type="button"
              onClick={() => signScope(scope)}
              disabled={authPending || isSigningTypedData || !authConfigured}
              className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-semibold transition-all disabled:opacity-50 ${
                hasScope(scope)
                  ? "border-neo-green/30 bg-neo-green/10 text-neo-green"
                  : "border-neo-yellow/25 bg-neo-yellow/[0.08] text-neo-yellow hover:bg-neo-yellow/15"
              }`}
            >
              <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${hasScope(scope) ? "bg-neo-green" : "bg-neo-yellow"}`} />
              {SCOPE_LABELS[scope]}
            </button>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            signAllScopes(isSessionAuthed);
          }}
          disabled={authPending || isSigningTypedData || !authConfigured}
          className={`flex-1 rounded-lg border py-2 text-[11px] font-semibold transition-all disabled:opacity-50 ${
            isSessionAuthed
              ? "border-neo-green/25 bg-neo-green/[0.08] text-neo-green hover:bg-neo-green/15"
              : "border-neo-brand/30 bg-neo-brand/10 text-neo-brand hover:bg-neo-brand/20"
          }`}
        >
          {authPending || isSigningTypedData
            ? "Signing..."
            : isSessionAuthed
              ? "Re-sign All"
              : "Sign All Scopes"}
        </button>
        {address && (
          <button
            type="button"
            onClick={() => copyValue(address)}
            className="rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 py-2 text-[11px] font-semibold text-white/60 hover:bg-white/[0.08] transition-colors"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        )}
        <button
          type="button"
          onClick={async () => {
            try {
              await fetch("/api/auth/logout?scope=wallet", {
                method: "POST",
                credentials: "include",
              });
            } catch {
              // Ignore logout network errors.
            }
            disconnect();
            setAuthWalletAddress(null);
            setAuthExpiresAt(null);
            setAuthScopes([]);
            setAuthError(null);
            setShowDropdown(false);
          }}
          className="rounded-lg border border-rose-500/20 bg-rose-500/[0.06] px-3 py-2 text-[11px] font-semibold text-rose-400 hover:bg-rose-500/15 transition-colors"
        >
          Disconnect
        </button>
      </div>
    </>
  );

  const renderConnectorPanel = () => {
    const hasConnectors = availableConnectors.length > 0;

    return (
      <>
        {/* Value prop strip */}
        <div className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 mb-3 text-[10px] text-white/40">
          <span>Account Abstraction</span>
          <span className="text-white/10">|</span>
          <span>Gasless via Paymaster</span>
          <span className="text-white/10">|</span>
          <span>Session Keys</span>
        </div>

        <p className="text-[9px] font-semibold uppercase tracking-widest text-white/30 mb-2">
          {hasConnectors ? "Select wallet" : "No wallet detected"}
        </p>

        {hasConnectors ? (
          <div className="space-y-1.5">
            {availableConnectors.map((connector) => {
              const icon = getConnectorIcon(connector);
              return (
                <button
                  key={connector.id}
                  type="button"
                  onClick={() => connectWith(connector)}
                  className="w-full flex items-center gap-3 rounded-xl border border-white/[0.1] bg-white/[0.04] px-4 py-3 text-left hover:bg-white/[0.08] hover:border-white/[0.15] transition-all"
                >
                  {icon ? (
                    <img
                      src={icon}
                      alt=""
                      className="w-7 h-7 rounded-lg bg-white/5 border border-white/10 p-0.5"
                    />
                  ) : (
                    <span className="w-7 h-7 rounded-lg bg-white/10 border border-white/10" />
                  )}
                  <div>
                    <span className="text-xs font-semibold text-white/85 block">{connector.name}</span>
                    <span className="text-[10px] text-white/35">Starknet wallet</span>
                  </div>
                  <svg className="w-4 h-4 text-white/20 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="text-[11px] text-white/55 space-y-3">
            <p>
              No injected Starknet wallet detected. Open this page inside a wallet dApp browser, or install one below.
            </p>
            {unavailableConnectors.length > 0 && (
              <p className="text-[10px] text-white/30">
                Supported: {unavailableConnectors.map((connector) => connector.name).join(", ")}
              </p>
            )}
            <div className="flex items-center gap-2">
              <a
                href="https://www.argent.xyz/argent-x/"
                target="_blank"
                rel="noreferrer"
                className="flex-1 rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 py-2 text-center text-[11px] font-semibold text-white/70 hover:bg-white/[0.08] transition-colors"
              >
                Argent X
              </a>
              <a
                href="https://braavos.app/"
                target="_blank"
                rel="noreferrer"
                className="flex-1 rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 py-2 text-center text-[11px] font-semibold text-white/70 hover:bg-white/[0.08] transition-colors"
              >
                Braavos
              </a>
              <button
                type="button"
                onClick={() => copyValue(window.location.href)}
                className="rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 py-2 text-[11px] font-semibold text-white/50 hover:bg-white/[0.08] transition-colors"
              >
                {copied ? "Copied" : "Copy URL"}
              </button>
            </div>
          </div>
        )}

        {(connectError || authError || error?.message) && (
          <div className="mt-3 rounded-lg border border-rose-500/20 bg-rose-500/[0.06] px-3 py-2">
            <p className="text-[11px] text-rose-300 break-words">
              {connectError ?? authError ?? error?.message}
            </p>
          </div>
        )}
      </>
    );
  };

  const triggerLabel = isPending
    ? "Connecting..."
    : isConnected
      ? isSessionAuthed
        ? shortAddress || "Connected"
        : authPending || isSigningTypedData
          ? "Signing..."
          : "Verify Wallet"
      : "Connect Wallet";

  const triggerClass = isConnected
    ? isSessionAuthed
      ? "border-neo-green/35 bg-neo-green/12 text-neo-green hover:bg-neo-green/18"
      : "border-neo-yellow/35 bg-neo-yellow/12 text-neo-yellow hover:bg-neo-yellow/18"
    : "border-white/14 bg-white/[0.05] text-white/85 hover:bg-white/[0.1]";

  const statusLabel = !isConnected
    ? "Wallet not connected"
    : !authConfigured
      ? "Manual wallet auth unavailable"
      : isSessionAuthed
        ? authExpiringSoon
          ? `Verification expiring in ${formatRemaining(remainingMs)}`
          : `Verified for ${formatRemaining(remainingMs)}`
        : "Signature verification needed";

  const statusTone = !isConnected
    ? "text-white/60"
    : !authConfigured
      ? "text-rose-200/90"
      : isSessionAuthed
        ? authExpiringSoon
          ? "text-neo-yellow"
          : "text-neo-green"
        : "text-neo-yellow";

  const statusDot = !isConnected
    ? "bg-white/35"
    : !authConfigured
      ? "bg-rose-400"
      : isSessionAuthed
        ? authExpiringSoon
          ? "bg-neo-yellow"
          : "bg-neo-green"
        : "bg-neo-yellow";

  const panelContent = isConnected ? renderConnectedPanel() : renderConnectorPanel();

  const dropdownLayer = showDropdown ? (
    <>
      <div
        className="fixed inset-0 z-[110] bg-black/45 backdrop-blur-sm"
        onClick={() => setShowDropdown(false)}
      />
      {isMobile ? (
        <div className="fixed inset-x-3 bottom-3 z-[111] max-h-[80vh] overflow-y-auto rounded-xl border border-white/15 bg-neo-dark/95 p-4 shadow-neo-lg backdrop-blur">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[10px] font-mono uppercase tracking-wider text-white/45">
              Wallet Panel
            </p>
            <button
              type="button"
              onClick={() => setShowDropdown(false)}
              className="rounded px-2 py-1 text-[10px] text-white/65 hover:bg-white/10 hover:text-white"
              aria-label="Close wallet panel"
            >
              Close
            </button>
          </div>
          {panelContent}
        </div>
      ) : (
        <div className="fixed inset-0 z-[111] flex items-center justify-center p-4 sm:p-6">
          <div
            className="w-full max-w-md max-h-[min(86vh,720px)] overflow-y-auto rounded-2xl border border-white/15 bg-neo-dark/95 p-4 shadow-neo-lg backdrop-blur animate-modal-in"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[10px] font-mono uppercase tracking-wider text-white/45">
                Wallet Panel
              </p>
              <button
                type="button"
                onClick={() => setShowDropdown(false)}
                className="rounded px-2 py-1 text-[10px] text-white/65 hover:bg-white/10 hover:text-white"
                aria-label="Close wallet panel"
              >
                Close
              </button>
            </div>
            {panelContent}
          </div>
        </div>
      )}
    </>
  ) : null;

  return (
    <div className="relative flex items-center gap-2">
      {showTrigger && isConnected && (
        <div className="hidden xl:flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.05] px-3 py-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${statusDot}`} />
          <span className={`text-xs font-semibold ${statusTone}`}>
            {statusLabel}
          </span>
        </div>
      )}
      {showTrigger && (
        <button
          type="button"
          onClick={() => {
            if (!isConnected && availableConnectors.length === 1) {
              connectWith(availableConnectors[0]);
              return;
            }
            setShowDropdown((prev) => !prev);
          }}
          disabled={isPending}
          className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-[13px] font-semibold transition-colors ${triggerClass} ${
            isPending || authPending || isSigningTypedData ? "opacity-50 cursor-not-allowed" : ""
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              isConnected
                ? isSessionAuthed
                  ? "bg-neo-green"
                  : "bg-neo-yellow"
                : "bg-white/35"
            }`}
          />
          {triggerLabel}
        </button>
      )}

      {portalReady && dropdownLayer ? createPortal(dropdownLayer, document.body) : null}
    </div>
  );
}
