"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "@starknet-react/core";

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
  const [showDropdown, setShowDropdown] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [copied, setCopied] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const shortAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : null;

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
    try {
      await Promise.resolve(connect({ connector }));
      setShowDropdown(false);
    } catch (err: any) {
      setConnectError(err?.message ?? "Failed to connect wallet");
    }
  };

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
      <div className="mt-3 flex items-center gap-2">
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
          onClick={() => {
            disconnect();
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
        <p className="text-[10px] font-mono text-white/40 uppercase">
          {hasConnectors ? "Select wallet" : "Wallet required"}
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

        {(connectError || error?.message) && (
          <p className="mt-2 text-[11px] text-neo-pink break-words">
            {connectError ?? error?.message}
          </p>
        )}
      </>
    );
  };

  const triggerLabel = isConnected && shortAddress
    ? shortAddress
    : isPending
      ? "Connecting..."
      : "Connect Wallet";

  const triggerClass = isConnected
    ? "border-neo-green/40 bg-neo-green/10 text-neo-green hover:bg-neo-green/20"
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
          isPending ? "opacity-50 cursor-not-allowed" : ""
        }`}
      >
        <span
          className={`w-2 h-2 rounded-full ${
            isConnected ? "bg-neo-green" : "bg-white/35"
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
