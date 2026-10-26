import * as XLSX from "xlsx";

export type LeadRow = {
  business_name: string;
  category: string | null;
  address: string;
  phone: string | null;
  email: string | null;
  personal_email: string | null;
  website: string | null;
  rating: number | null;
  reviews: number | null;
  maps_link: string | null;
  place_id: string | null;
  latitude: number | null;
  longitude: number | null;
  search_category: string | null;
  search_location: string | null;
  created_at: string;
};

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportCSV(rows: LeadRow[]) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const csv = XLSX.utils.sheet_to_csv(ws);
  download(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `leads-${Date.now()}.csv`);
}

export function exportXLSX(rows: LeadRow[]) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Leads");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  download(new Blob([buf], { type: "application/octet-stream" }), `leads-${Date.now()}.xlsx`);
}