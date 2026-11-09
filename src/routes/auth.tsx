import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getAccountAvailability } from "@/lib/manage.functions";
import { radarHead } from "@/lib/radar-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadError } from "@/components/radar-common";
import { ThemeToggle, Wordmark } from "@/components/radar-shell";
const availability = queryOptions({
  queryKey: ["account-availability"],
  queryFn: () => getAccountAvailability(),
});
export const Route = createFileRoute("/auth")({
  head: () => radarHead("Sign in", "Sign in to Stock Radar."),
  loader: ({ context }) => context.queryClient.ensureQueryData(availability),
  errorComponent: LoadError,
  notFoundComponent: () => <p>Account unavailable</p>,
  component: Auth,
});
function Auth() {
  const { data } = useSuspenseQuery(availability);
  const check = useServerFn(getAccountAvailability);
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const navigate = useNavigate();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (register) {
        if (!(await check()).canRegister)
          throw new Error("This private terminal already has an account. Please sign in.");
        const { data: result, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        if (!result.session) {
          setMessage("Check your email to confirm your account, then sign in.");
          setRegister(false);
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      await navigate({ to: "/dashboard" });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="min-h-screen bg-background">
      <header className="flex h-14 items-center justify-between border-b border-border bg-surface px-4 md:px-8">
        <Wordmark />
        <ThemeToggle />
      </header>
      <div className="mx-auto w-full max-w-sm px-5 py-14">
        <h1 className="text-2xl font-semibold tracking-tight">
          {register ? "Create your account" : "Sign in"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">WTI, silver and gold in Dubai time.</p>
        <form onSubmit={submit} className="panel mt-6 space-y-4 p-5">
          <label className="block text-sm font-medium">
            Email
            <Input
              className="mt-1.5"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="block text-sm font-medium">
            Password
            <Input
              className="mt-1.5"
              type="password"
              required
              minLength={8}
              autoComplete={register ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {message && (
            <p role="status" className="text-sm text-warn">
              {message}
            </p>
          )}
          <Button className="w-full" disabled={busy}>
            {busy ? "Please wait…" : register ? "Create account" : "Sign in"}
          </Button>
        </form>
        {data.canRegister && (
          <Button variant="link" className="mt-3 px-0" onClick={() => setRegister(!register)}>
            {register ? "Already have an account? Sign in" : "Set up the first account"}
          </Button>
        )}
      </div>
    </main>
  );
}
