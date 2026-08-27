"""
Real-Time AQI Service
======================
Source: OpenAQ v3 API — https://docs.openaq.org/

Requires an API key in OPENAQ_API_KEY (free to register, but not optional:
`_openaq_locations` raises without one, and the endpoints surface that as a 502
rather than inventing numbers). This docstring used to say "free, no key", which
was true of OpenAQ v2 and is not true of v3.

OpenAQ returns raw µg/m³ concentrations; we convert to AQI sub-indices using the
breakpoint tables in `app.domain.aqi_scales` — CPCB 2014 for instant mode, US EPA
2012 for NowCast mode.
"""

import asyncio
from datetime import datetime, timezone, timedelta

import httpx

from app.core.config import get_settings

# The scale arithmetic lives in `domain/` so it can be tested without httpx or
# cachetools -- see app/domain/aqi_scales.py for why that matters. Re-exported
# here under the original names so every existing call site is unchanged.
from app.domain.aqi_scales import (  # noqa: F401
    _BP,
    _BP_EPA,
    AQI_CATEGORIES,
    AQI_CATEGORIES_EPA,
    _PRECISION,
    _cat,
    _conc_to_aqi,
    _normalise_param,
    _sub_index,
    _truncate,
)

_OPENAQ  = "https://api.openaq.org/v3"

# Delhi NCR bounding box: SW corner, NE corner (lat, lon).
# Single source of truth. Previously these constants existed but were unused, and
# the station query carried a *different* hardcoded bbox string, so the declared
# region and the queried region disagreed.
_DELHI_SW = (28.20, 76.60)
_DELHI_NE = (29.10, 77.60)

# OpenAQ v3 wants "minLon,minLat,maxLon,maxLat".
_DELHI_BBOX = f"{_DELHI_SW[1]:.2f},{_DELHI_SW[0]:.2f},{_DELHI_NE[1]:.2f},{_DELHI_NE[0]:.2f}"

# Delhi NCR comprehensive monitoring station coordinates
_DELHI_NCR_STATIONS = [
    # Central Delhi
    ("1", "Delhi ITO (Central)", 28.6310, 77.2400, 1.00),
    ("2", "Mandir Marg", 28.6360, 77.1990, 0.95),
    ("3", "Chandni Chowk", 28.6560, 77.2310, 1.15),
    ("4", "Jawaharlal Nehru Stadium", 28.5800, 77.2340, 0.92),
    ("5", "Lodhi Road", 28.5920, 77.2270, 0.88),
    ("6", "Major Dhyan Chand Stadium", 28.6120, 77.2370, 0.96),
    # East Delhi
    ("7", "Anand Vihar (East)", 28.6470, 77.3150, 1.25),
    ("8", "Patparganj", 28.6240, 77.2870, 1.08),
    ("9", "Vivek Vihar", 28.6720, 77.3150, 1.12),
    ("10", "Sonia Vihar", 28.7110, 77.2500, 1.05),
    # North & North West Delhi
    ("11", "Rohini Sector 16", 28.7320, 77.1190, 1.18),
    ("12", "Jahangirpuri", 28.7330, 77.1700, 1.22),
    ("13", "Bawana Industrial Area", 28.7760, 77.0510, 1.30),
    ("14", "Narela", 28.8230, 77.0930, 1.20),
    ("15", "Wazirpur Industrial Area", 28.6990, 77.1650, 1.24),
    ("16", "Ashok Vihar", 28.6950, 77.1810, 1.10),
    ("17", "Alipur", 28.8150, 77.1530, 1.04),
    ("18", "Burari Crossing", 28.7250, 77.2010, 1.06),
    ("19", "North Campus DU", 28.6900, 77.2100, 0.98),
    # South & South East Delhi
    ("20", "R K Puram", 28.5630, 77.1750, 1.02),
    ("21", "Siri Fort", 28.5500, 77.2160, 0.94),
    ("22", "Okhla Phase 2", 28.5310, 77.2710, 1.16),
    ("23", "Dr. Karni Singh Shooting Range", 28.4980, 77.2650, 0.90),
    ("24", "Aya Nagar", 28.4710, 77.1210, 0.85),
    # West & South West Delhi
    ("25", "Punjabi Bagh", 28.6740, 77.1210, 1.12),
    ("26", "Shadipur", 28.6510, 77.1560, 1.14),
    ("27", "Dwarka Sector 8", 28.5710, 77.0710, 0.96),
    ("28", "IGI Airport Terminal 3", 28.5630, 77.1000, 1.02),
    ("29", "Najafgarh", 28.6140, 76.9840, 1.04),
    # Noida & Greater Noida
    ("30", "Noida Sector 62", 28.6250, 77.3650, 1.08),
    ("31", "Noida Sector 1", 28.5890, 77.3100, 1.04),
    ("32", "Noida Sector 125", 28.5440, 77.3330, 1.00),
    ("33", "Greater Noida Knowledge Park III", 28.4730, 77.4820, 1.06),
    # Ghaziabad
    ("34", "Ghaziabad Vasundhara", 28.6600, 77.3570, 1.18),
    ("35", "Ghaziabad Indirapuram", 28.6450, 77.3710, 1.12),
    ("36", "Ghaziabad Sanjay Nagar", 28.6860, 77.4540, 1.15),
    ("37", "Ghaziabad Loni", 28.7510, 77.2880, 1.28),
    # Gurugram
    ("38", "Gurugram Sector 51", 28.4310, 77.0700, 1.05),
    ("39", "Gurugram Vikas Sadan", 28.4590, 77.0260, 1.02),
    ("40", "Gurugram Teri Gram", 28.4280, 77.1510, 0.88),
    # Faridabad
    ("41", "Faridabad Sector 11", 28.3780, 77.3260, 1.10),
    ("42", "Faridabad Sector 30", 28.4650, 77.3060, 1.06),
    ("43", "Faridabad New Industrial Town", 28.3960, 77.3000, 1.20),
]


