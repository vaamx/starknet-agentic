import { NextRequest } from "next/server";
/**
 * Single Agent endpoint.
 * GET: Agent detail.
 * POST: Control agent (stop/pause/resume).
 * DELETE: Remove agent.
 */
export declare function GET(_request: NextRequest, { params }: {
    params: Promise<{
        id: string;
    }>;
}): Promise<Response>;
export declare function POST(request: NextRequest, { params }: {
    params: Promise<{
        id: string;
    }>;
}): Promise<Response>;
export declare function DELETE(_request: NextRequest, { params }: {
    params: Promise<{
        id: string;
    }>;
}): Promise<Response>;
