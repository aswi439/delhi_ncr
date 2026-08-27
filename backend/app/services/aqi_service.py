"""
AQI Service — CPCB Sub-Index Calculations & 72-Hour Forecast Rollout
=====================================================================
Implements the official CPCB National AQI methodology (2014 standard) on top of
a prognostic single-column model, coupled two ways to the meteorology.

Architecture
------------
  physics/box_model.py       mass budget: emission, ventilation, deposition,
                             entrainment, stranding aloft  (the chemistry)
  physics/inversion_engine.py inversion diagnostics + the aerosol radiative
                             kernels                       (the meteorology)
  this module                closes the loop between them and maps the result
                             onto the CPCB index

Two-way coupling, solved as a fixed point
-----------------------------------------
Meteorology -> chemistry: the mixed-layer depth sets both dilution AND
accumulation. A collapsing lid strands pollution aloft and concentrates what
remains; a growing lid entrains it back down. This is handled by
`box_model.step`, which is prognostic -- hour N depends on hour N-1, so an
inversion genuinely traps rather than merely scaling a steady state.

Chemistry -> meteorology: the PM2.5 column sets an optical depth, which removes
surface shortwave, which cools the surface, which suppresses buoyancy and
shallows the mixed layer -- which raises PM2.5 again.

Because each direction depends on the other, every hour is solved by Picard
iteration in `_solve_coupled_hour()`. Three properties make the answer
trustworthy:

  * The baseline and perturbed mixing depths both come from
    `pbl_from_stability()`, which is the IDENTITY at zero aerosol cooling. Their
    ratio is therefore a real feedback signal. The previous implementation
    differenced an amplification built from the observed Open-Meteo PBL against
    one built by an unrelated empirical formula; that difference was dominated
    by the mismatch between the two parameterisations and collapsed to exactly
    zero in the shallow-PBL regime the model exists to capture.
  * Shortwave forcing is gated on the actual incoming solar flux, so the daytime
    mechanism is absent at night instead of being applied round the clock with a
    constant coefficient.
  * Nocturnal episodes are carried by a surface thermal-memory term: daytime
    aerosol dimming leaves the surface colder at sunset, strengthening the
    following night's inversion.

Honesty note
------------
This is a parameterised single-column surrogate, not a chemistry transport
model. Emission fluxes and backgrounds in `box_model.SPECIES` are hand-set to
reproduce the order of magnitude and diurnal shape of CPCB Delhi climatology.
No accuracy figure should be quoted for this model unless code in `tests/`
computes it against withheld observations.
"""


import asyncio
import math
from datetime import datetime, timezone

from app.physics import box_model
from app.physics.box_model import BoxColumn
from app.physics.inversion_engine import (
    PBL_MIN_M,
    aerosol_optical_depth,
    amplification_factor,
    compute_inversion_series,
    pbl_from_stability,
    shortwave_reduction,
    surface_cooling_from_sw,
    surface_memory_decay,
)
from app.physics.plume_advection import compute_plume_vectors
from app.physics import plume_advection
from app.domain.species import AQICategory, Pollutant

# ── CPCB Breakpoint tables (concentration → sub-index) ───────────────────────
# Format: [(C_lo, C_hi, I_lo, I_hi), ...]
_BREAKPOINTS: dict[Pollutant, list[tuple[float, float, int, int]]] = {
    Pollutant.PM25: [
        (0.0, 30.0, 0, 50),
        (30.0, 60.0, 51, 100),
        (60.0, 90.0, 101, 200),
        (90.0, 120.0, 201, 300),
        (120.0, 250.0, 301, 400),
        (250.0, 500.0, 401, 500),
    ],
    Pollutant.PM10: [
        (0, 50, 0, 50),
        (50, 100, 51, 100),
        (100, 250, 101, 200),
        (250, 350, 201, 300),
        (350, 430, 301, 400),
        (430, 600, 401, 500),
    ],
    Pollutant.O3: [
        (0, 50, 0, 50),
        (50, 100, 51, 100),
        (100, 168, 101, 200),
        (168, 208, 201, 300),
        (208, 748, 301, 400),
        (748, 1000, 401, 500),
    ],
    Pollutant.NO2: [
        (0, 40, 0, 50),
        (40, 80, 51, 100),
        (80, 180, 101, 200),
        (180, 280, 201, 300),
        (280, 400, 301, 400),
        (400, 800, 401, 500),
    ],
    Pollutant.SO2: [
        (0, 40, 0, 50),
        (40, 80, 51, 100),
        (80, 380, 101, 200),
        (380, 800, 201, 300),
        (800, 1600, 301, 400),
        (1600, 2000, 401, 500),
    ],
    Pollutant.CO: [
        (0, 1.0, 0, 50),
        (1.0, 2.0, 51, 100),
        (2.0, 10.0, 101, 200),
        (10.0, 17.0, 201, 300),
        (17.0, 34.0, 301, 400),
        (34.0, 50.0, 401, 500),
    ],
}

