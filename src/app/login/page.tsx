"use client";

import { useAuth } from "@/lib/auth-context";
import type { ApiError, ApiSuccess, LoginResponse } from "@/types";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function LoginPage() {
  const { user, loading: authLoading, setSession } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    password?: string;
  }>({});

  const emailRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!authLoading && user) {
      router.replace("/");
    }
  }, [authLoading, user, router]);

  function validate(): boolean {
    const errors: { email?: string; password?: string } = {};

    if (!email.trim()) {
      errors.email = "Email is required.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errors.email = "Enter a valid email address.";
    }

    if (!password) {
      errors.password = "Password is required.";
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setApiError(null);

    if (!validate()) return;

    setSubmitting(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const json = (await res.json()) as ApiSuccess<LoginResponse> | ApiError;

      if (!res.ok || !json.success) {
        const errJson = json as ApiError;
        const code = errJson.error?.code;

        if (code === "RATE_LIMITED") {
          setApiError(
            "Too many failed login attempts. Please wait 10 minutes before trying again.",
          );
        } else if (code === "AUTH_FAILED") {
          setApiError("Invalid email or password. Please try again.");
        } else {
          setApiError(
            errJson.error?.message ?? "An unexpected error occurred.",
          );
        }
        return;
      }

      const { token, user: loggedInUser } = (json as ApiSuccess<LoginResponse>)
        .data;
      setSession(
        {
          id: loggedInUser.id,
          email: loggedInUser.email,
          role: loggedInUser.role,
        },
        token,
      );
      router.replace("/");
    } catch {
      setApiError(
        "Unable to reach the server. Check your connection and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (authLoading) {
    return (
      <main className="min-h-dvh bg-slate-900 flex items-center justify-center p-4">
        <div className="text-slate-400 text-sm">Loading…</div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-slate-900 flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-slate-800 border-slate-700 shadow-2xl">
        <CardHeader className="text-center pb-6">
          <CardTitle className="text-2xl font-extrabold tracking-tight text-slate-100">
            Drums Tracker
          </CardTitle>
          <p className="text-sm text-slate-500 mt-1">
            Sima Arome Inventory System
          </p>
        </CardHeader>
        <CardContent className="px-8 pb-8">
          {apiError && (
            <Alert
              variant="destructive"
              className="mb-4 bg-red-500/10 border-red-500/30 text-red-400"
            >
              <AlertTriangle className="size-4" />
              <AlertDescription>{apiError}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit} noValidate aria-label="Sign in form">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Email
                </Label>
                <Input
                  ref={emailRef}
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (fieldErrors.email) {
                      setFieldErrors((prev) => ({ ...prev, email: undefined }));
                    }
                  }}
                  className="bg-slate-900 border-slate-600 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:ring-blue-500/20"
                  aria-invalid={!!fieldErrors.email}
                  aria-describedby={fieldErrors.email ? "email-error" : undefined}
                  disabled={submitting}
                  placeholder="you@simarome.com"
                />
                {fieldErrors.email && (
                  <p id="email-error" className="text-xs text-red-400 mt-1" role="alert">
                    {fieldErrors.email}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (fieldErrors.password) {
                      setFieldErrors((prev) => ({ ...prev, password: undefined }));
                    }
                  }}
                  className="bg-slate-900 border-slate-600 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:ring-blue-500/20"
                  aria-invalid={!!fieldErrors.password}
                  aria-describedby={fieldErrors.password ? "password-error" : undefined}
                  disabled={submitting}
                  placeholder="••••••••"
                />
                {fieldErrors.password && (
                  <p id="password-error" className="text-xs text-red-400 mt-1" role="alert">
                    {fieldErrors.password}
                  </p>
                )}
              </div>

              <Button
                type="submit"
                className="w-full mt-2 bg-blue-500 hover:bg-blue-600 text-white font-bold"
                disabled={submitting}
              >
                {submitting ? "Signing in…" : "Sign in"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}