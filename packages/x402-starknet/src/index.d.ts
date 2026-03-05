import { type TypedData } from "starknet";
export type X402PaymentRequired = {
    /** opaque scheme id, ex: exact-starknet */
    scheme: string;
    /** facilitator URL */
    facilitator?: string;
    /** typedData the client must sign for Starknet exact scheme */
    typedData?: TypedData;
    /** optional extra fields */
    [k: string]: unknown;
};
export type X402PaymentSignature = {
    scheme: string;
    typedData: TypedData;
    signature: unknown;
    address: string;
    [k: string]: unknown;
};
export declare function decodeBase64Json<T = unknown>(v: string): T;
/**
 * Encodes as base64url (RFC 4648) without padding.
 * This is generally safer for HTTP header values.
 */
export declare function encodeBase64Json(value: unknown): string;
/**
 * Create PAYMENT-SIGNATURE header value for Starknet by signing the typedData contained in PAYMENT-REQUIRED.
 *
 * This is intentionally generic: it does not assume a specific facilitator implementation.
 */
export declare function createStarknetPaymentSignatureHeader(args: {
    paymentRequiredHeader: string;
    rpcUrl: string;
    accountAddress: string;
    privateKey: string;
}): Promise<{
    headerValue: string;
    payload: X402PaymentSignature;
}>;
export declare function createStarknetPaymentSignatureHeader(args: {
    paymentRequired: X402PaymentRequired;
    rpcUrl: string;
    accountAddress: string;
    privateKey: string;
}): Promise<{
    headerValue: string;
    payload: X402PaymentSignature;
}>;
