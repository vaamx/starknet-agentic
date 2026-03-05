"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ensureCsrfToken } from "@/lib/client-csrf";

export default function LoginPage() {
  const router = useRouter();
  const [nextPath, setNextPath] = useState("/");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const nextParam =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("next")
        : null;
    if (nextParam) {
      setNextPath(nextParam);
    }

    ensureCsrfToken()
      .then(setCsrfToken)
      .catch(() => setError("Security initialization failed. Refresh and retry."));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const token = csrfToken ?? (await ensureCsrfToken());
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": token,
        },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error ?? "Login failed");
      }
      router.replace(nextPath);
    } catch (err: any) {
      setError(err?.message ?? "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-cream bg-grid flex items-center justify-center px-4">
      <div className="w-full max-w-md neo-card border-2 border-black bg-white p-6">
        <h1 className="font-heading font-bold text-2xl mb-1">HiveCaster Login</h1>
        <p className="text-sm text-gray-500 mb-6">
          Production-grade superforecasting control panel.
        </p>

        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wide mb-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="neo-input w-full"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wide mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="neo-input w-full"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading || !csrfToken}
            className="neo-btn-primary w-full text-sm py-2.5 disabled:opacity-40"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        {error && (
          <p className="mt-3 text-xs text-red-600 font-mono">{error}</p>
        )}

        <p className="text-xs text-gray-500 mt-4">
          New here?{" "}
          <Link href="/signup" className="font-semibold underline">
            Create an account
          </Link>
        </p>
      </div>
    </main>
  );
}
