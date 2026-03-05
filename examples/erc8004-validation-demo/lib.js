import { CallData, byteArray, cairo, hash } from "starknet";
export function toU256Calldata(value) {
    const u = cairo.uint256(value);
    // CallData.compile flattens to string[].
    return CallData.compile(u);
}
export function parseU256FromFelts(low, high) {
    return BigInt(low) + (BigInt(high) << 128n);
}
export function parseValidationRequestHashFromReceipt(args) {
    const selector = hash.getSelectorFromName("ValidationRequest");
    const events = args.receipt.events || [];
    for (const ev of events) {
        if (!ev.keys || ev.keys.length < 6) {
            continue;
        }
        if (ev.keys[0] !== selector) {
            continue;
        }
        // keys = [selector, validator_address, agent_id_low, agent_id_high, request_hash_low, request_hash_high]
        const validator = ev.keys[1];
        const agentId = parseU256FromFelts(ev.keys[2], ev.keys[3]);
        const requestHash = parseU256FromFelts(ev.keys[4], ev.keys[5]);
        if (args.expectedValidator && validator.toLowerCase() != args.expectedValidator.toLowerCase()) {
            continue;
        }
        if (args.expectedAgentId !== undefined && agentId !== args.expectedAgentId) {
            continue;
        }
        return requestHash;
    }
    throw new Error("Failed to find ValidationRequest event in tx receipt");
}
export async function readTotalAgents(args) {
    const res = await args.provider.callContract({
        contractAddress: args.identityRegistry,
        entrypoint: "total_agents",
        calldata: [],
    });
    // total_agents() -> u256 (low, high)
    return parseU256FromFelts(res.result[0], res.result[1]);
}
export async function readAgentExists(args) {
    const res = await args.provider.callContract({
        contractAddress: args.identityRegistry,
        entrypoint: "agent_exists",
        calldata: toU256Calldata(args.agentId),
    });
    return BigInt(res.result[0]) !== 0n;
}
export async function readValidationSummary(args) {
    // get_summary(agent_id, validator_addresses, tag)
    // validator_addresses is Span<ContractAddress>: pass empty span.
    const calldata = [
        ...toU256Calldata(args.agentId),
        "0x0", // span length
        ...CallData.compile(byteArray.byteArrayFromString(args.tag)),
    ];
    const res = await args.provider.callContract({
        contractAddress: args.validationRegistry,
        entrypoint: "get_summary",
        calldata,
    });
    // returns (u64 count, u8 avg)
    return { count: BigInt(res.result[0]), avg: BigInt(res.result[1]) };
}
