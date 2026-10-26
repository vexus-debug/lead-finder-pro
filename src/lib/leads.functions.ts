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

function getAdmin() {
  return import("@/integrations/supabase/client.server").then((m) => m.supabaseAdmin);
}

async function countRequestsLastHour(supabase: Awaited<ReturnType<typeof getAdmin>>) {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from("api_requests")
    .select("*", { count: "exact", head: true })
    .gte("created_at", since);
  return count ?? 0;
}

export const getRateLimit = createServerFn({ method: "GET" }).handler(async () => {
  const supabase = await getAdmin();
  const used = await countRequestsLastHour(supabase);
  return { used, remaining: Math.max(0, RATE_LIMIT - used), limit: RATE_LIMIT };
});

export const getStats = createServerFn({ method: "GET" }).handler(async () => {
  const supabase = await getAdmin();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [totalLeads, todayLeads, totals, rate, withWebsite] = await Promise.all([
    supabase.from("leads").select("*", { count: "exact", head: true }),
    supabase.from("leads").select("*", { count: "exact", head: true }).gte("created_at", startOfToday.toISOString()),
    supabase.from("searches").select("scanned, saved, duplicates"),
    countRequestsLastHour(await getAdmin()),
    supabase.from("leads").select("*", { count: "exact", head: true }).not("website", "is", null),
  ]);

  const scanned = (totals.data ?? []).reduce((a, r) => a + (r.scanned ?? 0), 0);
  const duplicates = (totals.data ?? []).reduce((a, r) => a + (r.duplicates ?? 0), 0);

  return {
    totalLeads: totalLeads.count ?? 0,
    newToday: todayLeads.count ?? 0,
    scanned,
    duplicates,
    withWebsite: withWebsite.count ?? 0,
    apiUsed: rate,
    apiRemaining: Math.max(0, RATE_LIMIT - rate),
    apiLimit: RATE_LIMIT,
  };
});

export const listLeads = createServerFn({ method: "GET" }).handler(async () => {
  const supabase = await getAdmin();
  const { data, error } = await supabase.from("leads").select("*").order("created_at", { ascending: false }).limit(2000);
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const listSearches = createServerFn({ method: "GET" }).handler(async () => {
  const supabase = await getAdmin();
  const { data, error } = await supabase.from("searches").select("*").order("created_at", { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const deleteLeads = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ ids: z.array(z.string()).min(1) }).parse(d))
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { error } = await supabase.from("leads").delete().in("id", data.ids);
    if (error) throw new Error(error.message);
    return { deleted: data.ids.length };
  });

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
  const queries = [
    `"${name}" ${city} email`,
    `"${name}" ${city} gmail OR yahoo OR outlook OR hotmail`,
  ];
  if (phone) queries.push(`"${phone}" email`);
  if (site) queries.push(`"@${site}" OR site:${site} email`);
  const serp = await Promise.all(queries.map(findEmailsViaSerp));
  serp.flat().forEach((e) => found.add(e));
  if (found.size === 0) {
    (await findEmailsViaScrapeGraphV2(`${name} ${city}${site ? ` ${site}` : ""} contact email instagram facebook`)).forEach((e) => found.add(e));
  }
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


export const findEmailsForLeads = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ ids: z.array(z.string().uuid()).min(1).max(10) }).parse(d))
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { data: rows, error } = await supabase
      .from("leads")
      .select("id, business_name, address, phone, email, website")
      .in("id", data.ids);
    if (error) throw new Error("Could not load the selected leads.");
    const results = await Promise.all(
      (rows ?? []).map(async (r) => {
        if (r.email) return { id: r.id, email: r.email as string | null };
        let email: string | null = null;
          try {
            email = await findEmailViaScrapeGraph(r.business_name, r.address ?? "", r.phone ?? null, r.website ?? null);
          } catch (e) {
          console.error("Email lookup failed", e);
        }
        if (email) await supabase.from("leads").update({ email }).eq("id", r.id);
        return { id: r.id, email };
      }),
    );
    return { results, found: results.filter((r) => r.email).length };
  });

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

export const findPersonalEmailsForLeads = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ ids: z.array(z.string().uuid()).min(1).max(10) }).parse(d))
  .handler(async ({ data }) => {
    const supabase = await getAdmin();
    const { data: rows, error } = await supabase
      .from("leads")
      .select("id, business_name, address, phone, personal_email")
      .in("id", data.ids);
    if (error) throw new Error("Could not load the selected leads.");
    const results = await Promise.all(
      (rows ?? []).map(async (r) => {
        if (r.personal_email) return { id: r.id, email: r.personal_email as string | null };
        let email: string | null = null;
        try {
          email = await findPersonalEmailViaScrapeGraph(r.business_name, r.address ?? "", r.phone ?? null);
        } catch (e) {
          console.error("Personal email lookup failed", e);
        }
        if (email) await supabase.from("leads").update({ personal_email: email }).eq("id", r.id);
        return { id: r.id, email };
      }),
    );
    return { results, found: results.filter((r) => r.email).length };
  });

