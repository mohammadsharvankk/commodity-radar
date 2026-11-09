import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Stock Radar by Sharvan" },
      {
        name: "description",
        content: "WTI, silver and gold sessions, reports and alerts in Dubai time.",
      },
      { property: "og:title", content: "Stock Radar by Sharvan" },
      {
        property: "og:description",
        content: "WTI, silver and gold sessions, reports and alerts in Dubai time.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  // No splash page: go straight to the markets, or to sign-in.
  beforeLoad: async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    throw redirect({ to: user ? "/dashboard" : "/auth", replace: true });
  },
  component: () => null,
});
