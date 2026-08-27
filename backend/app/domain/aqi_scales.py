"""
AQI scales: breakpoint tables, sub-index arithmetic, category labelling.
=======================================================================
Pure arithmetic with no third-party imports, so the most demo-critical and
historically most bug-prone part of the system can be unit-tested without the
HTTP stack, the cache, or pydantic. `realtime_service` re-exports everything
here, so existing call sites are unchanged.

This lives in `domain/` for the same reason `species.py` does: it was previously
defined inside `services/realtime_service.py`, which imports `httpx` and
`cachetools` at module scope. That meant `_sub_index` -- the function that
reported clean air as "Severe" for months -- could not be tested at all without
installing a web client.

Two scales, and they are NOT interchangeable
--------------------------------------------
* CPCB National AQI (2014), used for "instant" mode and the whole forecast path.
  Segments are contiguous, so any concentration matches one.
* US EPA (2012), used for "nowcast" mode. Segments are deliberately
  NON-contiguous (pm10 ends at 54, the next starts at 55) because the EPA
  algorithm requires truncating the concentration to the pollutant's reporting
  precision BEFORE lookup. Skip the truncation and readings fall into the gaps.

Their category bands differ too: EPA breaks at 150 where CPCB breaks at 200, and
the names differ. An EPA AQI of 150 is "Unhealthy for Sensitive Groups", not
CPCB's "Moderate". Mixing the tables mislabels the entire 101-200 range, so `_cat`
takes the same `mode` flag as `_sub_index` and callers must pass it through.
"""

import math

# ── CPCB AQI breakpoints (conc_lo, conc_hi, idx_lo, idx_hi) ───────────────────
# PM in µg/m³, CO in mg/m³ (the CPCB table's own unit -- feeding µg/m³ into it
# reports ordinary air as off-the-scale).
_BP: dict[str, list[tuple]] = {
    "pm25": [(0,30,0,50),(30,60,51,100),(60,90,101,200),
             (90,120,201,300),(120,250,301,400),(250,500,401,500)],
    "pm10": [(0,50,0,50),(50,100,51,100),(100,250,101,200),
             (250,350,201,300),(350,430,301,400),(430,600,401,500)],
    "o3":   [(0,50,0,50),(50,100,51,100),(100,168,101,200),
             (168,208,201,300),(208,748,301,400),(748,1000,401,500)],
    "no2":  [(0,40,0,50),(40,80,51,100),(80,180,101,200),
             (180,280,201,300),(280,400,301,400),(400,800,401,500)],
    "so2":  [(0,40,0,50),(40,80,51,100),(80,380,101,200),
             (380,800,201,300),(800,1600,301,400),(1600,2000,401,500)],
    "co":   [(0,1,0,50),(1,2,51,100),(2,10,101,200),
             (10,17,201,300),(17,34,301,400),(34,50,401,500)],
}

# ── US EPA 2012 breakpoints ───────────────────────────────────────────────────
# PM2.5 and PM10 in µg/m³; O3 in µg/m³ (converted from ppm at 25 °C); NO2/SO2 in
# µg/m³ for direct comparison with OpenAQ readings.
#
# IMPORTANT: these segments are intentionally NON-contiguous. See _sub_index --
# truncation to _PRECISION is what closes the gaps, and omitting it is what made
# a PM10 reading of 54.5 µg/m³ report as AQI 500.
_BP_EPA: dict[str, list[tuple]] = {
    "pm25": [(0,12.0,0,50),(12.1,35.4,51,100),(35.5,55.4,101,150),
             (55.5,150.4,151,200),(150.5,250.4,201,300),(250.5,350.4,301,400),(350.5,500.4,401,500)],
    "pm10": [(0,54,0,50),(55,154,51,100),(155,254,101,150),
             (255,354,151,200),(355,424,201,300),(425,504,301,400),(505,604,401,500)],
    "o3":   [(0,107,0,50),(108,140,51,100),(141,170,101,150),
             (171,210,151,200),(211,748,201,300),(749,1000,301,500)],
    "no2":  [(0,53,0,50),(54,100,51,100),(101,360,101,150),
             (361,649,151,200),(650,1249,201,300),(1250,2049,301,400),(2050,3000,401,500)],
    "so2":  [(0,35,0,50),(36,75,51,100),(76,185,101,150),
             (186,304,151,200),(305,604,201,300),(605,1004,301,400),(1005,1500,401,500)],
    "co":   [(0,4.4,0,50),(4.5,9.4,51,100),(9.5,12.4,101,150),
             (12.5,15.4,151,200),(15.5,30.4,201,300),(30.5,40.4,301,400),(40.5,50.4,401,500)],
}

# ── Category bands ────────────────────────────────────────────────────────────

