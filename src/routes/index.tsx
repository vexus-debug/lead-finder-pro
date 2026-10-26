import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Users, Sparkles, Radar, CopyX, Globe2, Zap, Search as SearchIcon, ArrowRight } from "lucide-react";

import { getStats } from "@/lib/leads.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  component: Dashboard,
});

function StatCard({ icon: Icon, label, value, hint }: { icon: typeof Users; label: string; value: string | number; hint?: string }) {
  return (
    <Card className="bg-card/60 border-border/60">
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="h-4 w-4 text-primary" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
        {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function Dashboard() {
  const fn = useServerFn(getStats);
  const { data, isLoading } = useQuery({ queryKey: ["stats"], queryFn: () => fn(), refetchInterval: 15000 });

  const s = data ?? { totalLeads: 0, newToday: 0, scanned: 0, duplicates: 0, withWebsite: 0, apiUsed: 0, apiRemaining: 50, apiLimit: 50 };
  const pct = (s.apiUsed / s.apiLimit) * 100;

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Track collected leads and stay under your SerpAPI limit.</p>
        </div>
        <Button asChild>
          <Link to="/search">
            <SearchIcon className="h-4 w-4 mr-2" /> New search <ArrowRight className="h-4 w-4 ml-1" />
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard icon={Users} label="Total Leads" value={isLoading ? "—" : s.totalLeads} />
        <StatCard icon={Sparkles} label="New Today" value={isLoading ? "—" : s.newToday} />
        <StatCard icon={Radar} label="Scanned" value={isLoading ? "—" : s.scanned} />
        <StatCard icon={CopyX} label="Duplicates Skipped" value={isLoading ? "—" : s.duplicates} />
        <StatCard icon={Globe2} label="With Website" value={isLoading ? "—" : s.withWebsite} />
        <StatCard icon={Zap} label="API Used / Hr" value={isLoading ? "—" : `${s.apiUsed}/${s.apiLimit}`} hint={`${s.apiRemaining} remaining`} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Hourly API quota</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Progress value={pct} />
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>{s.apiUsed} used in the last hour</span>
            <span>{s.apiRemaining} remaining of {s.apiLimit}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
