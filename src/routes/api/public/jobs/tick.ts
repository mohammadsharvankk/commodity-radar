import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

export const Route = createFileRoute("/api/public/jobs/tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await authenticateCronRequest(request);
        if (authFailure) return authFailure;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { tick } = await import("@/lib/jobs.server");
        // The scheduler may hang up after a few seconds, which cancels a slow run
        // (news fetch, AI tagging). On the hosted worker runtime, hand the work to
        // waitUntil so it can finish after we respond; elsewhere run it inline.
        let waitUntil: ((p: Promise<unknown>) => void) | undefined;
        try {
          const spec = "cloudflare:workers";
          waitUntil = (
            (await import(/* @vite-ignore */ spec)) as { waitUntil?: (p: Promise<unknown>) => void }
          ).waitUntil;
        } catch {
          waitUntil = undefined;
        }
        if (waitUntil) {
          waitUntil(tick(supabaseAdmin).catch((e) => console.error("tick failed", e)));
          return Response.json({ ok: true, deferred: true }, { status: 202 });
        }
        try {
          const r = await tick(supabaseAdmin);
          return Response.json({ ok: true, ...r });
        } catch (e) {
          console.error("tick failed", e);
          return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
        }
      },
    },
  },
});
