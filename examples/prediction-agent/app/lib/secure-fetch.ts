"use client";

import { ensureCsrfToken } from "./client-csrf";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function resolveMethod(init: RequestInit): string {
  return (init.method ?? "GET").toUpperCase();
}

export async function fetchWithCsrf(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const method = resolveMethod(init);
  if (!MUTATING_METHODS.has(method)) {
    return fetch(input, init);
  }

  const token = await ensureCsrfToken();
  const headers = new Headers(init.headers);
  headers.set("x-csrf-token", token);

  return fetch(input, {
    ...init,
    method,
    headers,
    credentials: init.credentials ?? "same-origin",
  });
}

export async function postJsonWithCsrf(
  input: RequestInfo | URL,
  body: unknown,
  init: Omit<RequestInit, "method" | "body"> = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return fetchWithCsrf(input, {
    ...init,
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}