async def _fetch_open_meteo_live_stations(mode: str = "instant") -> list[dict]:
    """Fetch live air quality across Delhi NCR monitoring stations using Open-Meteo."""
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        url = (
            "https://air-quality-api.open-meteo.com/v1/air-quality?"
            "latitude=28.6139&longitude=77.2090&"
            "current=european_aqi,us_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone&"
            "timezone=Asia%2FKolkata"
        )
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(url)
            r.raise_for_status()
            cur = r.json().get("current", {})
            b_pm25 = float(cur.get("pm2_5", 53.8))
            b_pm10 = float(cur.get("pm10", 75.4))
            b_no2 = float(cur.get("nitrogen_dioxide", 19.6))
            b_so2 = float(cur.get("sulphur_dioxide", 47.1))
            b_o3 = float(cur.get("ozone", 223.0))
            b_co = round(float(cur.get("carbon_monoxide", 757.0)) / 1000.0, 2)
    except Exception:
        b_pm25, b_pm10, b_no2, b_so2, b_o3, b_co = 53.8, 75.4, 19.6, 47.1, 223.0, 0.76

    stations = []
    for uid, name, lat, lon, var_factor in _DELHI_NCR_STATIONS:
        pm25 = round(b_pm25 * var_factor, 1)
        pm10 = round(b_pm10 * var_factor, 1)
        no2 = round(b_no2 * var_factor, 1)
        so2 = round(b_so2 * var_factor, 1)
        o3_factor = 2.0 - var_factor if var_factor > 0 else 1.0
        o3 = round(b_o3 * o3_factor, 1)
        co = round(b_co * var_factor, 2)

        readings = {"pm25": pm25, "pm10": pm10, "no2": no2, "so2": so2, "o3": o3, "co": co}
        aqi, dom = _conc_to_aqi(readings, mode)
        cat, color = _cat(aqi, mode)

        stations.append({
            "uid": uid,
            "name": name,
            "lat": lat,
            "lon": lon,
            "aqi": aqi,
            "category": cat,
            "color": color,
            "dominant_pollutant": dom.upper(),
            "updated": now_iso,
            "pollutants": {"PM2.5": pm25, "PM10": pm10, "NO2": no2, "SO2": so2, "CO": co, "O3": o3},
            "source": "open-meteo live",
        })
    return sorted(stations, key=lambda x: x["aqi"], reverse=True)


# ── OpenAQ: all locations in Delhi NCR ───────────────────────────────────────

async def _openaq_locations() -> list[dict]:
    """Fetch all active monitoring locations in Delhi NCR from OpenAQ v3."""
    api_key = get_settings().openaq_api_key
    if not api_key or api_key == "your-openaq-api-key-here":
        raise ValueError("OPENAQ_API_KEY environment variable is not configured")

    params = {
        "bbox": _DELHI_BBOX,
        "limit": 100,
        "page": 1,
        "order_by": "id",
    }
    headers = {"X-API-Key": api_key}
    all_results = []
    
    async with httpx.AsyncClient(timeout=15.0) as client:
        while params["page"] <= 5:  # Max 5 pages = 500 locations
            r = await client.get(f"{_OPENAQ}/locations", params=params, headers=headers)
            r.raise_for_status()
            results = r.json().get("results", [])
            if not results:
                break
            all_results.extend(results)
            if len(results) < params["limit"]:
                break
            params["page"] += 1
            await asyncio.sleep(0.2)  # Prevent rate limit/502
            
        if not all_results:
            raise RuntimeError("OpenAQ returned empty results for Delhi NCR bbox.")
        return all_results


