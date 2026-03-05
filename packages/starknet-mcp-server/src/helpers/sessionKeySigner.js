/**
 * SessionKeySigner — produces 4-felt signatures compatible with chipi-pay session contracts.
 *
 * Signature format: [session_pubkey, r, s, valid_until]
 *
 * The contract's __validate__ computes a Poseidon hash of:
 *   [account_address, chain_id, nonce, valid_until, ...calls_data]
 * and verifies ECDSA(hash, session_pubkey, r, s).
 *
 * This signer replicates that hash computation on the client side.
 */
import { num, Signer, SignerInterface, ec, hash, } from "starknet";
export class SessionKeySigner extends SignerInterface {
    sessionPrivateKey;
    sessionPublicKey;
    validUntil;
    innerSigner;
    /**
     * @param sessionPrivateKey - Private key for the session key pair (hex string)
     * @param sessionPublicKey - Public key registered on-chain (hex string)
     * @param validUntil - Unix timestamp (seconds) when this session expires
     */
    constructor(sessionPrivateKey, sessionPublicKey, validUntil) {
        super();
        this.sessionPrivateKey = sessionPrivateKey;
        this.sessionPublicKey = sessionPublicKey;
        this.validUntil = validUntil;
        this.innerSigner = new Signer(sessionPrivateKey);
    }
    async getPubKey() {
        return this.sessionPublicKey;
    }
    async signMessage(typedData, accountAddress) {
        // For SNIP-9 outside execution, delegate to inner signer
        return this.innerSigner.signMessage(typedData, accountAddress);
    }
    /**
     * Sign a transaction using the session key.
     *
     * Computes the same Poseidon message hash as the contract's _session_message_hash,
     * signs it with ECDSA, and returns [session_pubkey, r, s, valid_until].
     */
    async signTransaction(transactions, transactionsDetail) {
        // Build the same hash data array as the contract's _session_message_hash:
        // [account_address, chain_id, nonce, valid_until, ...for each call: to, selector, calldata_len, ...calldata]
        const hashData = [];
        const accountAddress = "accountAddress" in transactionsDetail
            ? transactionsDetail.accountAddress
            : transactionsDetail.walletAddress;
        if (!accountAddress) {
            throw new Error("SessionKeySigner: cannot determine account address from transaction details. " +
                "Ensure the Account object is correctly configured.");
        }
        hashData.push(BigInt(accountAddress));
        // Chain ID
        hashData.push(BigInt(transactionsDetail.chainId));
        // Nonce
        hashData.push(BigInt(transactionsDetail.nonce));
        // Valid until
        hashData.push(BigInt(this.validUntil));
        // Each call: to, selector (as felt), calldata_len, ...calldata
        for (const call of transactions) {
            hashData.push(BigInt(call.contractAddress));
            // Convert entrypoint name to selector if it's a string name
            const selectorFelt = call.entrypoint.startsWith("0x")
                ? BigInt(call.entrypoint)
                : BigInt(hash.getSelectorFromName(call.entrypoint));
            hashData.push(selectorFelt);
            const calldata = Array.isArray(call.calldata)
                ? call.calldata.map((c) => (typeof c === "string" ? c : String(c)))
                : [];
            hashData.push(BigInt(calldata.length));
            for (const d of calldata) {
                hashData.push(BigInt(d));
            }
        }
        // Compute Poseidon hash (same as contract's poseidon_hash_span)
        const hashDataHex = hashData.map((n) => num.toHex(n));
        const msgHash = hash.computePoseidonHashOnElements(hashDataHex);
        // ECDSA sign with session private key
        const signature = ec.starkCurve.sign(msgHash, this.sessionPrivateKey);
        return [
            this.sessionPublicKey,
            num.toHex(signature.r),
            num.toHex(signature.s),
            num.toHex(this.validUntil),
        ];
    }
    async signDeployAccountTransaction(_transaction) {
        throw new Error("Session key signer cannot sign deploy account transactions");
    }
    async signDeclareTransaction(_transaction) {
        throw new Error("Session key signer cannot sign declare transactions");
    }
}
