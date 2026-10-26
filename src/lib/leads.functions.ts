import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const RATE_LIMIT = 50;

async function fetchWithRetry(url: string, attempts = 3): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, { signal: AbortSignal.timeout(25_000) });
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

type MapsResult = {
  title?: string;
  place_id?: string;
  data_id?: string;
  address?: string;
  phone?: string;
  website?: string;
  rating?: number;
  reviews?: number;
  gps_coordinates?: { latitude?: number; longitude?: number };
  type?: string;
  types?: string[];
  permanently_closed?: boolean;
  sponsored?: boolean;
  ad?: boolean;
  place_id_search?: string;
  provider_id?: string;
  link?: string;
};

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const EMAIL_BLACKLIST = /(\.png|\.jpg|\.jpeg|\.gif|\.webp|\.svg|@sentry|@example\.|@2x\.|u003e|wixpress|godaddy|squarespace|wordpress)/i;

function extractEmails(html: string): string[] {
  const found = new Set<string>();
  const mailto = html.matchAll(/mailto:([^"'?>\s]+)/gi);
  for (const m of mailto) {
    const e = decodeURIComponent(m[1]).trim().toLowerCase();
    if (EMAIL_REGEX.test(e) && !EMAIL_BLACKLIST.test(e)) found.add(e);
  }
  const plain = html.match(EMAIL_REGEX) ?? [];
  for (const raw of plain) {
    const e = raw.toLowerCase();
    if (!EMAIL_BLACKLIST.test(e)) found.add(e);
  }
  return Array.from(found).slice(0, 10);
}

async function scrapeEmailsFromWebsite(website: string): Promise<string | null> {
  const base = website.startsWith("http") ? website : `https://${website}`;
  const candidates = [base, `${base.replace(/\/$/, "")}/contact`];
  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(8_000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; LeadFinder/1.0)" },
        redirect: "follow",
      });
      if (!res.ok) continue;
      const html = await res.text();
      const emails = extractEmails(html);
      if (emails.length > 0) return emails.join(", ");
    } catch {
      // site unreachable — try next candidate
    }
  }
  return null;
}

