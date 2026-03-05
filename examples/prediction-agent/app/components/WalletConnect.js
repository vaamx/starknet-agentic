"use client";
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = WalletConnect;
const react_1 = require("react");
function WalletConnect() {
    const [wallet, setWallet] = (0, react_1.useState)({
        address: null,
        connected: false,
        chainId: null,
        walletName: null,
    });
    const [connecting, setConnecting] = (0, react_1.useState)(false);
    const [showDropdown, setShowDropdown] = (0, react_1.useState)(false);
    // Check for existing connection on mount
    (0, react_1.useEffect)(() => {
        const checkExisting = async () => {
            const starknet = window.starknet;
            if (starknet?.isConnected && starknet?.selectedAddress) {
                setWallet({
                    address: starknet.selectedAddress,
                    connected: true,
                    chainId: starknet.chainId ?? null,
                    walletName: starknet.name ?? starknet.id ?? "Wallet",
                });
            }
        };
        checkExisting();
    }, []);
    const connect = (0, react_1.useCallback)(async () => {
        setConnecting(true);
        try {
            // Try window.starknet (Argent X, Braavos inject this)
            const starknet = window.starknet;
            if (!starknet) {
                window.open("https://www.argent.xyz/argent-x/", "_blank");
                return;
            }
            await starknet.enable();
            if (starknet.isConnected && starknet.selectedAddress) {
                setWallet({
                    address: starknet.selectedAddress,
                    connected: true,
                    chainId: starknet.chainId ?? null,
                    walletName: starknet.name ?? starknet.id ?? "Wallet",
                });
            }
        }
        catch (err) {
            console.error("Wallet connection failed:", err);
        }
        finally {
            setConnecting(false);
        }
    }, []);
    const disconnect = (0, react_1.useCallback)(() => {
        setWallet({
            address: null,
            connected: false,
            chainId: null,
            walletName: null,
        });
        setShowDropdown(false);
    }, []);
    const shortAddress = wallet.address
        ? `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`
        : null;
    if (wallet.connected && shortAddress) {
        return (<div className="relative">
        <button onClick={() => setShowDropdown(!showDropdown)} className="flex items-center gap-2 px-3 py-1.5 border-2 border-neo-green bg-neo-green/10 text-xs font-mono text-neo-green hover:bg-neo-green/20 transition-colors">
          <span className="w-2 h-2 rounded-full bg-neo-green"/>
          {shortAddress}
        </button>

        {showDropdown && (<>
            <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)}/>
            <div className="absolute right-0 top-full mt-1 z-50 border-2 border-black bg-white shadow-neo min-w-[200px]">
              <div className="px-3 py-2 border-b border-gray-200">
                <p className="text-[10px] font-mono text-gray-400 uppercase">
                  {wallet.walletName}
                </p>
                <p className="font-mono text-xs mt-0.5 break-all">
                  {wallet.address}
                </p>
              </div>
              {wallet.chainId && (<div className="px-3 py-1.5 border-b border-gray-200 text-[10px] font-mono text-gray-400">
                  Chain: {wallet.chainId}
                </div>)}
              <button onClick={disconnect} className="w-full text-left px-3 py-2 text-xs font-mono text-neo-pink hover:bg-neo-pink/5 transition-colors">
                Disconnect
              </button>
            </div>
          </>)}
      </div>);
    }
    return (<button onClick={connect} disabled={connecting} className={`flex items-center gap-2 px-3 py-1.5 border-2 border-black text-xs font-mono bg-white hover:bg-gray-50 transition-colors ${connecting ? "opacity-50 cursor-not-allowed" : ""}`}>
      <span className="w-2 h-2 rounded-full bg-gray-300"/>
      {connecting ? "Connecting..." : "Connect Wallet"}
    </button>);
}
