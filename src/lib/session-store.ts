// Browser-only session storage for leads and search history. Resets when the browser/tab closes.
import { fetchMapsPage, findEmailsServer, findPersonalEmailsServer } from "@/lib/leads.functions";

export const RATE_LIMIT = 50;

export type Lead = {
  id: string;
  created_at: string;
  business_name: string;
  category: string | null;
  address: string;
  phone: string | null;
  email: string | null;
  personal_email: string | null;
  email_status: string | null;
  website: string | null;
  rating: number | null;
  reviews: number | null;
  maps_link: string | null;
  place_id: string | null;
  latitude: number | null;
  longitude: number | null;
  search_category: string | null;
  search_location: string | null;
};

export type SearchRow = {
  id: string;
  created_at: string;
  query: string;
  location: string;
  scanned: number;
  saved: number;
  duplicates: number;
};

function read<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.sessionStorage.getItem(key) ?? "[]") as T[];
  } catch {
    return [];
  }
}
function write<T>(key: string, v: T[]) {
  if (typeof window !== "undefined") window.sessionStorage.setItem(key, JSON.stringify(v));
}

const K_LEADS = "lf_leads";
const K_SEARCHES = "lf_searches";
const K_REQ = "lf_requests";

function requestsLastHour(): number[] {
  const since = Date.now() - 3600_000;
  return read<number>(K_REQ).filter((t) => t >= since);
}

export async function getRateLimit() {
  const used = requestsLastHour().length;
  return { used, remaining: Math.max(0, RATE_LIMIT - used), limit: RATE_LIMIT };
}

export async function listLeads(): Promise<Lead[]> {
  return read<Lead>(K_LEADS).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function listSearches(): Promise<SearchRow[]> {
  return read<SearchRow>(K_SEARCHES).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function getStats() {
  const leads = read<Lead>(K_LEADS);
  const searches = read<SearchRow>(K_SEARCHES);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const used = requestsLastHour().length;
  return {
    totalLeads: leads.length,
    newToday: leads.filter((l) => new Date(l.created_at) >= start).length,
    scanned: searches.reduce((a, s) => a + s.scanned, 0),
    duplicates: searches.reduce((a, s) => a + s.duplicates, 0),
    withWebsite: leads.filter((l) => l.website).length,
    apiUsed: used,
    apiRemaining: Math.max(0, RATE_LIMIT - used),
    apiLimit: RATE_LIMIT,
  };
}

export async function deleteLeads({ data }: { data: { ids: string[] } }) {
  const ids = new Set(data.ids);
  write(K_LEADS, read<Lead>(K_LEADS).filter((l) => !ids.has(l.id)));
  return { deleted: data.ids.length };
}

function leadKeys(l: { place_id: string | null; business_name: string; address: string }) {
  return [l.place_id ? `p:${l.place_id}` : null, `n:${l.business_name.trim().toLowerCase()}|${l.address.trim().toLowerCase()}`].filter(
    Boolean,
  ) as string[];
}

export async function findLeads({
  data,
}: {
  data: { category: string; location: string; maxLeads: number; mode: "all" | "emails" | "phones" };
}) {
  let saved = 0;
  let duplicates = 0;
  let scanned = 0;
  let requestsMade = 0;
  let hitRateLimit = false;
  let hitEnd = false;
  let error: string | null = null;

  const all = read<Lead>(K_LEADS);
  const seen = new Set(all.flatMap(leadKeys));
  let start = 0;

  try {
    while (saved < data.maxLeads) {
      const reqs = requestsLastHour();
      if (reqs.length >= RATE_LIMIT) {
        hitRateLimit = true;
        break;
      }
      write(K_REQ, [...reqs, Date.now()]);
      requestsMade++;

      const page = await fetchMapsPage({ data: { category: data.category, location: data.location, mode: data.mode, start } });
      if (page.error) {
        error = page.error;
        break;
      }
      if (page.rawCount === 0) {
        hitEnd = true;
        break;
      }
      scanned += page.rawCount;

      for (const r of page.leads) {
        if (saved >= data.maxLeads) break;
        const keys = leadKeys(r);
        if (keys.some((k) => seen.has(k))) {
          duplicates++;
          continue;
        }
        keys.forEach((k) => seen.add(k));
        all.push({
          ...r,
          id: crypto.randomUUID(),
          created_at: new Date().toISOString(),
          personal_email: null,
          email_status: null,
          search_category: data.category,
          search_location: data.location,
        });
        saved++;
      }
      write(K_LEADS, all);

      start += 20;
      if (page.rawCount < 20) {
        hitEnd = true;
        break;
      }
    }
  } catch (e) {
    console.error("Lead search failed", e);
    error = "The search service is temporarily unavailable. Please try again in a moment.";
  }

  write(K_SEARCHES, [
    ...read<SearchRow>(K_SEARCHES),
    {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      query: data.category,
      location: data.location,
      scanned,
      saved,
      duplicates,
    },
  ]);

  return { saved, duplicates, scanned, requestsMade, hitRateLimit, hitEnd, error };
}

async function enrich(ids: string[], field: "email" | "personal_email", fn: typeof findEmailsServer) {
  const rows = read<Lead>(K_LEADS).filter((l) => ids.includes(l.id));
  if (rows.length === 0) return { results: [], found: 0 };
  const { results } = await fn({
    data: {
      leads: rows.map((r) => ({
        id: r.id,
        business_name: r.business_name,
        address: r.address,
        phone: r.phone,
        website: r.website,
        email: r.email,
        personal_email: r.personal_email,
      })),
    },
  });
  const map = new Map(results.map((r) => [r.id, r.email]));
  write(
    K_LEADS,
    read<Lead>(K_LEADS).map((l) => (map.get(l.id) ? { ...l, [field]: map.get(l.id)! } : l)),
  );
  return { results, found: results.filter((r) => r.email).length };
}

export function findEmailsForLeads({ data }: { data: { ids: string[] } }) {
  return enrich(data.ids, "email", findEmailsServer);
}

export function findPersonalEmailsForLeads({ data }: { data: { ids: string[] } }) {
  return enrich(data.ids, "personal_email", findPersonalEmailsServer);
}
