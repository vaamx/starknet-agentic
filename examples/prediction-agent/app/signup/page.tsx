"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error ?? "Signup failed");
      }
      router.replace("/");
    } catch (err: any) {
      setError(err?.message ?? "Signup failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-cream bg-grid flex items-center justify-center px-4">
      <div className="w-full max-w-md neo-card border-2 border-black bg-white p-6">
        <h1 className="font-heading font-bold text-2xl mb-1">Create Account</h1>
        <p className="text-sm text-gray-500 mb-6">
          Traditional Web2 onboarding for your agentic quant workspace.
        </p>

        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wide mb-1">
              Full Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="neo-input w-full"
              required
            />
          </div>

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
              minLength={10}
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="neo-btn-primary w-full text-sm py-2.5 disabled:opacity-40"
          >
            {loading ? "Creating account..." : "Sign Up"}
          </button>
        </form>

        {error && (
          <p className="mt-3 text-xs text-red-600 font-mono">{error}</p>
        )}

        <p className="text-xs text-gray-500 mt-4">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
