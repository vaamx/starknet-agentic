export type KeyringAuthErrorCode = "AUTH_INVALID_HMAC" | "AUTH_INVALID_NONCE" | "AUTH_INVALID_SIGNATURE_FORMAT" | "AUTH_INVALID_CLIENT" | "AUTH_TIMESTAMP_SKEW" | "AUTH_MTLS_REQUIRED" | "REPLAY_NONCE_USED" | "POLICY_SELECTOR_DENIED" | "POLICY_CALL_NOT_ALLOWED" | "RATE_LIMITED" | "SIGNER_UNAVAILABLE" | "INTERNAL_ERROR";
export type KeyringAuthClient = {
    hmacSecret?: string;
    hmacSecrets?: string[];
};
export type KeyringAuthHeaders = Record<string, string | undefined>;
export type KeyringAuthNonceStore = {
    consumeOnce(key: string, ttlSeconds: number, nowMs: number): Promise<boolean>;
};
export type KeyringAuthValidationInput = {
    method: string;
    path: string;
    rawBody: string;
    headers: KeyringAuthHeaders;
    nowMs: number;
    clientsById: Record<string, KeyringAuthClient>;
    requireMtls: boolean;
    isMtlsAuthenticated: boolean;
    timestampMaxAgeMs: number;
    nonceTtlSeconds: number;
    nonceStore: KeyringAuthNonceStore;
};
export type KeyringAuthValidationResult = {
    ok: true;
    clientId: string;
    nonce: string;
    timestampMs: number;
    signingPayload: string;
    replayKey: string;
} | {
    ok: false;
    errorCode: KeyringAuthErrorCode;
    message: string;
};
export declare function buildKeyringSigningPayload(args: {
    timestamp: string;
    nonce: string;
    method: string;
    path: string;
    rawBody: string;
}): string;
export declare class InMemoryNonceStore implements KeyringAuthNonceStore {
    private readonly nonceExpirations;
    private readonly cleanupEvery;
    private consumeCount;
    constructor(cleanupEvery?: number);
    consumeOnce(key: string, ttlSeconds: number, nowMs: number): Promise<boolean>;
}
export declare function validateKeyringRequestAuth(input: KeyringAuthValidationInput): Promise<KeyringAuthValidationResult>;
