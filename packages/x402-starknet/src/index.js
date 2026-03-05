import { Account, RpcProvider } from "starknet";
function base64ToBuffer(input) {
    // Accept both base64 and base64url.
    // base64url uses -_ and often omits padding.
    const normalized = input.replace(/-/g, "+").replace(/_/g, "/").trim();
    // Length mod 4 === 1 is not a valid base64/base64url length.
    // Guard to avoid silently decoding garbage.
    if (normalized.length % 4 === 1) {
        throw new Error("Invalid base64/base64url string length");
    }
    const padLen = (4 - (normalized.length % 4)) % 4;
    const padded = normalized + "=".repeat(padLen);
    return Buffer.from(padded, "base64");
}
function bufferToBase64Url(buf) {
    const base64 = buf.toString("base64");
    const base64Url = base64.replaceAll("+", "-").replaceAll("/", "_");
    let end = base64Url.length;
    while (end > 0 && base64Url.charAt(end - 1) === "=") {
        end -= 1;
    }
    return base64Url.slice(0, end);
}
export function decodeBase64Json(v) {
    return JSON.parse(base64ToBuffer(v).toString("utf8"));
}
/**
 * Encodes as base64url (RFC 4648) without padding.
 * This is generally safer for HTTP header values.
 */
export function encodeBase64Json(value) {
    return bufferToBase64Url(Buffer.from(JSON.stringify(value), "utf8"));
}
export async function createStarknetPaymentSignatureHeader(args) {
    const paymentRequired = args.paymentRequired ??
        (args.paymentRequiredHeader
            ? decodeBase64Json(args.paymentRequiredHeader)
            : undefined);
    if (!paymentRequired)
        throw new Error("Missing paymentRequired");
    if (!paymentRequired.typedData)
        throw new Error("paymentRequired.typedData missing");
    const provider = new RpcProvider({ nodeUrl: args.rpcUrl });
    const account = new Account({ provider, address: args.accountAddress, signer: args.privateKey });
    // starknet.js signs typedData per SNIP-12.
    const signature = await account.signMessage(paymentRequired.typedData);
    // Preserve any additional metadata from PAYMENT-REQUIRED (facilitator, extensions, etc).
    // Explicit keys win, so we don't let unknown fields override scheme/typedData/signature/address.
    const payload = {
        ...paymentRequired,
        scheme: paymentRequired.scheme,
        typedData: paymentRequired.typedData,
        signature,
        address: args.accountAddress,
    };
    return { headerValue: encodeBase64Json(payload), payload };
}
