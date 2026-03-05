import { NextRequest, NextResponse } from "next/server";
export declare function GET(_request: NextRequest, { params }: {
    params: Promise<{
        id: string;
    }>;
}): Promise<NextResponse<{
    market: any;
    predictions: any;
    weightedProbability: any;
}> | NextResponse<{
    error: any;
}>>;
