"""
Delhi Industry Data Service
===========================
Queries the Supabase database for industrial point sources with strict database-level filtering:
    WHERE city = 'Delhi' AND state = 'Delhi'

Ensures ONLY records from Delhi are retrieved, completely excluding Chennai,
Tamil Nadu, or any other cities/states at the database query level.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

import httpx

from app.core.config import get_settings
from app.schemas.industry import IndustryRecord, IndustryResponse

logger = logging.getLogger(__name__)

# Prominent Delhi Industrial Facilities & Baseline Dataset (Fallback when Supabase URL is not configured)
# Note: All records are strictly city='Delhi', state='Delhi'.
DELHI_BASELINE_INDUSTRIES: list[dict[str, Any]] = [
    {
        "id": "del-ind-01",
        "name": "Badarpur Thermal Power Station",
        "city": "Delhi",
        "state": "Delhi",
        "latitude": 28.5080,
        "longitude": 77.3050,
        "category": "Power Generation",
        "sector": "Thermal Power Plant (Decommissioned/Point-Source)",
        "capacity": "705 MW site",
        "status": "Monitored",
        "address": "Badarpur, South East Delhi",
    },
    {
        "id": "del-ind-02",
        "name": "Pragati Combined Cycle Power Station",
        "city": "Delhi",
        "state": "Delhi",
        "latitude": 28.6185,
        "longitude": 77.2510,
        "category": "Power Generation",
        "sector": "Gas-based Combined Cycle",
        "capacity": "330 MW",
        "status": "Operational",
        "address": "Ring Road, IP Estate, Central Delhi",
    },
    {
        "id": "del-ind-03",
        "name": "Indraprastha Power Station (IPGCL)",
        "city": "Delhi",
        "state": "Delhi",
        "latitude": 28.6250,
        "longitude": 77.2480,
        "category": "Power Generation",
        "sector": "Gas Turbine Power Station",
        "capacity": "270 MW",
        "status": "Operational",
        "address": "IP Estate, New Delhi",
    },
    {
        "id": "del-ind-04",
        "name": "Timarpur Okhla Waste to Energy Plant",
        "city": "Delhi",
        "state": "Delhi",
        "latitude": 28.5340,
        "longitude": 77.2830,
        "category": "Waste to Energy",
        "sector": "Municipal Solid Waste Incineration",
        "capacity": "23 MW / 2000 TPD",
        "status": "Operational",
        "address": "Old NDMC Compost Plant, Okhla, South Delhi",
    },
    {
        "id": "del-ind-05",
        "name": "Ghazipur Waste to Energy Plant",
        "city": "Delhi",
        "state": "Delhi",
        "latitude": 28.6240,
        "longitude": 77.3290,
        "category": "Waste to Energy",
        "sector": "Refuse Derived Fuel (RDF) Incineration",
        "capacity": "12 MW / 1300 TPD",
        "status": "Operational",
        "address": "Ghazipur Landfill Site, East Delhi",
    },
    {
        "id": "del-ind-06",
        "name": "Narela Bawana Waste to Energy Facility",
        "city": "Delhi",
        "state": "Delhi",
        "latitude": 28.8050,
        "longitude": 77.0680,
        "category": "Waste to Energy",
        "sector": "Solid Waste Management & Power Generation",
        "capacity": "24 MW / 2000 TPD",
        "status": "Operational",
        "address": "Bawana Industrial Area, North West Delhi",
    },
    {
        "id": "del-ind-07",
        "name": "Tehkhand Waste to Energy Plant",
        "city": "Delhi",
        "state": "Delhi",
        "latitude": 28.5120,
        "longitude": 77.2920,
        "category": "Waste to Energy",
        "sector": "Engineered MSW Processing",
        "capacity": "25 MW / 2000 TPD",
        "status": "Operational",
        "address": "Tehkhand, Okhla Phase-I, South Delhi",
    },
    {
        "id": "del-ind-08",
        "name": "Bawana Industrial Area - Cluster A",
        "city": "Delhi",
        "state": "Delhi",
        "latitude": 28.7980,
        "longitude": 77.0420,
        "category": "Manufacturing Cluster",
        "sector": "Plastics, Metals & Chemical Processing",
        "capacity": "DSIIDC Cluster",
        "status": "Operational",
        "address": "Bawana, Sector 1-5, North West Delhi",
    },
    {
        "id": "del-ind-09",
        "name": "Narela Industrial Complex",
        "city": "Delhi",
        "state": "Delhi",
        "latitude": 28.8410,
        "longitude": 77.0950,
        "category": "Manufacturing Cluster",
        "sector": "Food Processing, Polymers & Packaging",
        "capacity": "DSIIDC Complex",
        "status": "Operational",
        "address": "Narela, North Delhi",
    },
    {
        "id": "del-ind-10",
        "name": "Okhla Industrial Area Phase I & II",
        "city": "Delhi",
        "state": "Delhi",
        "latitude": 28.5270,
        "longitude": 77.2750,
        "category": "Industrial Zone",
        "sector": "Fabrication, Electronics & Printing",
        "capacity": "Major Urban Cluster",
        "status": "Operational",
        "address": "Okhla Industrial Area, South Delhi",
    },
    {
        "id": "del-ind-11",
        "name": "Mayapuri Industrial Area Phase I & II",
        "city": "Delhi",
        "state": "Delhi",
        "latitude": 28.6360,
        "longitude": 77.1180,
        "category": "Metal & Machinery",
        "sector": "Automotive Scrapping & Metal Recycling",
        "capacity": "Urban Industrial Hub",
        "status": "Operational",
        "address": "Mayapuri, West Delhi",
    },
    {
        "id": "del-ind-12",
        "name": "Wazirpur Industrial Area",
        "city": "Delhi",
        "state": "Delhi",
        "latitude": 28.6980,
        "longitude": 77.1680,
        "category": "Metallurgical & Steel",
        "sector": "Stainless Steel Pickling & Rolling Mills",
        "capacity": "Heavy Metal Rolling",
        "status": "Operational",
        "address": "Wazirpur, North West Delhi",
    },
    {
        "id": "del-ind-13",
        "name": "Naraina Industrial Area Phase I & II",
        "city": "Delhi",
        "state": "Delhi",
        "latitude": 28.6280,
        "longitude": 77.1390,
        "category": "Manufacturing & Packaging",
        "sector": "Electronics, Steel & Chemical Warehousing",
        "capacity": "Industrial Hub",
        "status": "Operational",
        "address": "Naraina, South West Delhi",
    },
    {
        "id": "del-ind-14",
        "name": "Kirti Nagar Industrial Area",
        "city": "Delhi",
        "state": "Delhi",
        "latitude": 28.6520,
        "longitude": 77.1450,
        "category": "Wood & Furniture",
        "sector": "Timber Processing, Woodwork & Resins",
        "capacity": "Specialized Industrial Hub",
        "status": "Operational",
        "address": "Kirti Nagar, West Delhi",
    },
    {
        "id": "del-ind-15",
        "name": "Patparganj Industrial Area (FIE)",
        "city": "Delhi",
        "state": "Delhi",
        "latitude": 28.6310,
        "longitude": 77.3090,
        "category": "Light Engineering",
        "sector": "Printing, Precision Tools & Electronics",
        "capacity": "Flatted Factory Complex",
        "status": "Operational",
        "address": "Patparganj, East Delhi",
    },
    {
        "id": "del-ind-16",
        "name": "Lawrence Road Industrial Area",
        "city": "Delhi",
        "state": "Delhi",
        "latitude": 28.6820,
        "longitude": 77.1520,
        "category": "Food & Agro",
        "sector": "Flour Mills, Edible Oils & Agro Processing",
        "capacity": "Agro Processing Hub",
        "status": "Operational",
        "address": "Lawrence Road, North West Delhi",
    },
    {
        "id": "del-ind-17",
        "name": "Jhilmil Industrial Area",
        "city": "Delhi",
        "state": "Delhi",
        "latitude": 28.6750,
        "longitude": 77.3180,
        "category": "Light Engineering",
        "sector": "Electrical Appliances, Plastics & Cables",
        "capacity": "DSIIDC Industrial Area",
        "status": "Operational",
        "address": "Jhilmil Tahirpur, Shahdara, East Delhi",
    },
    {
        "id": "del-ind-18",
        "name": "Mangolpuri Industrial Area Phase I & II",
        "city": "Delhi",
        "state": "Delhi",
        "latitude": 28.6940,
        "longitude": 77.0870,
        "category": "Manufacturing Cluster",
        "sector": "Footwear, Leather & Polymers",
        "capacity": "MSME Cluster",
        "status": "Operational",
        "address": "Mangolpuri, West Delhi",
    },
]


def _normalize_raw_record(row: dict[str, Any]) -> Optional[IndustryRecord]:
    """
    Normalizes a raw database record into an IndustryRecord.
    Strictly verifies that city == 'Delhi' and state == 'Delhi'.
    """
    city = str(row.get("city") or row.get("City") or "").strip()
    state = str(row.get("state") or row.get("State") or "").strip()

    # Strict server-side verification: reject any non-Delhi records
    if city.lower() != "delhi" or state.lower() != "delhi":
        return None

    # Handle flexible coordinate key names (lat/latitude, lon/long/longitude)
    lat_val = row.get("latitude") or row.get("lat") or row.get("Latitude")
    lon_val = row.get("longitude") or row.get("lon") or row.get("lng") or row.get("Longitude")

    if lat_val is None or lon_val is None:
        return None

    try:
        lat = float(lat_val)
        lon = float(lon_val)
    except (ValueError, TypeError):
        return None

    name = str(row.get("name") or row.get("facility_name") or row.get("Name") or "Delhi Industrial Facility").strip()
    category = row.get("category") or row.get("type") or row.get("Category") or "Industrial Source"
    sector = row.get("sector") or row.get("sub_sector") or row.get("Sector")
    status = row.get("status") or row.get("Status") or "Operational"
    capacity = row.get("capacity") or row.get("Capacity")
    address = row.get("address") or row.get("location") or row.get("Address") or f"{name}, Delhi"
    rec_id = row.get("id") or row.get("uuid") or f"del-{name.lower().replace(' ', '-')[:20]}"

    return IndustryRecord(
        id=rec_id,
        name=name,
        city="Delhi",
        state="Delhi",
        latitude=lat,
        longitude=lon,
        category=str(category) if category else None,
        sector=str(sector) if sector else None,
        status=str(status) if status else None,
        capacity=str(capacity) if capacity else None,
        address=str(address) if address else None,
    )


async def fetch_delhi_industries(
    min_lat: Optional[float] = None,
    max_lat: Optional[float] = None,
    min_lon: Optional[float] = None,
    max_lon: Optional[float] = None,
) -> IndustryResponse:
    """
    Fetches industry records strictly for Delhi from Supabase.
    
    Database Query:
        SELECT * FROM industries 
        WHERE city = 'Delhi' AND state = 'Delhi'
        [AND latitude BETWEEN min_lat AND max_lat]
        [AND longitude BETWEEN min_lon AND max_lon]
        
    Guarantees that NO non-Delhi records (Chennai, Tamil Nadu, etc.) are ever queried or loaded.
    """
    settings = get_settings()
    supabase_url = (settings.supabase_url or os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL", "")).rstrip("/")
    supabase_key = settings.supabase_key or settings.supabase_anon_key or os.getenv("SUPABASE_KEY") or os.getenv("SUPABASE_ANON_KEY") or os.getenv("VITE_SUPABASE_ANON_KEY", "")

    # If Supabase URL and Key are available, query the database directly
    if supabase_url and supabase_key:
        try:
            # PostgREST URL with mandatory database-level filters: city=eq.Delhi and state=eq.Delhi
            endpoint = f"{supabase_url}/rest/v1/industries"
            
            # PostgREST query parameters ensuring strict server-side filtering
            params: dict[str, str] = {
                "select": "*",
                "city": "eq.Delhi",
                "state": "eq.Delhi",
                "limit": "1000",
            }

            # Optional server-side viewport filtering applied AFTER the Delhi restriction
            if min_lat is not None:
                params["latitude"] = f"gte.{min_lat}"
            if max_lat is not None:
                params["latitude"] = f"lte.{max_lat}"
            if min_lon is not None:
                params["longitude"] = f"gte.{min_lon}"
            if max_lon is not None:
                params["longitude"] = f"lte.{max_lon}"

            headers = {
                "apikey": supabase_key,
                "Authorization": f"Bearer {supabase_key}",
                "Accept": "application/json",
            }

            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(endpoint, params=params, headers=headers)
                if resp.status_code == 200:
                    raw_data = resp.json()
                    valid_records: list[IndustryRecord] = []
                    for row in raw_data:
                        rec = _normalize_raw_record(row)
                        if rec:
                            valid_records.append(rec)

                    logger.info("Successfully fetched %d Delhi industry records from Supabase", len(valid_records))
                    return IndustryResponse(
                        city="Delhi",
                        state="Delhi",
                        count=len(valid_records),
                        source="supabase",
                        records=valid_records,
                    )
                else:
                    logger.warning("Supabase returned HTTP %d: %s", resp.status_code, resp.text[:200])
        except Exception as e:
            logger.error("Error querying Supabase industries: %s", e)

    # Fallback / Local baseline dataset (strictly filtered to Delhi)
    filtered: list[IndustryRecord] = []
    for row in DELHI_BASELINE_INDUSTRIES:
        rec = _normalize_raw_record(row)
        if not rec:
            continue
        if min_lat is not None and rec.latitude < min_lat:
            continue
        if max_lat is not None and rec.latitude > max_lat:
            continue
        if min_lon is not None and rec.longitude < min_lon:
            continue
        if max_lon is not None and rec.longitude > max_lon:
            continue
        filtered.append(rec)

    return IndustryResponse(
        city="Delhi",
        state="Delhi",
        count=len(filtered),
        source="delhi_reference",
        records=filtered,
    )