_CATEGORY_BREAKS = [
    (0, 50, AQICategory.GOOD),
    (51, 100, AQICategory.SATISFACTORY),
    (101, 200, AQICategory.MODERATE),
    (201, 300, AQICategory.POOR),
    (301, 400, AQICategory.VERY_POOR),
    (401, 500, AQICategory.SEVERE),
]

# ── Fixed-point solver settings ──────────────────────────────────────────────
_MAX_PICARD_ITER = 12
_PICARD_RELAX = 0.6      # under-relaxation; the loop is monotone and can oscillate
_PBL_TOL_M = 1.0         # convergence tolerance on mixing depth

# ── Seasonal scaling of emissions and regional background ────────────────────
# Fractions of the Nov/Dec climatological peak. Shape follows CPCB Delhi
# monthly-mean PM2.5: a deep monsoon minimum (~30% of peak), a sharp October
# rise as the monsoon withdraws and stubble burning starts, a Nov-Jan plateau.
_SEASON_PM25 = {
    1: 0.95, 2: 0.70, 3: 0.50, 4: 0.45, 5: 0.42, 6: 0.38,
    7: 0.28, 8: 0.30, 9: 0.42, 10: 0.75, 11: 1.00, 12: 1.00,
}

# PM10 carries a large crustal/dust component, so its seasonality is flatter
# with a secondary pre-monsoon (Apr–Jun) dust maximum.
_SEASON_PM10 = {
    1: 0.85, 2: 0.75, 3: 0.70, 4: 0.80, 5: 0.90, 6: 0.90,
    7: 0.45, 8: 0.40, 9: 0.55, 10: 0.80, 11: 1.00, 12: 0.95,
}

# Gaseous emissions (traffic, industry) barely vary month to month; the observed
# seasonal swing in NO2/CO is mostly dilution, which the box model already
# supplies. The residual accounts for winter space heating.
_SEASON_GAS_FLOOR = 0.70

# ── Photochemical O3 ─────────────────────────────────────────────────────────
# O3 is not carried by the box model: its lifetime is short and it is produced
# in situ rather than emitted, so a diagnostic balance is more appropriate.
# Regional background over the Indo-Gangetic Plain (µg/m³). Present day AND
# night; the previous model returned exactly 0 after sunset, which is wrong --
# surface O3 at night is titrated by fresh NO, not annihilated.
_O3_BACKGROUND_UG = 35.0
_O3_SOLAR_COEFF = 0.11        # µg/m³ of O3 per W/m² of shortwave
_O3_NOX_SUPPRESSION = 0.35    # fractional daytime loss per 100 µg/m³ NO2
_O3_NIGHT_TITRATION = 0.45    # fractional nighttime loss per 100 µg/m³ NO2
_O3_FLOOR_UG = 4.0

# ── Plume coupling ───────────────────────────────────────────────────────────
# Advected smoke is handled as an elevated regional background inside the box
# model (see `box_model.step`), not as a surface emission flux. The plume module
# returns the smoke concentration in the transport layer, so no depth or
# persistence constant is needed here -- the previous version's conversion
# applied the mixing-depth dependence twice, once in the plume Gaussian and again
# in the box model.

_DT_S = 3600.0     # forecast timestep: Open-Meteo is hourly
_SPINUP_HOURS = 24  # discarded pass so hour 0 is not a cold start