export const findLeads = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        category: z.string().trim().min(1).max(120),
        location: z.string().trim().min(1).max(160),
        maxLeads: z.number().int().min(1).max(500),
        mode: z.enum(["all", "emails", "phones"]).default("all"),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    let saved = 0;
    let duplicates = 0;
    let scanned = 0;
    let requestsMade = 0;
    let hitRateLimit = false;
    let hitEnd = false;

    try {
    const key = process.env["SERPAPI_KEY"];
    if (!key) {
      return {
        saved: 0,
        duplicates: 0,
        scanned: 0,
        requestsMade: 0,
        hitRateLimit: false,
        hitEnd: false,
        error: "The search service is not configured. Please try again after it has been configured.",
      };
    }
    const supabase = await getAdmin();

    const q = `${data.category} in ${data.location}`;
    const seen = new Set<string>();
    let start = 0;
    let serviceError: string | null = null;

    while (saved < data.maxLeads) {
      const used = await countRequestsLastHour(supabase);
      if (used >= RATE_LIMIT) {
        hitRateLimit = true;
        break;
      }
      await supabase.from("api_requests").insert({});
      requestsMade++;

      const url = new URL("https://serpapi.com/search.json");
      url.searchParams.set("engine", "google_maps");
      url.searchParams.set("type", "search");
      url.searchParams.set("q", q);
      url.searchParams.set("start", String(start));
      url.searchParams.set("api_key", key);

      let res: Response;
      try {
        res = await fetchWithRetry(url.toString());
      } catch (e) {
        console.error("SerpAPI request failed after retries", e);
        serviceError = "The map search service is temporarily unreachable. Your saved leads are safe; please try again in a moment.";
        break;
      }
      if (!res.ok) {
        const text = await res.text();
        console.error(`SerpAPI returned ${res.status}: ${text.slice(0, 500)}`);
        serviceError = res.status === 429
          ? "The map search service has reached its request limit. Please try again later."
          : res.status === 401 || res.status === 403
            ? "The map search service rejected the access key. It looks invalid or expired — please update it."
            : "The map search service could not complete this search. Please try again in a moment.";
        break;
      }
      let json: { local_results?: MapsResult[]; error?: string };
      try {
        json = (await res.json()) as { local_results?: MapsResult[]; error?: string };
      } catch (e) {
        console.error("SerpAPI returned an invalid response", e);
        serviceError = "The map search service returned an invalid response. Please try again in a moment.";
        break;
      }
      if (json.error) {
        console.error(`SerpAPI response error: ${json.error}`);
        serviceError = "The map search service rejected this search. Check the search terms and try again.";
        break;
      }
      const results = json.local_results ?? [];
      if (results.length === 0) {
        hitEnd = true;
        break;
      }
      scanned += results.length;

      for (const r of results) {
        if (saved >= data.maxLeads) break;
        if (r.sponsored || r.ad) continue;
        if (r.permanently_closed) continue;
        if (!r.title || !r.address) continue;
        if (data.mode === "phones" && !r.phone) continue;

        let email: string | null = null;
        if (data.mode !== "phones" && r.website) {
          email = await scrapeEmailsFromWebsite(r.website);
        }
        // Web/AI email lookups run on demand from the Leads page, not here.
        if (data.mode === "emails" && !email) continue;

        const placeId = r.place_id ?? r.data_id ?? null;
        const lat = r.gps_coordinates?.latitude ?? null;
        const lng = r.gps_coordinates?.longitude ?? null;

        // Duplicate detection (within this run)
        const keys = [
          placeId ? `p:${placeId}` : null,
          `n:${r.title.trim().toLowerCase()}|${r.address.trim().toLowerCase()}`,
        ].filter(Boolean) as string[];
        if (keys.some((k) => seen.has(k))) {
          duplicates++;
          continue;
        }

        let existing: { id: string } | null = null;
        if (placeId) {
          const { data: byPlace } = await supabase.from("leads").select("id").eq("place_id", placeId).maybeSingle();
          if (byPlace) existing = byPlace;
        }
        if (!existing) {
          const { data: byNameAddr } = await supabase
            .from("leads")
            .select("id")
            .ilike("business_name", r.title)
            .ilike("address", r.address)
            .maybeSingle();
          if (byNameAddr) existing = byNameAddr;
        }
        if (!existing && lat != null && lng != null) {
          const { data: byGeo } = await supabase
            .from("leads")
            .select("id")
            .ilike("business_name", r.title)
            .eq("latitude", lat)
            .eq("longitude", lng)
            .maybeSingle();
          if (byGeo) existing = byGeo;
        }
        if (existing) {
          duplicates++;
          continue;
        }

        const { error: insErr } = await supabase.from("leads").insert({
          business_name: r.title,
          category: r.type ?? (r.types?.[0] ?? data.category),
          address: r.address,
          phone: r.phone ?? null,
          email,
          website: r.website ?? null,
          rating: r.rating ?? null,
          reviews: r.reviews ?? null,
          maps_link: r.link ?? null,
          place_id: placeId,
          latitude: lat,
          longitude: lng,
          search_category: data.category,
          search_location: data.location,
        });
        if (insErr) {
          if (insErr.code === "23505") duplicates++;
          else throw new Error(insErr.message);
        } else {
          saved++;
          keys.forEach((k) => seen.add(k));
        }
      }

      start += 20;
      if (results.length < 20) {
        hitEnd = true;
        break;
      }
    }

    await supabase.from("searches").insert({
      query: data.category,
      location: data.location,
      scanned,
      saved,
      duplicates,
    });

    return { saved, duplicates, scanned, requestsMade, hitRateLimit, hitEnd, error: serviceError };
    } catch (error) {
      console.error("Lead search failed", error);
      return {
        saved,
        duplicates,
        scanned,
        requestsMade,
        hitRateLimit,
        hitEnd,
        error: "The search service is temporarily unavailable. Your saved leads are safe; please try again in a moment.",
      };
    }
  });