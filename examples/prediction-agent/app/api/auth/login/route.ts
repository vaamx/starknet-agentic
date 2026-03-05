import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  rotateSession,
  sessionCookieName,
  verifyUserCredentials,
} from "@/lib/auth";
import {
  readClientIp,
  setCsrfCookie,
  validateMutatingRequest,
} from "@/lib/request-security";
import { checkRateLimit } from "@/lib/rate-limit";

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const mutationCheck = validateMutatingRequest(request);
    if (!mutationCheck.ok) {
      return NextResponse.json({ error: mutationCheck.reason }, { status: 403 });
    }

    const body = await request.json();
    const parsed = LoginSchema.parse(body);
    const ipAddress = readClientIp(request);
    const email = parsed.email.trim().toLowerCase();

    const ipLimit = checkRateLimit(`auth:login:ip:${ipAddress}`, {
      windowMs: 60_000,
      max: 12,
      blockMs: 5 * 60_000,
    });
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: "Too many login attempts. Try again shortly." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(ipLimit.retryAfterMs / 1000)),
          },
        }
      );
    }

    const accountLimit = checkRateLimit(`auth:login:acct:${email}:${ipAddress}`, {
      windowMs: 60_000,
      max: 8,
      blockMs: 5 * 60_000,
    });
    if (!accountLimit.allowed) {
      return NextResponse.json(
        { error: "Too many login attempts. Try again shortly." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(accountLimit.retryAfterMs / 1000)),
          },
        }
      );
    }

    const user = verifyUserCredentials(email, parsed.password);
    if (!user) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const priorSessionToken = request.cookies.get(sessionCookieName())?.value;
    const session = rotateSession({
      userId: user.id,
      previousToken: priorSessionToken,
      ipAddress,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    const response = NextResponse.json({ ok: true, user });
    response.cookies.set(sessionCookieName(), session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    setCsrfCookie(response);
    return response;
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 });
    }
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