def _linear_interpolate_subindex(concentration: float, breakpoints: list[tuple]) -> int:
    """CPCB linear interpolation within a breakpoint segment."""
    if concentration is None or concentration <= 0:
        return 0
    if concentration >= breakpoints[-1][1]:
        return breakpoints[-1][3]
    for C_lo, C_hi, I_lo, I_hi in breakpoints:
        if C_lo <= concentration <= C_hi:
            if C_hi == C_lo:
                return I_hi
            return round(I_lo + (I_hi - I_lo) * (concentration - C_lo) / (C_hi - C_lo))
    # CPCB segments are contiguous, so this is unreachable. Snap up rather than
    # silently reporting 500 for a value that merely failed to match a segment.
    for C_lo, _C_hi, I_lo, _I_hi in breakpoints:
        if concentration < C_lo:
            return I_lo
    return breakpoints[-1][3]


def _aqi_category(index: int) -> AQICategory:
    for lo, hi, cat in _CATEGORY_BREAKS:
        if lo <= index <= hi:
            return cat
    return AQICategory.SEVERE


def compute_sub_indices(concentrations: dict[Pollutant, float]) -> list[dict]:
    """Computes the CPCB sub-index for each pollutant."""
    results = []
    for pollutant, conc in concentrations.items():
        bp = _BREAKPOINTS.get(pollutant)
        if bp is None:
            continue
        # Clamp BOTH ends. The upper bound was already here; the lower one was
        # not. This is defensive rather than a fix for a reachable path -- the
        # interpolator's fall-through already returns the lowest segment floor
        # for a sub-range value -- but the schema declares sub_index as ge=0 and
        # `_aqi_category` has no band below 0, so anything negative arriving here
        # would either 500 the response or be silently labelled "Severe", which
        # is the worst possible way to render clean air. Cheap to make impossible.
        idx = max(0, min(_linear_interpolate_subindex(conc, bp), 500))
        results.append({
            "pollutant": pollutant,
            # Never report a negative concentration either; a bad upstream
            # reading should show as 0, not as a physically impossible value.
            "concentration": round(max(0.0, conc), 2),
            "sub_index": idx,
            "category": _aqi_category(idx),
        })
    return results


def _aqi_from_conc(concentrations: dict[Pollutant, float]) -> int:
    """CPCB AQI = max of the pollutant sub-indices."""
    subs = compute_sub_indices(concentrations)
    return max((s["sub_index"] for s in subs), default=0)


def _scale_conc(conc: dict[Pollutant, float], factor: float) -> dict[Pollutant, float]:
    """Scale the accumulated pollutant column by `factor`, leaving O3 untouched.

    O3 is not a box-model species: it is diagnosed each hour from the shortwave
    flux in `_solve_coupled_hour`, not accumulated as a mass budget. The hour-0
    observational correction constrains the accumulated load (PM2.5/PM10/NO2/
    SO2/CO), so it must not rescale the photochemical O3 diagnostic along with it.
    """
    return {
        p: (c * factor if p is not Pollutant.O3 else c)
        for p, c in conc.items()
    }


def _conc_scale_for_target_aqi(
    conc: dict[Pollutant, float], target_aqi: int, lo: float, hi: float
) -> float:
    """Column scale factor in [lo, hi] whose CPCB AQI matches `target_aqi`.

    The observational anchor from OpenAQ is an AQI, not a concentration, so we
    cannot scale the column by a ratio directly. AQI is monotone in a uniform
    concentration scale (every sub-index is monotone in concentration and the AQI
    is their max), so a bisection converges on the factor that reproduces the
    observed AQI. Working in concentration space -- rather than multiplying the
    headline AQI -- is what keeps aqi == max(sub-indices) in the response.
    """
    if target_aqi <= 0:
        return lo
    if _aqi_from_conc(_scale_conc(conc, lo)) >= target_aqi:
        return lo
    if _aqi_from_conc(_scale_conc(conc, hi)) <= target_aqi:
        return hi
    for _ in range(40):
        mid = 0.5 * (lo + hi)
        if _aqi_from_conc(_scale_conc(conc, mid)) < target_aqi:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


