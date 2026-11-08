import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowRight, LockKeyhole, Radar } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getAccountAvailability } from "@/lib/manage.functions";
import { radarHead } from "@/lib/radar-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadError } from "@/components/radar-common";
const availability = queryOptions({ queryKey: ["account-availability"], queryFn: () => getAccountAvailability() });
export const Route = createFileRoute("/auth")({ head: () => radarHead("Sign in", "Private access to your Dubai commodities terminal."), loader: ({ context }) => context.queryClient.ensureQueryData(availability), errorComponent: LoadError, notFoundComponent: () => <p>Account unavailable</p>, component: Auth });
function Auth() {
  const { data } = useSuspenseQuery(availability); const check = useServerFn(getAccountAvailability);
  const [register, setRegister] = useState(false); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const navigate = useNavigate();
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMessage("");
    try {
      if (register) {
        if (!(await check()).canRegister) throw new Error("This private terminal already has an account. Please sign in.");
        const { data: result, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
        if (error) throw error;
        if (!result.session) { setMessage("Check your email to confirm your account, then sign in."); setRegister(false); return; }
      } else { const { error } = await supabase.auth.signInWithPassword({ email, password }); if (error) throw error; }
      await navigate({ to: "/dashboard" });
    } catch (e) { setMessage(e instanceof Error ? e.message : "Sign-in failed."); } finally { setBusy(false); }
  }
  return <main className="flex min-h-screen items-center justify-center px-5 py-12"><div className="w-full max-w-sm"><Radar className="mb-6 size-12 text-primary" /><h1 className="text-3xl font-semibold">Commodity Radar</h1><p className="mt-2 text-sm text-muted-foreground">Your private WTI, Silver & Gold terminal.</p><div className="my-8 flex items-center gap-2 border-y border-border py-3 text-xs text-muted-foreground"><LockKeyhole className="size-4" />Single trader · Dubai UTC +4</div><h2 className="mb-5 text-xl">{register ? "Create your account" : "Welcome back"}</h2><form onSubmit={submit} className="space-y-4"><label className="block text-sm">Email<Input className="mt-2" type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></label><label className="block text-sm">Password<Input className="mt-2" type="password" required minLength={8} autoComplete={register ? "new-password" : "current-password"} value={password} onChange={e => setPassword(e.target.value)} /></label>{message && <p role="status" className="text-sm text-warn">{message}</p>}<Button className="w-full" disabled={busy}>{busy ? "Please wait…" : register ? "Create account" : "Sign in"}<ArrowRight /></Button></form>{data.canRegister && <Button variant="link" className="mt-4 px-0" onClick={() => setRegister(!register)}>{register ? "Already have an account? Sign in" : "Set up the first account"}</Button>}</div></main>;
}