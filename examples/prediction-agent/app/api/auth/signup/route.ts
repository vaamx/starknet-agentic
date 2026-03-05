import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createUser,
  rotateSession,
  sessionCookieName,
  validatePasswordStrength,
} from "@/lib/auth";
import {
  readClientIp,
  setCsrfCookie,
  validateMutatingRequest,
} from "@/lib/request-security";
import { checkRateLimit } from "@/lib/rate-limit";

const SignupSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(12).max(200),
});

export async function POST(request: NextRequest) {
  try {
    const mutationCheck = validateMutatingRequest(request);
    if (!mutationCheck.ok) {
      return NextResponse.json({ error: mutationCheck.reason }, { status: 403 });
    }

    const body = await request.json();
    const parsed = SignupSchema.parse(body);
    const ipAddress = readClientIp(request);
    const email = parsed.email.trim().toLowerCase();

    const ipLimit = checkRateLimit(`auth:signup:ip:${ipAddress}`, {
      windowMs: 60 * 60 * 1000,
      max: 6,
      blockMs: 60 * 60 * 1000,
    });
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: "Too many signup attempts. Try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(ipLimit.retryAfterMs / 1000)),
          },
        }
      );
    }

    const emailLimit = checkRateLimit(`auth:signup:email:${email}`, {
      windowMs: 60 * 60 * 1000,
      max: 3,
      blockMs: 60 * 60 * 1000,
    });
    if (!emailLimit.allowed) {
      return NextResponse.json(
        { error: "Too many signup attempts for this email. Try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(emailLimit.retryAfterMs / 1000)),
          },
        }
      );
    }

    const passwordIssue = validatePasswordStrength(parsed.password);
    if (passwordIssue) {
      return NextResponse.json({ error: passwordIssue }, { status: 400 });
    }

    const user = createUser({
      name: parsed.name,
      email,
      password: parsed.password,
    });

    const priorSessionToken = request.cookies.get(sessionCookieName())?.value;
    const session = rotateSession({
      userId: user.id,
      previousToken: priorSessionToken,
      ipAddress,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    const response = NextResponse.json({
      ok: true,
      user,
    });

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
