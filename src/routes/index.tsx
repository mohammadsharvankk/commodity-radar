import { createFileRoute } from "@tanstack/react-router";

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
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-center">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Commodity Radar</h1>
        <p className="mt-2 text-sm text-muted-foreground">Dashboard screens are coming next.</p>
      </div>
    </main>
  );
}
