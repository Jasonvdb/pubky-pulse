"use client";

import { useState } from "react";
import { Check, Mail } from "lucide-react";
import { useUser } from "@/hooks/use-user";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LandingAuth() {
  const { user, isLoading, mutate } = useUser();
  const [step, setStep] = useState<"email" | "code" | "done">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const isAuthenticated = !!user;

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api.post("/v1/auth/send-code", { email });
      setStep("code");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to send code");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api.post("/v1/auth/verify-code", { email, code });
      await mutate();
      setStep("done");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  }

  if (isLoading) {
    return (
      <div className="animate-pulse rounded-xl bg-card px-5 py-6 shadow-sm">
        <div className="h-4 w-48 rounded bg-muted" />
        <div className="mt-4 h-10 rounded bg-muted" />
      </div>
    );
  }

  // Authenticated state — compact success banner
  if (isAuthenticated || step === "done") {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-card px-5 py-4 shadow-sm">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/16">
          <Check className="h-4 w-4 text-brand" />
        </div>
        <p className="text-sm font-medium text-card-foreground">
          Signed in as <span className="text-muted-foreground">{user?.email}</span>
        </p>
      </div>
    );
  }

  const errorBanner = error ? (
    <div
      role="alert"
      className="mb-3 rounded-md border border-destructive/40 bg-destructive/15 px-3 py-2 text-xs text-destructive-foreground"
    >
      {error}
    </div>
  ) : null;

  // Unauthenticated — email or code form
  return (
    <div className="rounded-xl bg-card px-5 py-5 shadow-sm">
      {step === "email" ? (
        <form onSubmit={handleSendCode}>
          <div className="mb-3 flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Sign in to get your API key pre-filled below
            </p>
          </div>
          {errorBanner}
          <div className="flex gap-2">
            <Input
              type="email"
              placeholder="you@example.com"
              aria-label="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="h-10 flex-1"
            />
            <Button type="submit" variant="brand" disabled={loading}>
              {loading ? "Sending..." : "Send code"}
            </Button>
          </div>
        </form>
      ) : (
        <form onSubmit={handleVerifyCode}>
          <p className="mb-3 text-sm text-muted-foreground">
            Enter the code sent to <span className="text-card-foreground">{email}</span>
          </p>
          {errorBanner}
          <div className="flex gap-2">
            <Input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="000000"
              aria-label="Six-digit verification code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              required
              autoFocus
              className="h-10 w-32 text-center font-mono text-lg tracking-[0.3em]"
            />
            <Button type="submit" variant="brand" disabled={loading || code.length !== 6}>
              {loading ? "Verifying..." : "Verify"}
            </Button>
          </div>
          <button
            type="button"
            onClick={() => {
              setStep("email");
              setCode("");
              setError("");
            }}
            className="mt-2.5 cursor-pointer rounded-md text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            Use a different email
          </button>
        </form>
      )}
    </div>
  );
}
