import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Radar } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Commodity Radar — Dashboard" },
      { name: "description", content: "WTI, Silver & Gold session radar in Dubai time." },
      { property: "og:title", content: "Commodity Radar — Dashboard" },
      { property: "og:description", content: "WTI, Silver & Gold session radar in Dubai time." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Index() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => { void supabase.auth.getUser().then(({ data }) => setSignedIn(!!data.user)); }, []);
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-center">
      <div>
        <Radar className="mx-auto mb-5 size-12 text-primary" />
        <h1 className="text-2xl font-semibold text-foreground">Commodity Radar</h1>
        <p className="mt-2 text-sm text-muted-foreground">WTI / Silver / Gold · Dubai UTC +4</p>
        <Button asChild className="mt-6"><Link to={signedIn ? "/dashboard" : "/auth"}>{signedIn ? "Open dashboard" : "Sign in"}</Link></Button>
      </div>
    </main>
  );
}
