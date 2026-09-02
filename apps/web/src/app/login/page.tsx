"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PulseLogo } from "@/components/pulse-logo";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect");
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
      // Redirect to the original page if present (prevent open redirect)
      const target = redirect && redirect.startsWith("/") ? redirect : "/dashboard";
      router.push(target);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* Branded panel */}
      <div className="relative hidden items-center justify-center overflow-hidden bg-card lg:flex lg:w-[45%]">
        {/* Decorative brand glow — the only ornament on the panel. */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 h-[30rem] w-[30rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/10 blur-3xl"
        />

        <div className="relative z-10 animate-fade-in space-y-6 px-12 text-center">
          <PulseLogo className="mx-auto h-12 w-12 text-brand" alt="Pubky Pulse" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              Pubky Pulse
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Self-hosted observability for web, backend and mobile apps
            </p>
          </div>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="w-full max-w-sm animate-fade-in-up">
          <div className="lg:hidden flex items-center gap-2.5 mb-8">
            <PulseLogo className="h-7 w-7 text-brand" />
            <span className="text-xl font-bold tracking-tight">Pubky Pulse</span>
          </div>

          <div className="space-y-1.5 mb-8">
            <h2 className="text-2xl font-semibold tracking-tight">
              {step === "email" ? "Sign in" : "Enter verification code"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {step === "email"
                ? "Enter your email to receive a verification code"
                : `We sent a code to ${email}`}
            </p>
          </div>

          {step === "email" ? (
            <form onSubmit={handleSendCode} className="space-y-4">
              {error && (
                <div
                  role="alert"
                  className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
                >
                  {error}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <Button type="submit" variant="brand" className="w-full" disabled={loading}>
                {loading ? "Sending code..." : "Send code"}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleVerifyCode} className="space-y-4">
              {error && (
                <div
                  role="alert"
                  className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
                >
                  {error}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="code">Verification code</Label>
                <Input
                  id="code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  required
                  autoFocus
                  className="text-center text-lg tracking-[0.3em] font-mono"
                />
              </div>
              <Button
                type="submit"
                variant="brand"
                className="w-full"
                disabled={loading || code.length !== 6}
              >
                {loading ? "Verifying..." : "Verify"}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setStep("email");
                  setCode("");
                  setError("");
                }}
                className="block w-full rounded-md py-1 text-center text-sm text-brand outline-none transition-colors hover:text-brand/80 focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                Use a different email
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
