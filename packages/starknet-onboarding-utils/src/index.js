import { Account, CallData, ETransactionVersion, PaymasterRpc, RpcProvider, byteArray, cairo, ec, encode, hash, } from "starknet";
export async function waitForTransactionWithTimeout(args) {
    const { provider, txHash, timeoutMs } = args;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new Error("timeoutMs must be a positive number");
    }
    let timeout = null;
    try {
        return (await Promise.race([
            provider.waitForTransaction(txHash),
            new Promise((_resolve, reject) => {
                timeout = setTimeout(() => {
                    reject(new Error(`waitForTransaction timed out after ${timeoutMs}ms (${txHash})`));
                }, timeoutMs);
            }),
        ]));
    }
    finally {
        if (timeout) {
            clearTimeout(timeout);
        }
    }
}
function trimTrailingChar(input, charToTrim) {
    if (charToTrim.length !== 1) {
        throw new TypeError("trimTrailingChar expects a single character");
    }
    let end = input.length;
    while (end > 0 && input.charAt(end - 1) === charToTrim) {
        end -= 1;
    }
    return input.slice(0, end);
}
export function formatBalance(raw, decimals) {
    if (raw === 0n) {
        return "0";
    }
    const s = raw.toString();
    if (s.length <= decimals) {
        const frac = trimTrailingChar(s.padStart(decimals, "0"), "0");
        return frac ? `0.${frac}` : "0";
    }
    const whole = s.slice(0, s.length - decimals);
    const frac = trimTrailingChar(s.slice(s.length - decimals), "0");
    return frac ? `${whole}.${frac}` : whole;
}
export async function getErc20BalanceWei(args) {
    const result = await args.provider.callContract({
        contractAddress: args.tokenAddress,
        entrypoint: "balance_of",
        calldata: [args.accountAddress],
    });
    const low = BigInt(result[0]);
    const high = BigInt(result[1]);
    return low + (high << 128n);
}
export async function getTokenBalances(args) {
    const decimals = args.decimals ?? 18;
    const balances = {};
    for (const [symbol, tokenAddress] of Object.entries(args.tokens)) {
        try {
            const raw = await getErc20BalanceWei({
                provider: args.provider,
                tokenAddress,
                accountAddress: args.accountAddress,
            });
            balances[symbol] = formatBalance(raw, decimals);
        }
        catch {
            balances[symbol] = "error";
        }
    }
    return balances;
}
export function assertSepoliaChainId(chainId, network) {
    if (network !== "sepolia") {
        return;
    }
    const isSepolia = chainId === "0x534e5f5345504f4c4941" /* SN_SEPOLIA (hex) */ ||
        chainId === "SN_SEPOLIA";
    if (!isSepolia) {
        throw new Error(`Network is "sepolia" but chain returned ${chainId}. Check STARKNET_RPC_URL.`);
    }
}
export async function preflightStarknet(args) {
    const rpcUrl = args.rpcUrlOverride || args.networkConfig.rpc;
    const provider = new RpcProvider({ nodeUrl: rpcUrl });
    const chainId = String(await provider.getChainId());
    assertSepoliaChainId(chainId, args.network);
    // Attach paymaster to the deployer account so callers can use
    // account.executePaymasterTransaction() without unsafe casts.
    const paymaster = createPaymasterRpc({
        network: args.network,
        paymasterUrl: args.paymasterUrl,
        paymasterApiKey: args.paymasterApiKey,
    });
    const account = new Account({
        provider,
        address: args.accountAddress,
        signer: args.privateKey,
        transactionVersion: ETransactionVersion.V3,
        paymaster,
    });
    const balances = await getTokenBalances({
        provider,
        tokens: args.tokens,
        accountAddress: args.accountAddress,
    });
    return { provider, account, chainId, balances };
}
export function createRandomKeypair() {
    const privateKeyBytes = ec.starkCurve.utils.randomPrivateKey();
    const privateKey = "0x" + encode.buf2hex(privateKeyBytes);
    const publicKey = ec.starkCurve.getStarkKey(privateKeyBytes);
    return { privateKey, publicKey };
}
export function parseFactoryAccountDeployedEvent(args) {
    const events = args.receipt
        .events;
    if (!events) {
        return { accountAddress: null, agentId: null };
    }
    const factory = args.factoryAddress.toLowerCase();
    const accountDeployedSelector = hash.getSelectorFromName("AccountDeployed").toLowerCase();
    for (const event of events) {
        if (!event?.from_address || !event.data) {
            continue;
        }
        if (event.from_address.toLowerCase() !== factory) {
            continue;
        }
        // If keys exist, require the correct event selector.
        if (event.keys && event.keys.length > 0 && event.keys[0]?.toLowerCase() !== accountDeployedSelector) {
            continue;
        }
        if (event.data.length < 4) {
            continue;
        }
        try {
            const accountAddress = event.data[0];
            const low = BigInt(event.data[2]);
            const high = BigInt(event.data[3]);
            const agentId = (low + (high << 128n)).toString();
            return { accountAddress, agentId };
        }
        catch {
            continue;
        }
    }
    return { accountAddress: null, agentId: null };
}
function createPaymasterRpc(args) {
    const url = args.paymasterUrl ||
        (args.network === "sepolia" ? "https://sepolia.paymaster.avnu.fi" : "https://starknet.paymaster.avnu.fi");
    const headers = args.paymasterApiKey ? { "x-paymaster-api-key": args.paymasterApiKey } : {};
    return new PaymasterRpc({ nodeUrl: url, headers });
}
export async function deployAccountViaFactory(args) {
    const { privateKey, publicKey } = createRandomKeypair();
    const salt = args.salt || "0x" + encode.buf2hex(ec.starkCurve.utils.randomPrivateKey());
    const calldata = CallData.compile({
        public_key: publicKey,
        salt,
        token_uri: byteArray.byteArrayFromString(args.tokenUri),
    });
    const deployCall = {
        contractAddress: args.factoryAddress,
        entrypoint: "deploy_account",
        calldata,
    };
    let txHash;
    if (args.gasfree) {
        const res = await args.deployerAccount.executePaymasterTransaction([deployCall], {
            feeMode: { mode: "sponsored" },
        });
        txHash = res.transaction_hash;
    }
    else {
        const res = await args.deployerAccount.execute(deployCall);
        txHash = res.transaction_hash;
    }
    const receipt = await waitForTransactionWithTimeout({
        provider: args.provider,
        txHash,
        timeoutMs: args.waitForTxTimeoutMs ?? 300_000,
    });
    const { accountAddress, agentId } = parseFactoryAccountDeployedEvent({
        factoryAddress: args.factoryAddress,
        receipt,
    });
    if (!accountAddress || !agentId) {
        if (args.requireEvent) {
            throw new Error("Failed to parse AccountDeployed event from factory tx receipt.");
        }
        return { accountAddress: "check_explorer", agentId: "", publicKey, privateKey, deployTxHash: txHash };
    }
    return { accountAddress, agentId, publicKey, privateKey, deployTxHash: txHash };
}
export async function firstActionBalances(args) {
    const balances = await getTokenBalances({
        provider: args.provider,
        tokens: args.tokens,
        accountAddress: args.accountAddress,
    });
    let verifyTxHash = null;
    if (args.verifyTx) {
        const ethAddress = args.tokens.ETH ||
            "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
        const account = new Account({
            provider: args.provider,
            address: args.accountAddress,
            signer: args.privateKey,
            transactionVersion: ETransactionVersion.V3,
        });
        const tx = await account.execute({
            contractAddress: ethAddress,
            entrypoint: "transfer",
            calldata: CallData.compile({
                recipient: args.accountAddress,
                amount: cairo.uint256(0),
            }),
        });
        await waitForTransactionWithTimeout({
            provider: args.provider,
            txHash: tx.transaction_hash,
            timeoutMs: args.waitForTxTimeoutMs ?? 300_000,
        });
        verifyTxHash = tx.transaction_hash;
    }
    return { balances, verifyTxHash };
}
