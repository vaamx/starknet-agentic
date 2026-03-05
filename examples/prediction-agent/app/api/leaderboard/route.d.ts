import { NextResponse } from "next/server";
export declare function GET(): Promise<NextResponse<{
    leaderboard: any;
}> | NextResponse<{
    error: any;
}>>;
