import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";

import { listSearches } from "@/lib/leads.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/history")({
  head: () => ({ meta: [{ title: "Search History — Website Lead Finder" }] }),
  component: HistoryPage,
});

function HistoryPage() {
  const fn = useServerFn(listSearches);
  const { data, isLoading } = useQuery({ queryKey: ["searches"], queryFn: () => fn() });
  const rows = data ?? [];

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Search History</h1>
        <p className="text-muted-foreground mt-1">Every search you've run and what it produced.</p>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Query</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Scanned</TableHead>
                <TableHead className="text-right">Saved</TableHead>
                <TableHead className="text-right">Duplicates</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                    {isLoading ? "Loading…" : "No searches yet."}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.query}</TableCell>
                    <TableCell>{r.location}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{new Date(r.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-right">{r.scanned}</TableCell>
                    <TableCell className="text-right text-primary">{r.saved}</TableCell>
                    <TableCell className="text-right">{r.duplicates}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}