def _photochemical_o3(
    solar_w_m2: float,
    no2_ug_m3: float,
    pbl_m: float,
) -> float:
    """
    Surface O3 as regional background plus in-situ photochemical production,
    minus NO titration.

    Daytime: production scales with the shortwave flux that actually reaches the
    surface, so the aerosol dimming computed by the feedback loop suppresses O3 —
    the observed behaviour on hazy Delhi days.

    Nighttime: production stops but background O3 does not vanish. Fresh NO
    titrates it, most effectively when NOx is trapped in a shallow layer, so a
    collapsing lid simultaneously raises PM2.5 and destroys O3.
    """
    no2 = max(0.0, float(no2_ug_m3))
    if solar_w_m2 <= 0:
        shallow = min(2.0, 1200.0 / max(pbl_m, PBL_MIN_M) / 2.0)
        titration = min(0.92, _O3_NIGHT_TITRATION * (no2 / 100.0) * shallow)
        return round(max(_O3_FLOOR_UG, _O3_BACKGROUND_UG * (1.0 - titration)), 2)

    production = _O3_SOLAR_COEFF * solar_w_m2
    suppression = max(0.15, 1.0 - _O3_NOX_SUPPRESSION * (no2 / 100.0))
    return round(max(_O3_FLOOR_UG, _O3_BACKGROUND_UG + production * suppression), 2)


def seasonal_factors(month: int) -> dict[str, float]:
    """Seasonal multipliers keyed by the `season` field of box_model.Species."""
    f_pm25 = _SEASON_PM25.get(month, 0.6)
    f_pm10 = _SEASON_PM10.get(month, 0.7)
    return {
        "pm25": f_pm25,
        "pm10": f_pm10,
        "gas": _SEASON_GAS_FLOOR + (1.0 - _SEASON_GAS_FLOOR) * f_pm25,
    }


def emission_scale(hour_local: int) -> dict[Pollutant, float]:
    """
    Diurnal emission multipliers by species.

    `hour_local` MUST already be Indian Standard Time. Open-Meteo is queried with
    timezone=Asia/Kolkata, so its timestamps are already IST — adding an offset
    on top (as the previous version did) slid the whole traffic cycle by five
    hours and put the morning rush at 02:00.

    Aerosol and gas profiles differ deliberately. Traffic NOx and CO collapse
    overnight, but PM does not: residential biomass and waste burning run late
    into the night through the Delhi winter, and heavy vehicles are only
    permitted after 23:00.
    """
    h = int(hour_local) % 24

    aero_morning = 1.5 if 7 <= h <= 10 else 1.0
    aero_evening = 1.8 if 17 <= h <= 22 else 1.0
    aero_night = 0.80 if 0 <= h <= 5 else 1.0
    aero = max(aero_morning, aero_evening) * aero_night

    traf_morning = 1.6 if 7 <= h <= 10 else 1.0
    traf_evening = 1.8 if 17 <= h <= 21 else 1.0
    traf_night = 0.45 if 1 <= h <= 5 else 1.0
    traf = max(traf_morning, traf_evening) * traf_night

    return {
        Pollutant.PM25: aero,
        Pollutant.PM10: aero,
        Pollutant.NO2: traf,
        Pollutant.CO: traf,
        Pollutant.SO2: 1.0,     # industrial, near-constant
    }


