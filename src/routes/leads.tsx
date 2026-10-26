import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy, ExternalLink, Trash2, Download, ArrowUpDown, Search as SearchIcon, Mail, AtSign, Loader2 } from "lucide-react";

import { deleteLeads, findEmailsForLeads, listLeads } from "@/lib/leads.functions";
import { exportCSV, exportXLSX, type LeadRow } from "@/lib/export";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/leads")({
  head: () => ({ meta: [{ title: "Leads — Website Lead Finder" }] }),
  component: LeadsPage,
});

type SortKey = "business_name" | "rating" | "reviews" | "created_at";

function LeadsPage() {
  const fn = useServerFn(listLeads);
  const delFn = useServerFn(deleteLeads);
  const findFn = useServerFn(findEmailsForLeads);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["leads"], queryFn: () => fn() });

  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const pageSize = 25;

  const filtered = useMemo(() => {
    const rows = (data ?? []) as (LeadRow & { id: string })[];
    const q = query.trim().toLowerCase();
    const list = q
      ? rows.filter(
          (r) =>
            r.business_name.toLowerCase().includes(q) ||
            (r.address ?? "").toLowerCase().includes(q) ||
            (r.phone ?? "").toLowerCase().includes(q) ||
            (r.email ?? "").toLowerCase().includes(q) ||
            (r.personal_email ?? "").toLowerCase().includes(q) ||
            (r.category ?? "").toLowerCase().includes(q) ||
            (r.search_location ?? "").toLowerCase().includes(q),
        )
      : rows;
    const sorted = [...list].sort((a, b) => {
      const va = a[sortKey] ?? "";
      const vb = b[sortKey] ?? "";
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [data, query, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => {
    if (pageRows.every((r) => selected.has(r.id))) {
      const next = new Set(selected);
      pageRows.forEach((r) => next.delete(r.id));
      setSelected(next);
    } else {
      const next = new Set(selected);
      pageRows.forEach((r) => next.add(r.id));
      setSelected(next);
    }
  };

  const delMut = useMutation({
    mutationFn: (ids: string[]) => delFn({ data: { ids } }),
    onSuccess: (r) => {
      toast.success(`Deleted ${r.deleted} lead${r.deleted === 1 ? "" : "s"}`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const selectedRows = filtered.filter((r) => selected.has(r.id));
  const selectedMissing = selectedRows.filter((r) => !r.email);

  const [findingIds, setFindingIds] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const findEmails = async (ids: string[]) => {
    if (ids.length === 0) return toast.error("Select leads without an email first");
    setFindingIds((p) => new Set([...p, ...ids]));
    setProgress({ done: 0, total: ids.length });
    let found = 0;
    try {
      for (let i = 0; i < ids.length; i += 5) {
        const chunk = ids.slice(i, i + 5);
        try {
          const r = await findFn({ data: { ids: chunk } });
          found += r.found;
        } catch (e) {
          toast.error((e as Error).message);
        }
        setFindingIds((p) => {
          const n = new Set(p);
          chunk.forEach((id) => n.delete(id));
          return n;
        });
        setProgress({ done: Math.min(i + chunk.length, ids.length), total: ids.length });
        qc.invalidateQueries({ queryKey: ["leads"] });
      }
      toast.success(`Found emails for ${found}${found === 1 ? "" : "s"} for ${ids.length} lead${ids.length === 1 ? "" : "s"}`);
    } finally {
      setProgress(null);
    }
  };

  const doExport = (kind: "csv" | "xlsx") => {
    const rows = selectedRows.length > 0 ? selectedRows : filtered;
    if (rows.length === 0) return toast.error("No leads to export");
    if (kind === "csv") exportCSV(rows);
    else exportXLSX(rows);
  };

  const changeSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "business_name" ? "asc" : "desc");
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Leads</h1>
          <p className="text-muted-foreground mt-1">
            {isLoading ? "Loading…" : `${filtered.length} lead${filtered.length === 1 ? "" : "s"} • ${selected.size} selected`}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline"><Download className="h-4 w-4 mr-2" /> Export</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => doExport("csv")}>CSV</DropdownMenuItem>
              <DropdownMenuItem onClick={() => doExport("xlsx")}>Excel (.xlsx)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="secondary"
            disabled={selectedMissing.length === 0 || progress !== null}
            onClick={() => findEmails(selectedMissing.map((r) => r.id))}
          >
            {progress ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Finding {progress.done}/{progress.total}</>
            ) : (
              <><Mail className="h-4 w-4 mr-2" /> Find emails {selectedMissing.length > 0 && `(${selectedMissing.length})`}</>
            )}
          </Button>
          <Button
            variant="destructive"
            disabled={selected.size === 0 || delMut.isPending}
            onClick={() => delMut.mutate(Array.from(selected))}
          >
            <Trash2 className="h-4 w-4 mr-2" /> Delete {selected.size > 0 && `(${selected.size})`}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="relative">
            <SearchIcon className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name, address, phone…"
              className="pl-9"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <div className="rounded-md border border-border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={pageRows.length > 0 && pageRows.every((r) => selected.has(r.id))}
                      onCheckedChange={toggleAll}
                    />
                  </TableHead>
                  <TableHead>
                    <button className="inline-flex items-center gap-1" onClick={() => changeSort("business_name")}>
                      Business <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>
                    <button className="inline-flex items-center gap-1" onClick={() => changeSort("rating")}>
                      Rating <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button className="inline-flex items-center gap-1" onClick={() => changeSort("reviews")}>
                      Reviews <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button className="inline-flex items-center gap-1" onClick={() => changeSort("created_at")}>
                      Added <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-10">
                      {isLoading ? "Loading…" : "No leads yet. Run a search to get started."}
                    </TableCell>
                  </TableRow>
                ) : (
                  pageRows.map((r) => (
                    <TableRow key={r.id} data-state={selected.has(r.id) ? "selected" : undefined}>
                      <TableCell>
                        <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} />
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{r.business_name}</div>
                        <div className="text-xs text-muted-foreground">{r.category ?? ""}</div>
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate">{r.address}</TableCell>
                      <TableCell>{r.phone ?? "—"}</TableCell>
                      <TableCell className="max-w-[220px] truncate">
                        {r.email || r.personal_email ? (
                          [r.email, r.personal_email].filter(Boolean).join(", ")
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            disabled={findingIds.has(r.id)}
                            onClick={() => findEmails([r.id])}
                          >
                            {findingIds.has(r.id) ? (
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            ) : (
                              <Mail className="h-3 w-3 mr-1" />
                            )}
                            Find email
                          </Button>
                        )}
                      </TableCell>
                      <TableCell>{r.rating ?? "—"}</TableCell>
                      <TableCell>{r.reviews ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(r.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={!r.phone}
                            onClick={() => {
                              if (r.phone) {
                                navigator.clipboard.writeText(r.phone);
                                toast.success("Phone copied");
                              }
                            }}
                            title="Copy phone"
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            asChild
                            disabled={!r.maps_link}
                            title="Open on Google Maps"
                          >
                            <a href={r.maps_link ?? "#"} target="_blank" rel="noreferrer">
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Page {currentPage} of {totalPages}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}