import { NextResponse } from "next/server";
export declare function GET(): Promise<NextResponse<{
    markets: any;
}> | NextResponse<{
    error: any;
}>>;
