"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createAccount, login } from "@/lib/firebase/auth";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const { user, loading, configured } = useAuth();
  const isSignup = mode === "signup";
  const [form, setForm] = useState({ institutionName: "", country: "", fullName: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace("/");
  }, [loading, user, router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (isSignup) await createAccount(form.email, form.password, form.fullName, form.institutionName, form.country);
      else await login(form.email, form.password);
      router.replace("/");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="flex min-h-screen items-center justify-center bg-canvas p-5"><div className="w-full max-w-md rounded-lg border border-line bg-surface p-7 shadow-sm"><div className="mb-7"><img src="/branding/logo-icon.png" alt="" className="mb-5 h-10 w-10" /><h1 className="text-2xl font-semibold text-ink">{isSignup ? "Create your institution" : "Welcome back"}</h1><p className="mt-2 text-sm text-muted">{isSignup ? "Set up your institution and Owner account." : "Sign in to Veqweris Systems."}</p></div>{!configured && <p className="mb-4 rounded-md bg-warning/10 p-3 text-sm text-warning">Firebase is not configured. Add the values from .env.example to continue.</p>}<form onSubmit={submit} className="space-y-4">{isSignup && <><Input required placeholder="Institution name" aria-label="Institution name" value={form.institutionName} onChange={(event) => setForm({ ...form, institutionName: event.target.value })} /><Input required placeholder="Country" aria-label="Country" value={form.country} onChange={(event) => setForm({ ...form, country: event.target.value })} /><Input required placeholder="Your full name" aria-label="Full name" value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} /></>}<Input required type="email" placeholder="Email address" aria-label="Email address" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /><Input required minLength={6} type="password" placeholder="Password" aria-label="Password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />{error && <p className="text-sm text-danger">{error}</p>}<Button type="submit" disabled={busy || !configured} className="w-full">{busy ? "Please wait…" : isSignup ? "Create institution" : "Sign in"}</Button></form><p className="mt-5 text-center text-sm text-muted">{isSignup ? "Already have an account? " : "Need an account? "}<Link className="font-medium text-accent hover:underline" href={isSignup ? "/login" : "/signup"}>{isSignup ? "Sign in" : "Create one"}</Link></p>{!isSignup && <p className="mt-3 text-center text-sm"><Link className="font-medium text-accent hover:underline" href="/account-recovery">Need account recovery?</Link></p>}</div></main>;
}