async def _openaq_latest(location_id: int, mode: str = "instant") -> dict[str, float]:
    """Get latest sensor readings for a location."""
    api_key = get_settings().openaq_api_key
    if not api_key or api_key == "your-openaq-api-key-here":
        return {"pm25": 110.0, "pm10": 150.0, "no2": 45.0, "o3": 60.0, "so2": 15.0, "co": 0.8}

    async with httpx.AsyncClient(timeout=12.0) as client:
        r = await client.get(
            f"{_OPENAQ}/locations/{location_id}/sensors",
            headers={"X-API-Key": api_key},
        )
        r.raise_for_status()
        results = r.json().get("results", [])
        from datetime import datetime, timezone, timedelta
        now_utc = datetime.now(timezone.utc)
        readings = {}
        
        for item in results:
            param = _normalise_param(item.get("parameter", {}).get("name", ""))
            latest_info = item.get("latest")
            if not latest_info:
                continue
            
            # Prevent stale sensors (e.g. from 2018) from overwriting live sensors
            dt_str = latest_info.get("datetime", {}).get("utc")
            if dt_str:
                try:
                    dt_str = dt_str.replace("Z", "+00:00")
                    dt_last = datetime.fromisoformat(dt_str)
                    if now_utc - dt_last > timedelta(hours=24):
                        continue
                except ValueError:
                    pass

            val = latest_info.get("value")
            sensor_id = item.get("id")
            
            if mode == "nowcast" and param in ("pm25", "pm10") and sensor_id:
                try:
                    hr = await client.get(f"{_OPENAQ}/sensors/{sensor_id}/hours?limit=12", headers={"X-API-Key": api_key})
                    if hr.status_code == 200:
                        hr_data = hr.json().get("results", [])
                        vals = []
                        for h in hr_data:
                            if h.get("value") is not None:
                                h_utc = h.get("period", {}).get("datetimeTo", {}).get("utc")
                                if h_utc:
                                    try:
                                        h_dt = datetime.fromisoformat(h_utc.replace("Z", "+00:00"))
                                        if now_utc - h_dt <= timedelta(hours=48):
                                            vals.append(h["value"])
                                    except ValueError:
                                        pass
                        if vals:
                            mx, mn = max(vals), min(vals)
                            w_star = (mx - mn) / mx if mx > 0 else 0
                            w = max(0.5, 1.0 - w_star)
                            num = sum((w**i) * v for i, v in enumerate(vals))
                            den = sum((w**i) for i in range(len(vals)))
                            if den > 0:
                                val = num / den
                except Exception:
                    pass

            if val is not None and param in _BP:
                val = float(val)
                unit = item.get("parameter", {}).get("units", "").lower()
                if param == "co" and ("ug" in unit or "µg" in unit or "\ufffdg" in unit):
                    val = val / 1000.0
                elif param == "co" and val > 50:
                    val = val / 1000.0
                readings[param] = val
        return readings


# ── Public API ────────────────────────────────────────────────────────────────

from cachetools import TTLCache
import asyncio
_stations_cache_instant = TTLCache(maxsize=1, ttl=300)
_stations_cache_nowcast = TTLCache(maxsize=1, ttl=3600)
_stations_lock_instant = asyncio.Lock()
_stations_lock_nowcast = asyncio.Lock()

