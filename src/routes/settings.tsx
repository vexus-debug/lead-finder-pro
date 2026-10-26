import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";

import { getRateLimit } from "@/lib/leads.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — Website Lead Finder" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const fn = useServerFn(getRateLimit);
  const { data } = useQuery({ queryKey: ["rate"], queryFn: () => fn(), refetchInterval: 10000 });
  const r = data ?? { used: 0, remaining: 50, limit: 50 };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Rate limit and API status.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>SerpAPI Rate Limit</CardTitle>
          <CardDescription>Free plan: 50 requests per hour.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Progress value={(r.used / r.limit) * 100} />
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>{r.used} used in the last hour</span>
            <span>{r.remaining} remaining</span>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>API Key</CardTitle>
          <CardDescription>Your SerpAPI key is stored securely as a server-side secret and never exposed to the browser.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          To rotate the key, update the <code className="text-foreground">SERPAPI_KEY</code> secret in project settings.
        </CardContent>
      </Card>
    </div>
  );
}