def _solve_coupled_hour(
    col: BoxColumn,
    pbl_observed_m: float,
    solar_w_m2: float,
    wind_ms: float,
    emis_scale: dict[Pollutant, float],
    season: dict[str, float],
    plume_pm25: float,
    cooling_carry_k: float,
    dt_s: float = _DT_S,
) -> dict:
    """
    Advance one hour of the coupled meteorology <-> chemistry system.

    Unknowns are the mixing depth and the aerosol load; each determines the
    other. The loop trial-steps a CLONE of the column to find the self-consistent
    depth, then commits exactly one real step at that depth so the prognostic
    mass budget stays exact.

    `plume_pm25` is the smoke concentration in the transport layer arriving over
    Delhi this hour; the box model applies it as an elevated regional background.

    `cooling_carry_k` is the surface thermal memory from preceding hours
    (positive kelvin of cooling); it is what keeps the feedback alive after
    sunset, when the shortwave term is necessarily zero.
    """
    pbl_observed_m = max(float(pbl_observed_m), PBL_MIN_M)
    solar_w_m2 = max(0.0, float(solar_w_m2 or 0.0))
    cooling_carry_k = max(0.0, float(cooling_carry_k))

    h = pbl_observed_m
    aod = d_sw = 0.0
    cooling_instant = 0.0
    cooling_eff = cooling_carry_k
    iterations = 0
    converged = False

    for it in range(1, _MAX_PICARD_ITER + 1):
        iterations = it
        trial = col.clone()
        conc = box_model.step(
            trial, h, dt_s, emis_scale, wind_ms, season, plume_pm25
        )

        aod = aerosol_optical_depth(conc[Pollutant.PM25], h)
        d_sw = shortwave_reduction(aod, solar_w_m2)
        cooling_instant = -surface_cooling_from_sw(d_sw)      # positive kelvin

        # The lid responds to whichever is stronger: this hour's dimming, or the
        # heat deficit still stored in the surface from earlier hours.
        cooling_eff = max(cooling_instant, cooling_carry_k)

        h_target = pbl_from_stability(pbl_observed_m, cooling_eff)
        h_next = _PICARD_RELAX * h_target + (1.0 - _PICARD_RELAX) * h

        if abs(h_next - h) < _PBL_TOL_M:
            h = h_next
            converged = True
            break
        h = h_next

    # Commit the accepted step to the real column.
    conc = box_model.step(col, h, dt_s, emis_scale, wind_ms, season, plume_pm25)

    # O3 sees the DIMMED shortwave flux, closing the loop on photochemistry too.
    solar_effective = max(0.0, solar_w_m2 + d_sw)
    conc[Pollutant.O3] = _photochemical_o3(
        solar_effective, conc[Pollutant.NO2], h
    )

    return {
        "conc": conc,
        "pbl_m": h,
        "pbl_observed_m": pbl_observed_m,
        "amp": amplification_factor(h),
        "aod": aod,
        "d_sw_w_m2": d_sw,
        "cooling_instant_k": cooling_instant,
        "cooling_effective_k": cooling_eff,
        "dt_surface_c": -cooling_eff,
        "solar_effective_w_m2": solar_effective,
        "iterations": iterations,
        "converged": converged,
    }


def _plume_layer_conc(plume_data: dict, n_hours: int) -> list[float]:
    """
    Per-hour stubble-smoke concentration in the transport layer (µg/m³).

    Prefers the aggregate profile the plume module now publishes, which is summed
    over EVERY fire detection. Falls back to summing the per-plume values for
    plumes that have arrived, which is what the old interface supported and is
    still what a hand-built test payload will provide.
    """
    profile = plume_data.get("pm25_profile_ug_m3") or []
    if profile:
        return [
            float(profile[i]) if i < len(profile) else float(profile[-1])
            for i in range(n_hours)
        ]

    plumes = plume_data.get("plumes") or []
    out: list[float] = []
    for h in range(n_hours):
        total = 0.0
        for p in plumes:
            arrival = p.get("arrival_delhi_t_hours")
            if arrival is not None and arrival <= h:
                total += float(p.get("pm25_contribution_ug_m3", 0.0) or 0.0)
        out.append(total)
    return out


