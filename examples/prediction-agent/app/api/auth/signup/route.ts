import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createSession,
  createUser,
  sessionCookieName,
} from "@/lib/auth";

const SignupSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(10).max(200),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = SignupSchema.parse(body);

    const user = createUser({
      name: parsed.name,
      email: parsed.email,
      password: parsed.password,
    });

    const session = createSession({
      userId: user.id,
      ipAddress: request.headers.get("x-forwarded-for") ?? undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    const response = NextResponse.json({
      ok: true,
      user,
    });

    response.cookies.set(sessionCookieName(), session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    return response;
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 });
    }
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