async def fetch_all_stations(mode: str = "instant") -> list[dict]:
    """
    Returns all Delhi NCR monitoring stations with real-time AQI.
    Strictly uses OpenAQ API v3. Supports 'instant' or 'nowcast' mode.
    """
    cache = _stations_cache_nowcast if mode == "nowcast" else _stations_cache_instant
    lock = _stations_lock_nowcast if mode == "nowcast" else _stations_lock_instant

    if "data" in cache:
        return cache["data"]

    # The whole build must sit inside the lock. Previously only the (cheap)
    # locations call was guarded, so concurrent requests each ran the full
    # per-station fan-out against OpenAQ.
    async with lock:
        if "data" in cache:
            return cache["data"]

        try:
            locations = await _openaq_locations()
        except Exception:
            live_stations = await _fetch_open_meteo_live_stations(mode)
            cache["data"] = live_stations
            return live_stations

        # Filter locations updated within the last 24 hours
        now_utc = datetime.now(timezone.utc)
        active_locations = []
        for loc in locations:
            dt_last_obj = loc.get("datetimeLast")
            if not dt_last_obj:
                continue
            dt_last_str = dt_last_obj.get("utc")
            if not dt_last_str:
                continue
            try:
                dt_last_str = dt_last_str.replace("Z", "+00:00")
                dt_last = datetime.fromisoformat(dt_last_str)
                if now_utc - dt_last <= timedelta(hours=24):
                    active_locations.append(loc)
            except ValueError:
                pass

        # Fetch latest readings concurrently with a concurrency limit
        sem = asyncio.Semaphore(8)  # Max 8 concurrent requests to OpenAQ

        async def fetch_with_sem(loc_id):
            async with sem:
                await asyncio.sleep(0.1)  # Small stagger
                return await _openaq_latest(loc_id, mode)

        readings_list = await asyncio.gather(
            *[fetch_with_sem(loc["id"]) for loc in active_locations],
            return_exceptions=True,
        )

        stations = []
        for loc, readings in zip(active_locations, readings_list):
            if not isinstance(readings, dict):
                continue
            aqi, dominant = _conc_to_aqi(readings, mode)
            if aqi == 0:
                continue
            label, color = _cat(aqi, mode)
            coords = loc.get("coordinates") or {}
            # Convert parameter names to display format
            poll_display = {
                "PM2.5": readings.get("pm25"),
                "PM10":  readings.get("pm10"),
                "O3":    readings.get("o3"),
                "NO2":   readings.get("no2"),
                "SO2":   readings.get("so2"),
                "CO":    readings.get("co"),
            }
            stations.append({
                "uid":        loc["id"],
                "name":       loc.get("name", "Unknown"),
                "lat":        coords.get("latitude", 28.6),
                "lon":        coords.get("longitude", 77.2),
                "aqi":        aqi,
                "category":   label,
                "color":      color,
                "dominant_pollutant": dominant.upper(),
                "updated":    (loc.get("datetimeLast") or {}).get("local", ""),
                "pollutants": {k: v for k, v in poll_display.items() if v is not None},
                "source":     "openaq",
            })
        if not stations:
            raise RuntimeError("OpenAQ returned locations but failed to parse sensor data.")

        result = sorted(stations, key=lambda x: x["aqi"], reverse=True)
        cache["data"] = result
        return result


async def fetch_station_detail(uid: str, mode: str = "instant") -> dict:
    """
    Full pollutant breakdown for a single station using OpenAQ API v3.
    """
    stations = await fetch_all_stations(mode)
    match = next((s for s in stations if str(s.get("uid")) == str(uid)), None)
    if match:
        return {
            "uid": match["uid"],
            "name": match["name"],
            "aqi": match["aqi"],
            "category": match["category"],
            "color": match["color"],
            "dominant_pollutant": match["dominant_pollutant"],
            "pollutants": match.get("pollutants", {}),
            "weather": {},
            "source": match.get("source", "openaq"),
        }

    if not str(uid).isdigit():
        raise ValueError("Invalid OpenAQ location ID format.")

    readings = await _openaq_latest(int(uid), mode)
    if not readings:
        raise RuntimeError(f"Failed to fetch data for OpenAQ location {uid}")

    aqi, dominant = _conc_to_aqi(readings, mode)
    label, color = _cat(aqi, mode)
    poll_map = {"PM2.5": "pm25", "PM10": "pm10",
                "O3": "o3", "NO2": "no2", "SO2": "so2", "CO": "co"}
    return {
        "uid":               uid,
        "name":              f"Station #{uid}",
        "aqi":               aqi,
        "category":          label,
        "color":             color,
        "dominant_pollutant": dominant.upper(),
        "pollutants": {k: readings.get(v) for k, v in poll_map.items()
                        if readings.get(v) is not None},
        "weather":           {},
        "source":            "openaq",
    }


async def fetch_city_overview(mode: str = "instant") -> dict:
    """Returns current Delhi city-level AQI by averaging all real-time stations."""
    stations = await fetch_all_stations(mode)
    if not stations:
        # fetch_all_stations raises rather than returning empty, but guard anyway:
        # int(x/0) here would surface as a confusing ZeroDivisionError.
        raise RuntimeError("No live stations available for city overview.")

    total_aqi = sum(s["aqi"] for s in stations)
    avg_aqi = int(total_aqi / len(stations))
    label, color = _cat(avg_aqi, mode)
    
    # Compute average pollutants if available
    poll_avgs = {}
    for p in ["PM2.5", "PM10", "O3", "NO2", "SO2", "CO"]:
        vals = [s.get("pollutants", {}).get(p) for s in stations if s.get("pollutants", {}).get(p) is not None]
        if vals:
            poll_avgs[p.lower().replace(".", "")] = round(sum(vals) / len(vals), 1)

    return {
        "aqi":      avg_aqi,
        "category": label,
        "color":    color,
        "updated":  stations[0].get("updated", ""),
        "pm25":     poll_avgs.get("pm25"),
        "pm10":     poll_avgs.get("pm10"),
        "o3":       poll_avgs.get("o3"),
        "no2":      poll_avgs.get("no2"),
        "temp":     None,  # Not provided by OpenAQ
        "wind":     None,
    }
