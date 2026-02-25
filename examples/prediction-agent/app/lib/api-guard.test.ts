import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import {
  buildActorFingerprintFromHeaders,
  enforceRateLimit,
  getClientIpFromHeaders,
  getRequestSecret,
} from "./api-guard";

describe("api-guard actor fingerprint", () => {
  it("uses first x-forwarded-for entry as client IP", () => {
    const headers = new Headers({
      "x-forwarded-for": "198.51.100.20, 10.0.0.4",
    });
    expect(getClientIpFromHeaders(headers)).toBe("198.51.100.20");
  });

  it("uses explicit wallet header when present", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.6",
      "user-agent": "forecast-client/1.0",
      "x-wallet-address":
        "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    });

    const actor = buildActorFingerprintFromHeaders(headers);
    expect(actor).toContain("ip:203.0.113.6");
    expect(actor).toContain(
      "wallet:0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
    );
    expect(actor).toContain("ua:forecast-client/1.0");
  });

  it("extracts callerAddress from x-payment-signature payload", () => {
    const paymentPayload = {
      callerAddress:
        "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      message: {},
      signature: [],
    };
    const encoded = Buffer.from(JSON.stringify(paymentPayload)).toString(
      "base64"
    );

    const headers = new Headers({
      "x-real-ip": "192.0.2.10",
      "x-payment-signature": encoded,
    });

    const actor = buildActorFingerprintFromHeaders(headers);
    expect(actor).toContain("ip:192.0.2.10");
    expect(actor).toContain(
      "wallet:0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    );
  });

  it("falls back to anon wallet for malformed values", () => {
    const headers = new Headers({
      "x-wallet-address": "not-a-wallet",
      "user-agent": "Mozilla/5.0",
    });
    const actor = buildActorFingerprintFromHeaders(headers);
    expect(actor).toContain("wallet:anon");
  });
});

describe("api-guard request secret", () => {
  it("prefers x-heartbeat-secret over Authorization", () => {
    const request = new NextRequest("https://example.com/api/heartbeat", {
      method: "POST",
      headers: {
        "x-heartbeat-secret": "header-secret",
        authorization: "Bearer token-secret",
      },
    });

    expect(getRequestSecret(request)).toBe("header-secret");
  });

  it("falls back to bearer token when heartbeat header is absent", () => {
    const request = new NextRequest("https://example.com/api/heartbeat", {
      method: "POST",
      headers: {
        authorization: "Bearer bearer-secret",
      },
    });

    expect(getRequestSecret(request)).toBe("bearer-secret");
  });
});

describe("api-guard rate limit", () => {
  it("returns 429 after exceeding the configured bucket", async () => {
    const scope = `rate_limit_test_${Date.now()}`;

    const createRequest = () =>
      new NextRequest("https://example.com/api/predict", {
        method: "POST",
        headers: {
          "x-forwarded-for": "198.51.100.90",
          "user-agent": "vitest-agent",
        },
      });

    const first = await enforceRateLimit(createRequest(), scope, {
      windowMs: 60_000,
      maxRequests: 2,
    });
    const second = await enforceRateLimit(createRequest(), scope, {
      windowMs: 60_000,
      maxRequests: 2,
    });
    const third = await enforceRateLimit(createRequest(), scope, {
      windowMs: 60_000,
      maxRequests: 2,
    });

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(third?.status).toBe(429);
  });
});