// Fast lookup: Google results via SerpAPI (snippets from Instagram, Facebook, directories).
async function findEmailsViaSerp(query: string): Promise<string[]> {
  const key = process.env["SERPAPI_KEY"];
  if (!key) return [];
  try {
    const url = `https://serpapi.com/search.json?engine=google&num=20&q=${encodeURIComponent(query)}&api_key=${key}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return [];
    const json = await res.json();
    return extractEmails(JSON.stringify(json?.organic_results ?? []) + JSON.stringify(json?.knowledge_graph ?? {}));
  } catch (e) {
    console.error("SerpAPI email lookup failed", e);
    return [];
  }
}

// Deep lookup: ScrapeGraphAI v2 search.
async function findEmailsViaScrapeGraphV2(query: string): Promise<string[]> {
  const key = process.env["SCRAPEGRAPH_API_KEY"];
  if (!key) return [];
  try {
    const res = await fetch("https://v2-api.scrapegraphai.com/api/search", {
      method: "POST",
      signal: AbortSignal.timeout(45_000),
      headers: { "SGAI-APIKEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({ query, numResults: 15 }),
    });
    if (!res.ok) {
      console.error(`ScrapeGraph v2 failed [${res.status}]: ${(await res.text()).slice(0, 300)}`);
      return [];
    }
    return extractEmails(JSON.stringify(await res.json()));
  } catch (e) {
    console.error("ScrapeGraph v2 lookup failed", e);
    return [];
  }
}

async function findEmailViaScrapeGraph(
  name: string,
  address: string,
  phone: string | null,
  website: string | null = null,
): Promise<string | null> {
  const city = address.split(",").slice(-2).join(",").trim();
  const site = website ? website.replace(/^https?:\/\//, "").replace(/\/.*$/, "") : "";
  const found = new Set<string>();
  // Uses ScrapeGraphAI only (no SerpAPI) for the "Find emails" action.
  const queries = [
    `${name} ${city}${site ? ` ${site}` : ""} contact email`,
    `${name} ${city} email gmail OR yahoo OR outlook OR hotmail instagram facebook`,
  ];
  if (phone) queries.push(`"${phone}" ${name} email`);
  const results = await Promise.all(queries.map(findEmailsViaScrapeGraphV2));
  results.flat().forEach((e) => found.add(e));
  const list = await filterDeliverable(Array.from(found).slice(0, 10));
  return list.length ? list.join(", ") : null;
}

// Free check: keep only emails whose domain has working mail servers (MX records), via DNS-over-HTTPS.
const mxCache = new Map<string, boolean>();
async function domainAcceptsMail(domain: string): Promise<boolean> {
  if (mxCache.has(domain)) return mxCache.get(domain)!;
  let ok = true; // fail open if DNS lookup itself errors
  try {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) {
      const j = await res.json();
      ok = j.Status === 0 && Array.isArray(j.Answer) && j.Answer.some((a: { type: number; data: string }) => a.type === 15 && !/^0\s+\.$/.test(a.data));
    }
  } catch {
    // keep ok = true
  }
  mxCache.set(domain, ok);
  return ok;
}

async function filterDeliverable(emails: string[]): Promise<string[]> {
  const checks = await Promise.all(
    emails.map(async (e) => {
      const domain = e.split("@")[1];
      return domain && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain) && (await domainAcceptsMail(domain.toLowerCase())) ? e : null;
    }),
  );
  return checks.filter((e): e is string => !!e);
}

// ScrapeGraphAI lookup tuned for personal inboxes (Gmail/Yahoo/Outlook etc.)
// publicly connected to the business's Google Maps phone number.
const PERSONAL_DOMAINS = /@(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|icloud|me|aol|proton|protonmail|zoho|gmx|mail|yandex)\./i;

async function findPersonalEmailViaScrapeGraph(
  name: string,
  address: string,
  phone: string | null,
): Promise<string | null> {
  const key = process.env["SCRAPEGRAPH_API_KEY"];
  if (!key) return null;
  const digits = phone ? phone.replace(/\D/g, "") : "";
  const phonePart = phone ? ` or the phone number "${phone}"${digits ? ` (${digits})` : ""}` : "";
  try {
    const res = await fetch("https://api.scrapegraphai.com/v1/searchscraper", {
      method: "POST",
      signal: AbortSignal.timeout(60_000),
      headers: { "SGAI-APIKEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        user_prompt: `Find ALL personal email addresses (Gmail, Yahoo, Outlook, Hotmail, iCloud, AOL, Proton and similar) publicly connected to the business "${name}" located at ${address}${phonePart}. Check the business's Facebook page, Instagram bio, TikTok, LinkedIn, X/Twitter, WhatsApp listings, link-in-bio pages, directories and listings. Return every distinct personal email found as a list; return an empty list if none.`,
        num_results: 5,
        output_schema: {
          type: "object",
          properties: { emails: { type: "array", items: { type: "string" } } },
        },
      }),
    });
    if (!res.ok) {
      console.error(`ScrapeGraph personal lookup failed [${res.status}]: ${(await res.text()).slice(0, 300)}`);
      return null;
    }
    const json = await res.json();
    const emails = extractEmails(JSON.stringify(json?.result ?? json)).filter((e) => PERSONAL_DOMAINS.test(e));
    return emails.length ? emails.join(", ") : null;
  } catch (e) {
    console.error("ScrapeGraph personal email lookup failed", e);
    return null;
  }
}

const leadInput = z.object({
  id: z.string(),
  business_name: z.string(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  website: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  personal_email: z.string().nullable().optional(),
});

export const findEmailsServer = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ leads: z.array(leadInput).min(1).max(10) }).parse(d))
  .handler(async ({ data }) => {
    const results = await Promise.all(
      data.leads.map(async (r) => {
        if (r.email) return { id: r.id, email: r.email as string | null };
        let email: string | null = null;
        try {
          email = await findEmailViaScrapeGraph(r.business_name, r.address ?? "", r.phone ?? null, r.website ?? null);
        } catch (e) {
          console.error("Email lookup failed", e);
        }
        return { id: r.id, email };
      }),
    );
    return { results };
  });

