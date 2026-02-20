"use client";

import { useState } from "react";
import { useAccount, useConnect, useDisconnect } from "@starknet-react/core";

export default function WalletConnect() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [showDropdown, setShowDropdown] = useState(false);

  const shortAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : null;

  if (isConnected && shortAddress) {
    return (
      <div className="relative">
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-neo-green/40 bg-neo-green/10 text-xs font-mono text-neo-green hover:bg-neo-green/20 transition-colors"
        >
          <span className="w-2 h-2 rounded-full bg-neo-green" />
          {shortAddress}
        </button>

        {showDropdown && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setShowDropdown(false)}
            />
            <div className="absolute right-0 top-full mt-2 z-50 border border-white/10 bg-neo-dark/90 backdrop-blur shadow-neo min-w-[200px] rounded-lg">
              <div className="px-3 py-2 border-b border-white/10">
                <p className="text-[10px] font-mono text-white/40 uppercase">
                  Connected
                </p>
                <p className="font-mono text-xs mt-0.5 break-all text-white/80">
                  {address}
                </p>
              </div>
              <button
                onClick={() => {
                  disconnect();
                  setShowDropdown(false);
                }}
                className="w-full text-left px-3 py-2 text-xs font-mono text-neo-pink hover:bg-white/5 transition-colors"
              >
                Disconnect
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => {
          if (connectors.length === 1) {
            connect({ connector: connectors[0] });
          } else {
            setShowDropdown(!showDropdown);
          }
        }}
        disabled={isPending}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 text-xs font-mono bg-white/5 transition-colors hover:bg-white/10 ${isPending ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        <span className="w-2 h-2 rounded-full bg-white/30" />
        {isPending ? "Connecting..." : "Connect Wallet"}
      </button>

      {showDropdown && connectors.length > 1 && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowDropdown(false)}
          />
          <div className="absolute right-0 top-full mt-2 z-50 border border-white/10 bg-neo-dark/90 backdrop-blur shadow-neo min-w-[180px] rounded-lg">
            <p className="px-3 py-1.5 text-[10px] font-mono text-white/40 uppercase border-b border-white/10">
              Select Wallet
            </p>
            {connectors.map((connector) => (
              <button
                key={connector.id}
                onClick={() => {
                  connect({ connector });
                  setShowDropdown(false);
                }}
                className="w-full text-left px-3 py-2 text-xs font-mono hover:bg-white/5 transition-colors border-b border-white/10 last:border-b-0 text-white/80"
              >
                {connector.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