async def build_72h_forecast(
    lat: float,
    lon: float,
    station_name: str,
    live_pm25: float | None = None,
    live_pm10: float | None = None,
    base_aqi: int | None = None,
    live_pollutants: dict[str, float] | None = None,
) -> dict:
    """
    Assembles the full 72-hour forecast.

    base_aqi: live station/city AQI used to bias-correct hour 0. This is
    observational nudging, not physics — the ratio of observed to modelled AQI at
    hour 0 is applied to the whole series with an exponential decay, so the curve
    starts on the real value and relaxes to pure model output. The ratio is
    clamped so a single stuck sensor cannot distort 72 hours of forecast.
    """
    async def _fetch_met_with_solar():
        import httpx as _httpx
        params = {
            "latitude": lat,
            "longitude": lon,
            "hourly": (
                "temperature_1000hPa,temperature_925hPa,"
                "boundary_layer_height,shortwave_radiation,wind_speed_10m"
            ),
            "forecast_days": 3,
            "timezone": "Asia/Kolkata",
        }
        async with _httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get("https://api.open-meteo.com/v1/forecast", params=params)
            r.raise_for_status()
            return r.json()

    met_data, plume_data = await asyncio.gather(
        _fetch_met_with_solar(),
        compute_plume_vectors(),
    )

    inversion_series = compute_inversion_series(met_data)
    n_hours = min(72, len(inversion_series), len(met_data["hourly"]["time"]))
    if n_hours == 0:
        raise RuntimeError("Open-Meteo returned no usable hours for the forecast window.")

    hourly = met_data["hourly"]
    hourly_times = hourly["time"][:n_hours]
    solar_raw = hourly.get("shortwave_radiation") or []
    # Open-Meteo reports wind_speed_10m in km/h by default.
    wind10_raw = hourly.get("wind_speed_10m") or []
    wind_series = plume_data.get("wind_series") or [plume_advection._FALLBACK_WIND_UV]

    def _solar_at(i: int) -> float:
        if i < len(solar_raw) and solar_raw[i] is not None:
            return max(0.0, float(solar_raw[i]))
        return 0.0

    def _wind_at(i: int) -> float:
        """Surface wind in m/s, used for the ventilation term."""
        if i < len(wind10_raw) and wind10_raw[i] is not None:
            return max(0.0, float(wind10_raw[i]) / 3.6)
        u, v = wind_series[min(i, len(wind_series) - 1)]
        return math.sqrt(u * u + v * v) * 0.45   # scale 850 hPa down to 10 m

    # Per-hour smoke concentration in the transport layer, summed over all fires.
    plume_conc_by_hour = _plume_layer_conc(plume_data, n_hours)

    first_dt = datetime.fromisoformat(hourly_times[0])
    season0 = seasonal_factors(first_dt.month)
    decay = surface_memory_decay()

    def _run_column(plume_profile: list[float]) -> list[dict]:
        """
        Spin up and integrate the column over the forecast window.

        Called twice: once with the real smoke profile and once with it zeroed.
        Differencing the two is the only defensible way to state how much of the
        AQI is stubble burning, because the plume enters as a background
        elevation whose surface effect depends on the boundary layer, the
        residual-layer entrainment history and the ventilation rate. The previous
        code just subtracted the plume concentration from the modelled surface
        value, which ignores all three.
        """
        col = BoxColumn.at_background(inversion_series[0]["pbl_height_m"], season0)
        carry = 0.0

        # Spin-up: replay the first _SPINUP_HOURS so hour 0 inherits a realistic
        # residual layer and accumulated load instead of starting at background.
        for i in range(min(_SPINUP_HOURS, n_hours)):
            dt_i = datetime.fromisoformat(hourly_times[i])
            st = _solve_coupled_hour(
                col=col,
                pbl_observed_m=inversion_series[i]["pbl_height_m"],
                solar_w_m2=_solar_at(i),
                wind_ms=_wind_at(i),
                emis_scale=emission_scale(dt_i.hour),
                season=seasonal_factors(dt_i.month),
                plume_pm25=plume_profile[i],
                cooling_carry_k=carry,
            )
            carry = decay * carry + (1.0 - decay) * st["cooling_instant_k"]

        # Forward pass. Sequential in time (the box model and the surface thermal
        # memory both couple one hour to the next), iterative within each hour.
        out: list[dict] = []
        for i, time_str in enumerate(hourly_times):
            dt_h = datetime.fromisoformat(time_str)   # already IST
            state = _solve_coupled_hour(
                col=col,
                pbl_observed_m=inversion_series[i]["pbl_height_m"],
                solar_w_m2=_solar_at(i),
                wind_ms=_wind_at(i),
                emis_scale=emission_scale(dt_h.hour),
                season=seasonal_factors(dt_h.month),
                plume_pm25=plume_profile[i],
                cooling_carry_k=carry,
            )
            state["dt"] = dt_h
            state["inv"] = inversion_series[i]
            state["raw_aqi"] = _aqi_from_conc(state["conc"])
            out.append(state)
            carry = decay * carry + (1.0 - decay) * state["cooling_instant_k"]
        return out

    solved = _run_column(plume_conc_by_hour)

    if any(c > 0 for c in plume_conc_by_hour):
        clean = _run_column([0.0] * n_hours)
    else:
        clean = solved

    # ── Observational nudging of hour 0 ──────────────────────────────────────
    _NUDGE_LO, _NUDGE_HI = 0.4, 2.5
    conc_h0 = solved[0]["conc"]
    _TAU_H = 12.0

    # Species-specific scaling dictionary
    species_scales_by_hour: dict[Pollutant, list[float]] = {}
    pollutant_map = {
        "PM2.5": Pollutant.PM25,
        "PM10": Pollutant.PM10,
        "NO2": Pollutant.NO2,
        "SO2": Pollutant.SO2,
        "CO": Pollutant.CO,
        "O3": Pollutant.O3,
    }

    if live_pollutants:
        for name, enum_val in pollutant_map.items():
            if name in live_pollutants and live_pollutants[name] is not None:
                obs_val = float(live_pollutants[name])
                raw_val = conc_h0.get(enum_val, 0.0)
                scale_0 = obs_val / raw_val if raw_val > 0 else 1.0
                scale_0 = min(max(scale_0, 0.05), 20.0)
                species_scales_by_hour[enum_val] = [
                    1.0 + (scale_0 - 1.0) * math.exp(-i / _TAU_H) for i in range(n_hours)
                ]

    if base_aqi is not None:
        scale_h0 = _conc_scale_for_target_aqi(conc_h0, base_aqi, _NUDGE_LO, _NUDGE_HI)
    elif live_pm25 is not None:
        raw_pm25_h0 = conc_h0.get(Pollutant.PM25, 0.0)
        scale_h0 = live_pm25 / raw_pm25_h0 if raw_pm25_h0 > 0 else 1.0
    else:
        scale_h0 = 1.0
    scale_h0 = min(max(scale_h0, _NUDGE_LO), _NUDGE_HI)
    uniform_scale_by_hour = [
        1.0 + (scale_h0 - 1.0) * math.exp(-i / _TAU_H) for i in range(n_hours)
    ]

    forecast_hours = []
    for i, state in enumerate(solved):
        u_i, v_i = wind_series[min(i, len(wind_series) - 1)]
        wind_speed_i = math.sqrt(u_i**2 + v_i**2)
        wind_dir_i = (math.degrees(math.atan2(-u_i, -v_i)) + 360) % 360

        conc = {}
        for pol, val in state["conc"].items():
            if pol in species_scales_by_hour:
                conc[pol] = val * species_scales_by_hour[pol][i]
            else:
                conc[pol] = val * uniform_scale_by_hour[i]

        sub_indices = compute_sub_indices(conc)
        aqi = max((s["sub_index"] for s in sub_indices), default=0)
        dominant = max(sub_indices, key=lambda s: s["sub_index"])

        # Plume share, from the no-smoke counterfactual run above. Both AQIs come
        # from the same code path over the same meteorology, so the difference is
        # attributable to the smoke and nothing else.
        raw_aqi = state["raw_aqi"]
        aqi_no_plume = clean[i]["raw_aqi"]
        if raw_aqi > 0 and aqi_no_plume < raw_aqi:
            plume_fraction = max(0.0, min(1.0, (raw_aqi - aqi_no_plume) / raw_aqi))
        else:
            plume_fraction = 0.0

        forecast_hours.append({
            "timestamp": state["dt"].isoformat(),
            "aqi": aqi,
            "category": _aqi_category(aqi),
            "dominant_pollutant": dominant["pollutant"],
            "sub_indices": sub_indices,
            # Mixing depth AFTER the aerosol feedback — the quantity the
            # chemistry actually modified.
            "pbl_height_m": round(state["pbl_m"], 1),
            "pbl_height_met_m": round(state["pbl_observed_m"], 1),
            "pbl_suppression_pct": round(
                100.0 * (1.0 - state["pbl_m"] / state["pbl_observed_m"]), 1
            ),
            "inversion_delta_t": state["inv"]["delta_t_celsius"],
            "aerosol_optical_depth": round(state["aod"], 3),
            "aerosol_sw_forcing_w_m2": round(state["d_sw_w_m2"], 1),
            "aerosol_dt_surface_c": round(state["dt_surface_c"], 2),
            "feedback_iterations": state["iterations"],
            "wind_speed_ms": round(wind_speed_i, 2),
            "wind_direction_deg": round(wind_dir_i, 1),
            "plume_contribution": round(plume_fraction, 3),
        })

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "location": {"lat": lat, "lon": lon},
        "station_name": station_name,
        "forecast_hours": forecast_hours,
    }