export const findPersonalEmailsServer = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ leads: z.array(leadInput).min(1).max(10) }).parse(d))
  .handler(async ({ data }) => {
    const results = await Promise.all(
      data.leads.map(async (r) => {
        if (r.personal_email) return { id: r.id, email: r.personal_email as string | null };
        let email: string | null = null;
        try {
          email = await findPersonalEmailViaScrapeGraph(r.business_name, r.address ?? "", r.phone ?? null);
        } catch (e) {
          console.error("Personal email lookup failed", e);
        }
        return { id: r.id, email };
      }),
    );
    return { results };
  });

export type MapsLead = {
  business_name: string;
  category: string | null;
  address: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  rating: number | null;
  reviews: number | null;
  maps_link: string | null;
  place_id: string | null;
  latitude: number | null;
  longitude: number | null;
};

// Fetches one page (up to 20 results) of Google Maps results via SerpAPI. No storage.
export const fetchMapsPage = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        category: z.string().trim().min(1).max(120),
        location: z.string().trim().min(1).max(160),
        mode: z.enum(["all", "emails", "phones"]).default("all"),
        start: z.number().int().min(0),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<{ leads: MapsLead[]; rawCount: number; error: string | null }> => {
    const key = process.env["SERPAPI_KEY"];
    if (!key) return { leads: [], rawCount: 0, error: "The search service is not configured." };
    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("engine", "google_maps");
    url.searchParams.set("type", "search");
    url.searchParams.set("q", `${data.category} in ${data.location}`);
    url.searchParams.set("start", String(data.start));
    url.searchParams.set("api_key", key);

    let res: Response;
    try {
      res = await fetchWithRetry(url.toString());
    } catch (e) {
      console.error("SerpAPI request failed after retries", e);
      return { leads: [], rawCount: 0, error: "The map search service is temporarily unreachable. Please try again in a moment." };
    }
    if (!res.ok) {
      const text = await res.text();
      console.error(`SerpAPI returned ${res.status}: ${text.slice(0, 500)}`);
      const error =
        res.status === 429
          ? "The map search service has reached its request limit. Please try again later."
          : res.status === 401 || res.status === 403
            ? "The map search service rejected the access key. It looks invalid or expired."
            : "The map search service could not complete this search. Please try again in a moment.";
      return { leads: [], rawCount: 0, error };
    }
    let json: { local_results?: MapsResult[]; error?: string };
    try {
      json = await res.json();
    } catch {
      return { leads: [], rawCount: 0, error: "The map search service returned an invalid response." };
    }
    if (json.error) {
      console.error(`SerpAPI response error: ${json.error}`);
      if (/hasn't returned any results/i.test(json.error)) return { leads: [], rawCount: 0, error: null };
      return { leads: [], rawCount: 0, error: `The map search service rejected this search: ${json.error}` };
    }
    const raw = json.local_results ?? [];
    const filtered = raw.filter(
      (r) => !r.sponsored && !r.ad && !r.permanently_closed && r.title && r.address && !(data.mode === "phones" && !r.phone),
    );
    const leads = await Promise.all(
      filtered.map(async (r): Promise<MapsLead | null> => {
        let email: string | null = null;
        if (data.mode !== "phones" && r.website) email = await scrapeEmailsFromWebsite(r.website);
        if (data.mode === "emails" && !email) return null;
        return {
          business_name: r.title!,
          category: r.type ?? r.types?.[0] ?? data.category,
          address: r.address!,
          phone: r.phone ?? null,
          email,
          website: r.website ?? null,
          rating: r.rating ?? null,
          reviews: r.reviews ?? null,
          maps_link: r.link ?? null,
          place_id: r.place_id ?? r.data_id ?? null,
          latitude: r.gps_coordinates?.latitude ?? null,
          longitude: r.gps_coordinates?.longitude ?? null,
        };
      }),
    );
    return { leads: leads.filter((l): l is MapsLead => !!l), rawCount: raw.length, error: null };
  });
