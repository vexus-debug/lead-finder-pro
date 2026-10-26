import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Search as SearchIcon } from "lucide-react";

import { findLeads, getRateLimit } from "@/lib/leads.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

export const Route = createFileRoute("/search")({
  head: () => ({ meta: [{ title: "Search — Website Lead Finder" }] }),
  component: SearchPage,
});

function SearchPage() {
  const findFn = useServerFn(findLeads);
  const rateFn = useServerFn(getRateLimit);
  const qc = useQueryClient();
  const nav = useNavigate();

  const [category, setCategory] = useState("Dentist");
  const [locations, setLocations] = useState<string[]>(["Austin, TX", "", ""]);
  const [maxLeads, setMaxLeads] = useState(20);
  const [mode, setMode] = useState<"all" | "emails" | "phones">("all");

  const rate = useQuery({ queryKey: ["rate"], queryFn: () => rateFn(), refetchInterval: 10000 });

  const mut = useMutation({
    mutationFn: async (v: { category: string; locations: string[]; maxLeads: number; mode: "all" | "emails" | "phones" }) => {
      const results = [] as Array<{ location: string; res: Awaited<ReturnType<typeof findFn>> }>;
      for (const loc of v.locations) {
        const res = await findFn({ data: { category: v.category, location: loc, maxLeads: v.maxLeads, mode: v.mode } });
        results.push({ location: loc, res });
        if (res.hitRateLimit || res.error) break;
      }
      return results;
    },
    onSuccess: (results) => {
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["rate"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["searches"] });
      const totals = results.reduce(
        (a, r) => ({
          saved: a.saved + r.res.saved,
          duplicates: a.duplicates + r.res.duplicates,
          scanned: a.scanned + r.res.scanned,
          requestsMade: a.requestsMade + r.res.requestsMade,
        }),
        { saved: 0, duplicates: 0, scanned: 0, requestsMade: 0 },
      );
      const hitRateLimit = results.some((r) => r.res.hitRateLimit);
      const serviceError = results.find((r) => r.res.error)?.res.error;
      const areas = results.map((r) => r.location).join(", ");
      if (serviceError) {
        toast.error("Search temporarily unavailable", {
          description: totals.saved > 0 ? `${serviceError} ${totals.saved} lead(s) were saved before the search paused.` : serviceError,
        });
      } else if (hitRateLimit) {
        toast.warning("Hourly API limit reached", {
          description: `Saved ${totals.saved} new leads across ${results.length} area(s) before pausing.`,
        });
      } else if (totals.saved === 0 && totals.scanned === 0) {
        toast.error("No results found. Try a broader query or different locations.");
      } else {
        toast.success(`Saved ${totals.saved} new leads from ${results.length} area(s)`, {
          description: `${areas} • ${totals.scanned} scanned • ${totals.duplicates} duplicates • ${totals.requestsMade} API calls`,
          action: { label: "View leads", onClick: () => nav({ to: "/leads" }) },
        });
      }
    },
    onError: (e: Error) => toast.error(e.message || "Search failed"),
  });

  const rateData = rate.data ?? { used: 0, remaining: 50, limit: 50 };
  const disabled = mut.isPending || rateData.remaining <= 0;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Find leads</h1>
        <p className="text-muted-foreground mt-1">Discover businesses on Google Maps.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Hourly quota</CardTitle>
          <CardDescription>Used {rateData.used} of {rateData.limit} — {rateData.remaining} remaining</CardDescription>
        </CardHeader>
        <CardContent>
          <Progress value={(rateData.used / rateData.limit) * 100} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Search parameters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="cat">Business category</Label>
            <Input id="cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Dentist, Spa, Restaurant" />
          </div>
          <div className="grid gap-2">
            <Label>Locations (up to 3)</Label>
            {locations.map((loc, i) => (
              <Input
                key={i}
                value={loc}
                onChange={(e) => setLocations((prev) => prev.map((p, idx) => (idx === i ? e.target.value : p)))}
                placeholder={`Area ${i + 1} — City, State, Country${i > 0 ? " (optional)" : ""}`}
              />
            ))}
            <p className="text-xs text-muted-foreground">Each area runs its own search with the max leads below.</p>
          </div>
          <div className="grid gap-2">
            <Label>What to collect</Label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { value: "all", label: "All leads", hint: "Name, phone, email, website" },
                  { value: "emails", label: "Emails only", hint: "Only leads with an email" },
                  { value: "phones", label: "Phones only", hint: "Only leads with a phone" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setMode(opt.value)}
                  className={`rounded-md border p-3 text-left transition-colors ${
                    mode === opt.value
                      ? "border-primary bg-primary/10"
                      : "border-border hover:bg-muted/50"
                  }`}
                >
                  <div className="text-sm font-medium">{opt.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{opt.hint}</div>
                </button>
              ))}
            </div>
            {mode === "emails" && (
              <p className="text-xs text-muted-foreground">
                Emails are scraped from each business's website, so this mode is slower and only keeps leads where an email was found.
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="max">Max leads to collect</Label>
            <Input id="max" type="number" min={1} max={500} value={maxLeads}
              onChange={(e) => setMaxLeads(Math.max(1, Math.min(500, Number(e.target.value) || 1)))} />
            <p className="text-xs text-muted-foreground">Per area. Each API call returns up to 20 results. Uses ~{Math.ceil(maxLeads / 20)} calls per area.</p>
          </div>
          <Button
            className="w-full"
            disabled={disabled}
            onClick={() => {
              const locs = locations.map((l) => l.trim()).filter(Boolean);
              if (!category.trim() || locs.length === 0) {
                toast.error("Please fill in category and at least one location");
                return;
              }
              mut.mutate({ category: category.trim(), locations: locs, maxLeads, mode });
            }}
          >
            {mut.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Searching…</>
            ) : rateData.remaining <= 0 ? (
              "Hourly limit reached"
            ) : (
              <><SearchIcon className="h-4 w-4 mr-2" /> Find Leads</>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}