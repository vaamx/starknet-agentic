import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
const MIN_NONCE_LENGTH = 16;
const MAX_NONCE_LENGTH = 256;
function sha256Hex(input) {
    return createHash("sha256").update(input).digest("hex");
}
function normalizeHeaders(headers) {
    const normalized = {};
    for (const [key, value] of Object.entries(headers)) {
        if (typeof value !== "string")
            continue;
        normalized[key.toLowerCase()] = value;
    }
    return normalized;
}
function isHex(value) {
    return /^[0-9a-fA-F]+$/.test(value);
}
function fail(errorCode, message) {
    return { ok: false, errorCode, message };
}
function constantTimeHexEqual(leftHex, rightHex) {
    if (leftHex.length !== rightHex.length || leftHex.length % 2 !== 0) {
        return false;
    }
    const left = Buffer.from(leftHex, "hex");
    const right = Buffer.from(rightHex, "hex");
    return timingSafeEqual(left, right);
}
export function buildKeyringSigningPayload(args) {
    return `${args.timestamp}.${args.nonce}.${args.method.toUpperCase()}.${args.path}.${sha256Hex(args.rawBody)}`;
}
export class InMemoryNonceStore {
    // This in-process store is for local/dev use only.
    // Multi-instance production deployments must use an external atomic store
    // (for example Redis SET NX EX) to avoid replay races across workers.
    nonceExpirations = new Map();
    cleanupEvery;
    consumeCount = 0;
    constructor(cleanupEvery = 100) {
        this.cleanupEvery = Math.max(1, cleanupEvery);
    }
    async consumeOnce(key, ttlSeconds, nowMs) {
        const existingExpiration = this.nonceExpirations.get(key);
        if (existingExpiration !== undefined && existingExpiration > nowMs) {
            return false;
        }
        this.consumeCount += 1;
        if (this.consumeCount % this.cleanupEvery === 0) {
            for (const [storedKey, expiresAt] of this.nonceExpirations.entries()) {
                if (expiresAt <= nowMs) {
                    this.nonceExpirations.delete(storedKey);
                }
            }
        }
        const ttlMs = Math.max(1, ttlSeconds) * 1000;
        this.nonceExpirations.set(key, nowMs + ttlMs);
        return true;
    }
}
export async function validateKeyringRequestAuth(input) {
    const headers = normalizeHeaders(input.headers);
    const clientId = headers["x-keyring-client-id"]?.trim() ?? "";
    if (!clientId) {
        return fail("AUTH_INVALID_CLIENT", "Missing X-Keyring-Client-Id");
    }
    if (input.requireMtls && !input.isMtlsAuthenticated) {
        return fail("AUTH_MTLS_REQUIRED", "mTLS client authentication is required");
    }
    const client = input.clientsById[clientId];
    const clientSecrets = (client
        ? [
            ...(Array.isArray(client.hmacSecrets) ? client.hmacSecrets : []),
            ...(client.hmacSecret ? [client.hmacSecret] : []),
        ]
        : []).filter((secret) => typeof secret === "string" && secret.length > 0);
    const uniqueClientSecrets = [...new Set(clientSecrets)];
    if (!client || uniqueClientSecrets.length === 0) {
        return fail("AUTH_INVALID_CLIENT", "Unknown keyring client");
    }
    const timestampRaw = headers["x-keyring-timestamp"]?.trim() ?? "";
    const nonce = headers["x-keyring-nonce"]?.trim() ?? "";
    const signatureRaw = headers["x-keyring-signature"]?.trim() ?? "";
    if (!timestampRaw || !/^[0-9]+$/.test(timestampRaw)) {
        return fail("AUTH_TIMESTAMP_SKEW", "Invalid X-Keyring-Timestamp");
    }
    const timestampMs = Number(timestampRaw);
    if (!Number.isSafeInteger(timestampMs)) {
        return fail("AUTH_TIMESTAMP_SKEW", "Invalid X-Keyring-Timestamp");
    }
    const skew = Math.abs(input.nowMs - timestampMs);
    if (skew > input.timestampMaxAgeMs) {
        return fail("AUTH_TIMESTAMP_SKEW", "Timestamp outside allowed drift window");
    }
    const nonceByteLength = Buffer.byteLength(nonce, "utf8");
    if (!nonce ||
        nonceByteLength < MIN_NONCE_LENGTH ||
        nonceByteLength > MAX_NONCE_LENGTH ||
        nonce.includes(".")) {
        return fail("AUTH_INVALID_NONCE", "Invalid X-Keyring-Nonce");
    }
    if (!signatureRaw || !isHex(signatureRaw)) {
        return fail("AUTH_INVALID_SIGNATURE_FORMAT", "Invalid X-Keyring-Signature");
    }
    const signingPayload = buildKeyringSigningPayload({
        timestamp: timestampRaw,
        nonce,
        method: input.method,
        path: input.path,
        rawBody: input.rawBody,
    });
    const suppliedSignature = signatureRaw.toLowerCase();
    const HMAC_COMPARE_FLOOR = 4;
    const compareCount = Math.max(HMAC_COMPARE_FLOOR, uniqueClientSecrets.length);
    const dummyPadSecret = randomBytes(32).toString("hex");
    let hmacMatched = false;
    for (let i = 0; i < compareCount; i += 1) {
        const isRealSecretIndex = i < uniqueClientSecrets.length;
        const secret = isRealSecretIndex ? uniqueClientSecrets[i] : `${dummyPadSecret}:${i}`;
        const expectedSignature = createHmac("sha256", secret).update(signingPayload).digest("hex");
        const matches = constantTimeHexEqual(suppliedSignature, expectedSignature);
        if (isRealSecretIndex) {
            hmacMatched = hmacMatched || matches;
        }
    }
    if (!hmacMatched) {
        return fail("AUTH_INVALID_HMAC", "HMAC verification failed");
    }
    const replayKey = JSON.stringify([clientId, nonce]);
    try {
        const firstUse = await input.nonceStore.consumeOnce(replayKey, input.nonceTtlSeconds, input.nowMs);
        if (!firstUse) {
            return fail("REPLAY_NONCE_USED", "Nonce already consumed");
        }
    }
    catch (error) {
        console.error("Replay protection store failure", error);
        return fail("INTERNAL_ERROR", "Replay protection store failure");
    }
    return {
        ok: true,
        clientId,
        nonce,
        timestampMs,
        signingPayload,
        replayKey,
    };
}
