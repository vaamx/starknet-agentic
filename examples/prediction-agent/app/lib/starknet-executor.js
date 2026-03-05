"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.placeBet = placeBet;
exports.recordPrediction = recordPrediction;
exports.claimWinnings = claimWinnings;
exports.isAgentConfigured = isAgentConfigured;
exports.getAgentAddress = getAgentAddress;
const starknet_1 = require("starknet");
const config_1 = require("./config");
const accuracy_1 = require("./accuracy");
const provider = new starknet_1.RpcProvider({ nodeUrl: config_1.config.STARKNET_RPC_URL });
function resolveExecutionSurface(executionSurface) {
    return executionSurface ?? config_1.config.EXECUTION_SURFACE;
}
function getAccount() {
    if (!config_1.config.AGENT_PRIVATE_KEY || !config_1.config.AGENT_ADDRESS)
        return null;
    return new starknet_1.Account(provider, config_1.config.AGENT_ADDRESS, config_1.config.AGENT_PRIVATE_KEY);
}
function unsupportedSurfaceResult(executionSurface, operation) {
    return {
        txHash: "",
        status: "error",
        executionSurface,
        errorCode: "UNSUPPORTED_SURFACE",
        error: `${operation} is not yet implemented for execution surface "${executionSurface}".`,
    };
}
async function placeBetDirect(marketAddress, outcome, amount, collateralToken) {
    const account = getAccount();
    if (!account) {
        return {
            txHash: "",
            status: "error",
            executionSurface: "direct",
            errorCode: "NO_ACCOUNT",
            error: "No agent account configured",
        };
    }
    try {
        const approveTx = {
            contractAddress: collateralToken,
            entrypoint: "approve",
            calldata: starknet_1.CallData.compile({
                spender: marketAddress,
                amount: { low: amount, high: 0n },
            }),
        };
        const betTx = {
            contractAddress: marketAddress,
            entrypoint: "bet",
            calldata: starknet_1.CallData.compile({
                outcome,
                amount: { low: amount, high: 0n },
            }),
        };
        const result = await account.execute([approveTx, betTx]);
        await provider.waitForTransaction(result.transaction_hash);
        return {
            txHash: result.transaction_hash,
            status: "success",
            executionSurface: "direct",
        };
    }
    catch (err) {
        return {
            txHash: "",
            status: "error",
            executionSurface: "direct",
            errorCode: "EXECUTION_FAILED",
            error: err?.message ?? "Execution failed",
        };
    }
}
async function recordPredictionDirect(marketId, probability) {
    const account = getAccount();
    if (!account) {
        return {
            txHash: "",
            status: "error",
            executionSurface: "direct",
            errorCode: "NO_ACCOUNT",
            error: "No agent account configured",
        };
    }
    const trackerAddress = config_1.config.ACCURACY_TRACKER_ADDRESS;
    if (trackerAddress === "0x0") {
        return {
            txHash: "",
            status: "error",
            executionSurface: "direct",
            errorCode: "TRACKER_NOT_DEPLOYED",
            error: "Accuracy tracker not deployed",
        };
    }
    try {
        const scaledProb = (0, accuracy_1.toScaled)(probability);
        const tx = {
            contractAddress: trackerAddress,
            entrypoint: "record_prediction",
            calldata: starknet_1.CallData.compile({
                market_id: { low: BigInt(marketId), high: 0n },
                predicted_prob: { low: scaledProb, high: 0n },
            }),
        };
        const result = await account.execute([tx]);
        await provider.waitForTransaction(result.transaction_hash);
        return {
            txHash: result.transaction_hash,
            status: "success",
            executionSurface: "direct",
        };
    }
    catch (err) {
        return {
            txHash: "",
            status: "error",
            executionSurface: "direct",
            errorCode: "EXECUTION_FAILED",
            error: err?.message ?? "Execution failed",
        };
    }
}
async function claimWinningsDirect(marketAddress) {
    const account = getAccount();
    if (!account) {
        return {
            txHash: "",
            status: "error",
            executionSurface: "direct",
            errorCode: "NO_ACCOUNT",
            error: "No agent account configured",
        };
    }
    try {
        const tx = {
            contractAddress: marketAddress,
            entrypoint: "claim",
            calldata: [],
        };
        const result = await account.execute([tx]);
        await provider.waitForTransaction(result.transaction_hash);
        return {
            txHash: result.transaction_hash,
            status: "success",
            executionSurface: "direct",
        };
    }
    catch (err) {
        return {
            txHash: "",
            status: "error",
            executionSurface: "direct",
            errorCode: "EXECUTION_FAILED",
            error: err?.message ?? "Execution failed",
        };
    }
}
async function placeBet(marketAddress, outcome, amount, collateralToken, executionSurface) {
    const surface = resolveExecutionSurface(executionSurface);
    if (surface === "direct") {
        return placeBetDirect(marketAddress, outcome, amount, collateralToken);
    }
    return unsupportedSurfaceResult(surface, "placeBet");
}
async function recordPrediction(marketId, probability, executionSurface) {
    const surface = resolveExecutionSurface(executionSurface);
    if (surface === "direct") {
        return recordPredictionDirect(marketId, probability);
    }
    return unsupportedSurfaceResult(surface, "recordPrediction");
}
async function claimWinnings(marketAddress, executionSurface) {
    const surface = resolveExecutionSurface(executionSurface);
    if (surface === "direct") {
        return claimWinningsDirect(marketAddress);
    }
    return unsupportedSurfaceResult(surface, "claimWinnings");
}
function isAgentConfigured() {
    return !!(config_1.config.AGENT_PRIVATE_KEY && config_1.config.AGENT_ADDRESS);
}
function getAgentAddress() {
    return config_1.config.AGENT_ADDRESS ?? null;
}
