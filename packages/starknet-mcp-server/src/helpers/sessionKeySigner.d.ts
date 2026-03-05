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
import { Call, DeclareSignerDetails, DeployAccountSignerDetails, InvocationsSignerDetails, SignerInterface, Signature, TypedData } from "starknet";
export declare class SessionKeySigner extends SignerInterface {
    private sessionPrivateKey;
    private sessionPublicKey;
    private validUntil;
    private innerSigner;
    /**
     * @param sessionPrivateKey - Private key for the session key pair (hex string)
     * @param sessionPublicKey - Public key registered on-chain (hex string)
     * @param validUntil - Unix timestamp (seconds) when this session expires
     */
    constructor(sessionPrivateKey: string, sessionPublicKey: string, validUntil: number);
    getPubKey(): Promise<string>;
    signMessage(typedData: TypedData, accountAddress: string): Promise<Signature>;
    /**
     * Sign a transaction using the session key.
     *
     * Computes the same Poseidon message hash as the contract's _session_message_hash,
     * signs it with ECDSA, and returns [session_pubkey, r, s, valid_until].
     */
    signTransaction(transactions: Call[], transactionsDetail: InvocationsSignerDetails): Promise<Signature>;
    signDeployAccountTransaction(_transaction: DeployAccountSignerDetails): Promise<Signature>;
    signDeclareTransaction(_transaction: DeclareSignerDetails): Promise<Signature>;
}
