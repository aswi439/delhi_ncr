/**
 * Supabase Client & Delhi-Only Industry Data Fetcher
 * ===================================================
 * Strictly queries the 'industries' table with database-level filtering:
 *   WHERE city = 'Delhi' AND state = 'Delhi'
 *
 * CRITICAL RULE:
 * Chennai, Tamil Nadu, and any non-Delhi industries are strictly excluded
 * at the database query level before reaching the client.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { IndustryRecord, IndustryResponse } from "./types";

const DEFAULT_SUPABASE_URL = "https://ozaxpjkmubtnotwiltfc.supabase.co";
const DEFAULT_SUPABASE_KEY = "sb_publishable_2fAjnCcJa8oF7vyTxeX73A_IiBFaN57";

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL).trim();
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_KEY).trim();

let supabaseInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (supabaseInstance) return supabaseInstance;
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
      supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      return supabaseInstance;
    } catch (err) {
      console.warn("Failed to initialize Supabase client:", err);
    }
  }
  return null;
}

export interface MapBoundsQuery {
  minLat?: number;
  maxLat?: number;
  minLon?: number;
  maxLon?: number;
}

/**
 * Normalizes a database row to an IndustryRecord.
 * Strictly verifies that city === 'Delhi' and state === 'Delhi'.
 */
function normalizeRecord(row: any): IndustryRecord | null {
  const city = String(row.city || row.City || "").trim();
  const state = String(row.state || row.State || "").trim();

  // Strict check: reject non-Delhi records
  if (city.toLowerCase() !== "delhi" || state.toLowerCase() !== "delhi") {
    return null;
  }

  const latVal = row.latitude ?? row.lat ?? row.Latitude;
  const lonVal = row.longitude ?? row.lon ?? row.lng ?? row.Longitude;

  if (latVal === undefined || lonVal === undefined || latVal === null || lonVal === null) {
    return null;
  }

  const lat = Number(latVal);
  const lon = Number(lonVal);
  if (isNaN(lat) || isNaN(lon)) return null;

  const name = String(row.industry_name || row.name || row.facility_name || row.Name || "Delhi Industrial Facility").trim();
  const category = row.category || row.type || row.Category || "Industrial Facility";
  const sector = row.sector || row.sub_sector || row.Sector || category;
  const status = row.status || row.Status || "Operational";
  const capacity = row.capacity || row.Capacity;
  const address = row.address || row.location || row.Address || `${name}, Delhi`;
  const id = row.place_id || row.id || row.uuid || `del-${name.toLowerCase().replace(/\s+/g, "-").slice(0, 24)}`;

  return {
    id,
    name,
    city: "Delhi",
    state: "Delhi",
    latitude: lat,
    longitude: lon,
    category: category ? String(category) : null,
    sector: sector ? String(sector) : null,
    status: status ? String(status) : null,
    capacity: capacity ? String(capacity) : null,
    address: address ? String(address) : null,
  };
}

/**
 * Fetches ONLY Delhi industry records directly from Supabase with database-level filtering:
 *   .eq('city', 'Delhi')
 *   .eq('state', 'Delhi')
 *
 * If Supabase direct credentials are not in client env, routes through /api/v1/industries.
 */
export async function fetchDelhiIndustries(bounds?: MapBoundsQuery): Promise<IndustryRecord[]> {
  const client = getSupabaseClient();

  // 1. Direct Supabase Query with Database-Level Filtering
  if (client) {
    try {
      let query = client
        .from("industries")
        .select("*")
        .eq("city", "Delhi")
        .eq("state", "Delhi")
        .limit(1000);

      // Optional database-level viewport filtering applied AFTER city/state restrictions
      if (bounds?.minLat !== undefined) query = query.gte("latitude", bounds.minLat);
      if (bounds?.maxLat !== undefined) query = query.lte("latitude", bounds.maxLat);
      if (bounds?.minLon !== undefined) query = query.gte("longitude", bounds.minLon);
      if (bounds?.maxLon !== undefined) query = query.lte("longitude", bounds.maxLon);

      const { data, error } = await query;

      if (!error && Array.isArray(data)) {
        const validated: IndustryRecord[] = [];
        for (const row of data) {
          const rec = normalizeRecord(row);
          if (rec) validated.push(rec);
        }
        if (validated.length > 0) {
          return validated;
        }
      } else if (error) {
        console.warn("Supabase query error for Delhi industries:", error.message);
      }
    } catch (err) {
      console.warn("Direct Supabase query failed, falling back to backend API:", err);
    }
  }

  // 2. Query Backend Endpoint (/api/v1/industries) which performs the same strict database query
  try {
    const params = new URLSearchParams();
    if (bounds?.minLat !== undefined) params.set("min_lat", String(bounds.minLat));
    if (bounds?.maxLat !== undefined) params.set("max_lat", String(bounds.maxLat));
    if (bounds?.minLon !== undefined) params.set("min_lon", String(bounds.minLon));
    if (bounds?.maxLon !== undefined) params.set("max_lon", String(bounds.maxLon));

    const qs = params.toString() ? `?${params.toString()}` : "";
    const res = await fetch(`/api/v1/industries${qs}`);
    if (res.ok) {
      const payload: IndustryResponse = await res.json();
      if (payload && Array.isArray(payload.records) && payload.records.length > 0) {
        return payload.records.filter((r) => r.city === "Delhi" && r.state === "Delhi");
      }
    }
  } catch (err) {
    console.warn("Backend /api/v1/industries fetch failed:", err);
  }

  // 3. Fallback to bundled static CSV of all 534 verified Delhi industries
  try {
    const csvRes = await fetch("/delhi_industries.csv");
    if (csvRes.ok) {
      const text = await csvRes.text();
      const lines = text.split("\n");
      const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
      const records: IndustryRecord[] = [];

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        // Simple CSV parser handling quotes
        const cols: string[] = [];
        let cur = "";
        let inQuote = false;
        for (let j = 0; j < line.length; j++) {
          const char = line[j];
          if (char === '"') {
            inQuote = !inQuote;
          } else if (char === "," && !inQuote) {
            cols.push(cur.trim().replace(/^"|"$/g, ""));
            cur = "";
          } else {
            cur += char;
          }
        }
        cols.push(cur.trim().replace(/^"|"$/g, ""));

        const rowObj: any = {};
        headers.forEach((h, idx) => {
          rowObj[h] = cols[idx] ?? "";
        });

        const rec = normalizeRecord(rowObj);
        if (rec) {
          if (bounds?.minLat !== undefined && rec.latitude < bounds.minLat) continue;
          if (bounds?.maxLat !== undefined && rec.latitude > bounds.maxLat) continue;
          if (bounds?.minLon !== undefined && rec.longitude < bounds.minLon) continue;
          if (bounds?.maxLon !== undefined && rec.longitude > bounds.maxLon) continue;
          records.push(rec);
        }
      }

      if (records.length > 0) {
        return records;
      }
    }
  } catch (err) {
    console.error("Static CSV fallback failed:", err);
  }

  return [];
}

