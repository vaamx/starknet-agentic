import { type Call, type DeclareSignerDetails, type DeployAccountSignerDetails, type InvocationsSignerDetails, type Signature, type TypedData, SignerInterface } from "starknet";
export type StarknetSignerMode = "direct" | "proxy";
type KeyringProxySignerConfig = {
    proxyUrl: string;
    hmacSecret: string;
    clientId: string;
    accountAddress: string;
    requestTimeoutMs: number;
    sessionValiditySeconds: number;
    keyId?: string;
    tlsClientCertPath?: string;
    tlsClientKeyPath?: string;
    tlsCaPath?: string;
};
export declare class KeyringProxySigner extends SignerInterface {
    private readonly endpointPath;
    private readonly config;
    private cachedSessionPublicKey?;
    private readonly mtlsClientMaterial?;
    constructor(config: KeyringProxySignerConfig);
    private postJsonViaMtls;
    getPubKey(): Promise<string>;
    signMessage(_typedData: TypedData, _accountAddress: string): Promise<Signature>;
    signTransaction(transactions: Call[], transactionsDetail: InvocationsSignerDetails): Promise<Signature>;
    signDeployAccountTransaction(_transaction: DeployAccountSignerDetails): Promise<Signature>;
    signDeclareTransaction(_transaction: DeclareSignerDetails): Promise<Signature>;
}
export {};
