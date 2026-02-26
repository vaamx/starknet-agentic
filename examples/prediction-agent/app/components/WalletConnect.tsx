"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useSignTypedData,
} from "@starknet-react/core";

function getConnectorIcon(connector: any): string | null {
  const icon = connector?.icon;
  if (!icon) return null;
  if (typeof icon === "string") return icon;
  if (typeof icon.light === "string" && icon.light) return icon.light;
  if (typeof icon.dark === "string" && icon.dark) return icon.dark;
  return null;
}

export default function WalletConnect() {
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
  const [authConfigured, setAuthConfigured] = useState(true);
  const [sessionChecked, setSessionChecked] = useState(false);
  const autoAuthAttemptedRef = useRef<string | null>(null);

  const shortAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : null;
  const normalizedAddress = address ? address.trim().toLowerCase() : null;
  const isSessionAuthed = Boolean(
    normalizedAddress && authWalletAddress === normalizedAddress
  );

  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const apply = () => setIsMobile(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

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
        setSessionChecked(true);
        return;
      }
      const payload = await res.json();
      const walletAddress =
        typeof payload?.walletAddress === "string"
          ? payload.walletAddress.trim().toLowerCase()
          : null;
      setAuthConfigured(payload?.configured !== false);
      setAuthWalletAddress(payload?.authenticated ? walletAddress : null);
      setSessionChecked(true);
    } catch {
      setAuthConfigured(true);
      setAuthWalletAddress(null);
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

  const ensureWalletSession = useCallback(async (): Promise<boolean> => {
    if (!isConnected || !address) return false;
    setAuthPending(true);
    setAuthError(null);
    try {
      const challengeRes = await fetch("/api/auth/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          walletAddress: address,
        }),
      });
      const challengePayload = await challengeRes.json().catch(() => null);
      if (!challengeRes.ok) {
        throw new Error(challengePayload?.error || "Failed to request signature challenge");
      }

      const challengeId = challengePayload?.challenge?.id;
      const typedData = challengePayload?.challenge?.typedData;
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
      setAuthWalletAddress(walletAddress);
      return true;
    } catch (err: any) {
      const message = err?.message ?? "Signature verification failed";
      setAuthError(message);
      return false;
    } finally {
      setAuthPending(false);
    }
  }, [address, isConnected, signTypedDataAsync]);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    if (!isConnected || !normalizedAddress) {
      setAuthWalletAddress(null);
      autoAuthAttemptedRef.current = null;
      return;
    }

    if (!sessionChecked) return;
    if (!authConfigured) return;
    if (authWalletAddress === normalizedAddress) {
      autoAuthAttemptedRef.current = normalizedAddress;
      return;
    }
    if (autoAuthAttemptedRef.current === normalizedAddress) return;
    autoAuthAttemptedRef.current = normalizedAddress;
    void ensureWalletSession();
  }, [
    isConnected,
    normalizedAddress,
    sessionChecked,
    authConfigured,
    authWalletAddress,
    ensureWalletSession,
  ]);

  const copyValue = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const renderConnectedPanel = () => (
    <>
      <p className="text-[10px] font-mono text-white/40 uppercase">Connected</p>
      <p className="font-mono text-xs mt-1 break-all text-white/85">{address}</p>
      <div className="mt-2">
        <p className="text-[10px] font-mono text-white/40 uppercase">Auth</p>
        <p
          className={`text-[11px] mt-1 ${
            isSessionAuthed
              ? "text-neo-green"
              : authConfigured
                ? "text-neo-yellow"
                : "text-neo-pink"
          }`}
        >
          {!authConfigured
            ? "Manual signature auth is not configured on server"
            : isSessionAuthed
              ? "Signature verified for manual actions"
              : "Signature required for manual actions"}
        </p>
      </div>
      <div className="mt-3 flex items-center gap-2">
        {!isSessionAuthed && (
          <button
            type="button"
            onClick={() => {
              void ensureWalletSession();
            }}
            disabled={authPending || isSigningTypedData}
            className="neo-btn-secondary text-[11px] px-3 py-1.5 border-neo-yellow/40 text-neo-yellow disabled:opacity-60"
          >
            {authPending || isSigningTypedData ? "Signing..." : "Verify Signature"}
          </button>
        )}
        {address && (
          <button
            type="button"
            onClick={() => copyValue(address)}
            className="neo-btn-secondary text-[11px] px-3 py-1.5"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        )}
        <button
          type="button"
          onClick={async () => {
            try {
              await fetch("/api/auth/logout", {
                method: "POST",
                credentials: "include",
              });
            } catch {
              // Ignore logout network errors.
            }
            disconnect();
            setAuthWalletAddress(null);
            setAuthError(null);
            setShowDropdown(false);
          }}
          className="neo-btn-secondary text-[11px] px-3 py-1.5 border-neo-pink/40 text-neo-pink"
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
        <p className="text-[10px] text-white/45 mb-1">
          Optional for manual bets and market actions.
        </p>
        <p className="text-[10px] font-mono text-white/40 uppercase">
          {hasConnectors ? "Select wallet" : "No wallet detected"}
        </p>

        {hasConnectors ? (
          <div className="mt-2 space-y-2">
            {availableConnectors.map((connector) => {
              const icon = getConnectorIcon(connector);
              return (
                <button
                  key={connector.id}
                  type="button"
                  onClick={() => connectWith(connector)}
                  className="w-full flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left hover:bg-white/10 transition-colors"
                >
                  {icon ? (
                    <img
                      src={icon}
                      alt=""
                      className="w-5 h-5 rounded-sm bg-white/5 border border-white/10"
                    />
                  ) : (
                    <span className="w-5 h-5 rounded-sm bg-white/10 border border-white/10" />
                  )}
                  <span className="text-xs font-mono text-white/85">{connector.name}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="mt-2 text-[11px] text-white/65 space-y-2">
            <p>
              No injected Starknet wallet detected in this browser. Open this page inside
              a wallet dApp browser.
            </p>
            {unavailableConnectors.length > 0 && (
              <p className="text-white/45">
                Supported: {unavailableConnectors.map((connector) => connector.name).join(", ")}
              </p>
            )}
            <div className="flex items-center gap-2 pt-1">
              <a
                href="https://www.argent.xyz/argent-x/"
                target="_blank"
                rel="noreferrer"
                className="neo-btn-secondary text-[11px] px-3 py-1.5"
              >
                Argent
              </a>
              <a
                href="https://braavos.app/"
                target="_blank"
                rel="noreferrer"
                className="neo-btn-secondary text-[11px] px-3 py-1.5"
              >
                Braavos
              </a>
              <button
                type="button"
                onClick={() => copyValue(window.location.href)}
                className="neo-btn-secondary text-[11px] px-3 py-1.5"
              >
                {copied ? "Copied URL" : "Copy URL"}
              </button>
            </div>
          </div>
        )}

        {(connectError || authError || error?.message) && (
          <p className="mt-2 text-[11px] text-neo-pink break-words">
            {connectError ?? authError ?? error?.message}
          </p>
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
          : "Verify Signature"
      : "Connect User Wallet";

  const triggerClass = isConnected
    ? isSessionAuthed
      ? "border-neo-green/40 bg-neo-green/10 text-neo-green hover:bg-neo-green/20"
      : "border-neo-yellow/40 bg-neo-yellow/10 text-neo-yellow hover:bg-neo-yellow/20"
    : "border-white/10 bg-white/5 text-white hover:bg-white/10";

  return (
    <div className="relative">
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
        className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-mono transition-colors ${triggerClass} ${
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

      {showDropdown && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)} />

          {isMobile ? (
            <div className="fixed inset-x-3 bottom-3 z-50 rounded-xl border border-white/15 bg-neo-dark/95 backdrop-blur p-4 shadow-neo-lg">
              {isConnected ? renderConnectedPanel() : renderConnectorPanel()}
            </div>
          ) : (
            <div className="absolute right-0 top-full mt-2 z-50 min-w-[220px] rounded-lg border border-white/10 bg-neo-dark/90 backdrop-blur shadow-neo p-3">
              {isConnected ? renderConnectedPanel() : renderConnectorPanel()}
            </div>
          )}
        </>
      )}
    </div>
  );
}
