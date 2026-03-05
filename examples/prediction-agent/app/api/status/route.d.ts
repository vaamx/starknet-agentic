import { NextResponse } from "next/server";
export declare function GET(): Promise<NextResponse<{
    agentConfigured: any;
    agentAddress: any;
    agentId: string;
    identity: any;
    contractsDeployed: boolean;
    anthropicConfigured: boolean;
    identityRegistryConfigured: boolean;
    reputationRegistryConfigured: boolean;
}>>;