AQI_CATEGORIES = [
    (0,   50,  "Good",         "#009966"),
    (51,  100, "Satisfactory", "#ffde33"),
    (101, 200, "Moderate",     "#ff9933"),
    (201, 300, "Poor",         "#cc0033"),
    (301, 400, "Very Poor",    "#660099"),
    (401, 500, "Severe",       "#7e0023"),
]

# US EPA category bands. These are NOT the CPCB bands: the boundaries differ
# (EPA breaks at 150, CPCB at 200) and so do the names. Applying CPCB labels to
# an EPA-scale number mislabels the whole 101-200 range -- an EPA AQI of 150 is
# "Unhealthy for Sensitive Groups", not CPCB's "Moderate". Since `nowcast` mode
# computes sub-indices from `_BP_EPA`, it must be labelled with this table.
AQI_CATEGORIES_EPA = [
    (0,   50,  "Good",                           "#009966"),
    (51,  100, "Moderate",                       "#ffde33"),
    (101, 150, "Unhealthy for Sensitive Groups", "#ff9933"),
    (151, 200, "Unhealthy",                      "#cc0033"),
    (201, 300, "Very Unhealthy",                 "#660099"),
    (301, 500, "Hazardous",                      "#7e0023"),
]

# EPA reporting precision: concentration must be truncated to this many decimals
# before breakpoint lookup, otherwise readings land in the gaps between segments.
_PRECISION: dict[str, int] = {
    "pm25": 1, "pm10": 0, "o3": 0, "no2": 0, "so2": 0, "co": 1,
}


def _cat(aqi: int, mode: str = "instant") -> tuple[str, str]:
    """
    AQI value -> (category label, hex colour).

    `mode` MUST match the breakpoint table the value came from: "instant" uses
    CPCB 2014, "nowcast" uses US EPA 2012. Defaulting to CPCB keeps the existing
    call signature working for instant-mode callers.
    """
    table = AQI_CATEGORIES_EPA if mode == "nowcast" else AQI_CATEGORIES
    for lo, hi, label, color in table:
        if lo <= aqi <= hi:
            return label, color
    return table[-1][2], table[-1][3]


def _truncate(value: float, decimals: int) -> float:
    """Truncate (never round up) to a fixed number of decimals, per EPA method."""
    factor = 10 ** decimals
    return math.floor(value * factor) / factor


def _normalise_param(param: str) -> str:
    """OpenAQ reports PM2.5 as 'pm25' or 'pm2.5' depending on endpoint."""
    p = param.lower().strip()
    return "pm25" if p in ("pm2.5", "pm2_5") else p


def _sub_index(param: str, conc: float, mode: str = "instant") -> int:
    """
    Concentration -> AQI sub-index by linear interpolation within a breakpoint
    segment. Uses EPA breakpoints for nowcast mode, CPCB for instant mode.

    Returns 0 for unknown/negative input. Only returns 500 when the reading is
    genuinely at or above the top of the scale -- never as a fall-through for a
    value that failed to match a segment.
    """
    p = _normalise_param(param)
    bps = (_BP_EPA if mode == "nowcast" else _BP).get(p)
    if not bps or conc is None:
        return 0
    try:
        c = float(conc)
    except (TypeError, ValueError):
        return 0
    if c < 0 or math.isnan(c) or math.isinf(c):
        return 0

    # EPA requires truncation to reporting precision before lookup.
    if mode == "nowcast":
        c = _truncate(c, _PRECISION.get(p, 0))

    if c <= bps[0][0]:
        return bps[0][2]
    if c >= bps[-1][1]:
        return bps[-1][3]          # genuinely off the top of the scale

    for lo, hi, ilo, ihi in bps:
        if lo <= c <= hi:
            if hi == lo:
                return ihi
            return round(ilo + (ihi - ilo) * (c - lo) / (hi - lo))

    # Safety net: value fell in a gap between published segments (should be
    # unreachable after truncation). Snap UP to the next segment's floor rather
    # than defaulting to 500 -- the old behaviour reported clean air as Severe.
    for lo, _hi, ilo, _ihi in bps:
        if c < lo:
            return ilo
    return bps[-1][3]


def _conc_to_aqi(
    concentrations: dict[str, float], mode: str = "instant"
) -> tuple[int, str]:
    """
    Returns (AQI, dominant_pollutant) from a dict of concentration readings.
    Uses CPCB breakpoints for instant mode, EPA breakpoints for nowcast mode.
    """
    sub_indices = {}
    for param, conc in concentrations.items():
        if conc is not None and conc >= 0:
            si = _sub_index(param, conc, mode)
            if si > 0:
                sub_indices[_normalise_param(param)] = si
    if not sub_indices:
        return 0, "unknown"
    dominant = max(sub_indices, key=sub_indices.get)
    return min(max(sub_indices.values()), 500), dominant
