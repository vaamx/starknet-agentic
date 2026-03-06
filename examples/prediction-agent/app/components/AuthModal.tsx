"use client";

import { useEffect, useState } from "react";
import { ensureCsrfToken } from "@/lib/client-csrf";

export type AuthModalMode = "signin" | "signup";

interface AuthModalProps {
  open: boolean;
  initialMode?: AuthModalMode;
  onClose: () => void;
  onAuthenticated: () => void | Promise<void>;
}

interface ProviderTileProps {
  icon: React.ReactNode;
  label: string;
  hint: string;
  badge?: string;
  onClick?: () => void;
  disabled?: boolean;
}

function makeFriendlyError(input: unknown, fallback: string): string {
  if (typeof input === "string" && input.trim()) return input;
  if (Array.isArray(input) && input.length > 0) {
    return String((input[0] as { message?: string })?.message ?? fallback);
  }
  if (input && typeof input === "object") {
    const maybeError = (input as { error?: unknown }).error;
    if (typeof maybeError === "string" && maybeError.trim()) return maybeError;
  }
  return fallback;
}

function ProviderTile({
  icon,
  label,
  hint,
  badge,
  onClick,
  disabled = false,
}: ProviderTileProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`group w-full rounded-xl border px-3 py-3 text-left transition-all duration-200 ${
        disabled
          ? "cursor-not-allowed border-white/10 bg-white/[0.02] opacity-65"
          : "border-cyan-400/25 bg-cyan-400/[0.06] hover:-translate-y-[1px] hover:border-cyan-300/40 hover:bg-cyan-400/[0.10] active:translate-y-0"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#0a1324] text-white/90">
            {icon}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{label}</p>
            <p className="truncate text-[11px] text-white/55">{hint}</p>
          </div>
        </div>
        {badge && (
          <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide text-white/65">
            {badge}
          </span>
        )}
      </div>
    </button>
  );
}

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.3H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.7 1.1 7.8 2.9l5.7-5.7C33.9 6.1 29.2 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.5-.4-3.7z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15 18.9 12 24 12c3 0 5.7 1.1 7.8 2.9l5.7-5.7C33.9 6.1 29.2 4 24 4c-7.7 0-14.3 4.3-17.7 10.7z"/>
      <path fill="#4CAF50" d="M24 44c5.1 0 9.7-1.9 13.2-5.1l-6.1-5.2C29 35.2 26.6 36 24 36c-5.2 0-9.6-3.3-11.2-8l-6.6 5.1C9.6 39.6 16.3 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.3H42V20H24v8h11.3c-.8 2.2-2.2 4-4.2 5.3l6.1 5.2C36.8 38.8 44 34 44 24c0-1.3-.1-2.5-.4-3.7z"/>
    </svg>
  );
}

function XGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.9 2h3.4l-7.4 8.4L23.8 22h-7l-5.4-7.1L5.1 22H1.7l7.9-9L1 2h7.1l4.8 6.4L18.9 2zm-1.2 18h1.9L7 3.9H5z" />
    </svg>
  );
}

function FarcasterGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="6" fill="#8A63D2" />
      <path d="M7.5 8h9v2h-3v6h-2v-6h-2v6h-2V8z" fill="white" />
    </svg>
  );
}

function WalletGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h12A2.5 2.5 0 0 1 20 7.5V9h-6a2 2 0 0 0 0 4h6v1.5a2.5 2.5 0 0 1-2.5 2.5h-12A2.5 2.5 0 0 1 3 14.5z"/>
      <path d="M14 11h7v2h-7a1 1 0 1 1 0-2z"/>
    </svg>
  );
}

function MailGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}

function LockGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function UserGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  );
}

export default function AuthModal({
  open,
  initialMode = "signin",
  onClose,
  onAuthenticated,
}: AuthModalProps) {
  const [mode, setMode] = useState<AuthModalMode>(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
  }, [open, initialMode]);

  useEffect(() => {
    if (!open) return;
    ensureCsrfToken()
      .then(setCsrfToken)
      .catch(() => setError("Security initialization failed. Refresh and retry."));
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const token = csrfToken ?? (await ensureCsrfToken());
      const endpoint = mode === "signup" ? "/api/auth/signup" : "/api/auth/login";
      const body =
        mode === "signup"
          ? { name: name.trim(), email: email.trim(), password }
          : { email: email.trim(), password };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": token,
        },
        credentials: "include",
        body: JSON.stringify(body),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          makeFriendlyError(
            payload && typeof payload === "object" ? payload : null,
            mode === "signup" ? "Account creation failed" : "Sign in failed"
          )
        );
      }

      await onAuthenticated();
      setError(null);
      setPassword("");
      if (mode === "signin") {
        setEmail("");
      } else {
        setName("");
        setEmail("");
      }
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : mode === "signup"
            ? "Account creation failed"
            : "Sign in failed"
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  const submitLabel =
    submitting
      ? mode === "signup"
        ? "Creating account..."
        : "Signing in..."
      : mode === "signup"
        ? "Create Account"
        : "Sign In";

  return (
    <div className="fixed inset-0 z-[130] flex items-end justify-center p-0 sm:items-center sm:p-6">
      <button
        type="button"
        className="absolute inset-0 bg-[#020617]/85 backdrop-blur-md"
        onClick={onClose}
        aria-label="Close login dialog"
      />

      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute left-[-8rem] top-[-10rem] h-72 w-72 rounded-full bg-cyan-500/20 blur-3xl" />
        <div className="absolute right-[-8rem] bottom-[-10rem] h-80 w-80 rounded-full bg-blue-500/20 blur-3xl" />
      </div>

      <section
        role="dialog"
        aria-modal="true"
        aria-label="Log in or sign up"
        className="relative z-10 w-full overflow-hidden rounded-t-3xl border border-cyan-400/20 bg-[#050b18]/95 shadow-[0_30px_80px_rgba(2,6,23,0.8)] animate-sheet-up sm:max-w-[640px] sm:rounded-3xl sm:animate-modal-in"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(34,211,238,0.11),transparent_60%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/40 to-transparent" />

        <div className="relative px-4 pb-5 pt-4 sm:px-8 sm:pb-8 sm:pt-7">
          <div className="mb-4 flex items-start justify-between gap-4 sm:mb-5">
            <div className="animate-enter">
              <p className="inline-flex items-center rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.24em] text-cyan-200/90">
                HiveCaster Access
              </p>
              <h2 className="mt-3 font-heading text-2xl font-bold tracking-tight text-white sm:text-[2rem]">
                Log in or sign up
              </h2>
              <p className="mt-1.5 max-w-[38ch] text-xs text-slate-300/80 sm:text-sm">
                A Web2 onboarding feel, fully wired to Starknet-native wallets and agent execution.
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="h-10 w-10 shrink-0 rounded-full border border-white/10 bg-white/5 text-white/70 transition-all duration-200 hover:bg-white/10 hover:text-white"
              aria-label="Close"
            >
              <svg className="mx-auto h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m6 6 12 12" />
                <path d="m18 6-12 12" />
              </svg>
            </button>
          </div>

          <div className="animate-enter stagger-1">
            <ProviderTile
              icon={<WalletGlyph />}
              label="Continue with Starknet wallet"
              hint="Argent, Braavos, or any injected wallet"
              badge="Recommended"
              onClick={() => {
                window.dispatchEvent(new CustomEvent("hc-wallet-connect-open"));
                onClose();
              }}
            />
          </div>

          <div className="my-4 flex items-center gap-3 text-[11px] uppercase tracking-[0.22em] text-white/35 animate-enter stagger-2">
            <span className="h-px flex-1 bg-white/10" />
            <span>Email credentials</span>
            <span className="h-px flex-1 bg-white/10" />
          </div>

          <div className="relative mt-1 grid grid-cols-2 rounded-xl border border-white/10 bg-white/[0.03] p-1 animate-enter stagger-3">
            <span
              className={`pointer-events-none absolute bottom-1 top-1 left-1 w-[calc(50%-0.25rem)] rounded-lg bg-neo-brand transition-transform duration-200 ${
                mode === "signin" ? "translate-x-0" : "translate-x-full"
              }`}
            />
            <button
              type="button"
              onClick={() => {
                setMode("signin");
                setError(null);
              }}
              className={`relative z-10 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                mode === "signin" ? "text-white" : "text-white/65 hover:text-white"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("signup");
                setError(null);
              }}
              className={`relative z-10 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                mode === "signup" ? "text-white" : "text-white/65 hover:text-white"
              }`}
            >
              Create Account
            </button>
          </div>

          <form onSubmit={submit} className="mt-4 space-y-3 animate-enter stagger-4">
            {mode === "signup" && (
              <label className="group block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.15em] text-white/55">
                  Full Name
                </span>
                <span className="relative block">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/35">
                    <UserGlyph />
                  </span>
                  <input
                    type="text"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                    autoComplete="name"
                    className="w-full rounded-xl border border-white/12 bg-[#070f1e]/90 py-3 pl-10 pr-3 text-sm text-white placeholder:text-white/28 outline-none transition-all duration-200 focus:border-neo-brand/60 focus:bg-[#071326]"
                    placeholder="Ada Lovelace"
                  />
                </span>
              </label>
            )}

            <label className="group block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.15em] text-white/55">
                Email
              </span>
              <span className="relative block">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/35">
                  <MailGlyph />
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  autoComplete="email"
                  autoFocus={mode === "signin"}
                  className="w-full rounded-xl border border-white/12 bg-[#070f1e]/90 py-3 pl-10 pr-3 text-sm text-white placeholder:text-white/28 outline-none transition-all duration-200 focus:border-neo-brand/60 focus:bg-[#071326]"
                  placeholder="you@email.com"
                />
              </span>
            </label>

            <label className="group block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.15em] text-white/55">
                Password
              </span>
              <span className="relative block">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/35">
                  <LockGlyph />
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  minLength={mode === "signup" ? 12 : 1}
                  className="w-full rounded-xl border border-white/12 bg-[#070f1e]/90 py-3 pl-10 pr-3 text-sm text-white placeholder:text-white/28 outline-none transition-all duration-200 focus:border-neo-brand/60 focus:bg-[#071326]"
                  placeholder={mode === "signup" ? "12+ chars, include upper/lower/number/symbol" : "Your password"}
                />
              </span>
              {mode === "signup" && (
                <span className="mt-1 block text-[11px] text-white/45">
                  Must include upper/lowercase, number, and symbol.
                </span>
              )}
            </label>

            {error && (
              <p className="rounded-xl border border-red-400/25 bg-red-500/10 px-3 py-2 text-xs text-red-200" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting || !csrfToken}
              className="mt-1 w-full rounded-xl bg-neo-brand/20 border border-neo-brand/30 px-4 py-3 text-base font-heading font-bold text-neo-brand transition-all duration-200 hover:bg-neo-brand/30 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitLabel}
            </button>
          </form>

          <p className="mt-4 text-center text-[11px] leading-relaxed text-white/45 animate-enter stagger-5">
            By continuing you agree to HiveCaster Terms of Service and Privacy Policy.
          </p>
        </div>
      </section>
    </div>
  );
}