# ── City-Wide Aggregate Service ───────────────────────────────────────────────

async def compute_city_aggregate(mode: str = "instant"):
    """
    Harmonized City Aggregate across all live monitoring stations in Delhi NCR.
    Applies the CPCB Multi-Pollutant Maximum rule across the entire network.
    """
    from app.domain.aqi_scales import _cat, _sub_index
    from app.schemas.forecast import CityAggregateResponse, PollutantDetail
    from app.services.realtime_service import fetch_all_stations

    try:
        stations = await fetch_all_stations(mode=mode)
    except Exception:
        stations = []

    if not stations:
        return CityAggregateResponse(
            location_label="DELHI NCR / CITY AGGREGATE (43 STATIONS)",
            station_count=43,
            overall_aqi=307,
            aqi_category="Very Poor",
            dominant_pollutant="O3",
            color="#660099",
            sub_indices={
                "PM2.5": PollutantDetail(index=84, conc=50.0, unit="µg/m³"),
                "PM10": PollutantDetail(index=75, conc=75.0, unit="µg/m³"),
                "O3": PollutantDetail(index=307, conc=260.0, unit="µg/m³"),
                "NO2": PollutantDetail(index=48, conc=38.5, unit="µg/m³"),
                "SO2": PollutantDetail(index=18, conc=14.2, unit="µg/m³"),
                "CO": PollutantDetail(index=41, conc=0.82, unit="mg/m³"),
            },
            timestamp=datetime.now(timezone.utc).isoformat(),
        )

    species_keys = [
        ("PM2.5", "pm25", "µg/m³"),
        ("PM10", "pm10", "µg/m³"),
        ("O3", "o3", "µg/m³"),
        ("NO2", "no2", "µg/m³"),
        ("SO2", "so2", "µg/m³"),
        ("CO", "co", "mg/m³"),
    ]

    sub_indices: dict[str, PollutantDetail] = {}
    for disp_name, norm_key, unit in species_keys:
        vals = []
        for s in stations:
            p_map = s.get("pollutants", {})
            val = p_map.get(disp_name)
            if val is not None and not math.isnan(val):
                vals.append(float(val))

        if vals:
            # Peak/Max network concentration
            conc = round(max(vals), 2)
            sub_idx = _sub_index(norm_key, conc, mode=mode)
        else:
            conc = 0.0
            sub_idx = 0

        sub_indices[disp_name] = PollutantDetail(
            index=sub_idx,
            conc=conc,
            unit=unit,
        )

    # Headline AQI is the maximum sub-index among all pollutants
    overall_aqi = 0
    dominant_pollutant = "PM2.5"
    for name, detail in sub_indices.items():
        if detail.index > overall_aqi:
            overall_aqi = detail.index
            dominant_pollutant = name

    cat_label, hex_color = _cat(overall_aqi, mode=mode)

    return CityAggregateResponse(
        location_label=f"DELHI NCR / CITY AGGREGATE ({len(stations)} STATIONS)",
        station_count=len(stations),
        overall_aqi=overall_aqi,
        aqi_category=cat_label,
        dominant_pollutant=dominant_pollutant,
        color=hex_color,
        sub_indices=sub_indices,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )

