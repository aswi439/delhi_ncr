"""
Pydantic schemas for all request/response models.
Strict validation — no extra fields accepted on input.
"""

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, Field, model_validator

# Re-exported for backwards compatibility: `AQICategory` and `Pollutant` now live
# in app.domain.species so the physics core does not have to import pydantic and
# the whole response layer just to name a species.
from app.domain.species import AQICategory, Pollutant

__all__ = [
    "AQICategory",
    "Pollutant",
    "DelhiBBox",
    "PollutantSubIndex",
    # The hourly model is HourlyForecast, not ForecastHour. An earlier version of
    # this list said "ForecastHour", which does not exist -- `import *` would have
    # raised AttributeError at import time. Nothing star-imports this module today,
    # so it was latent; kept correct now so it stays that way.
    "HourlyForecast",
    "ForecastResponse",
    "InversionStatus",
    "FireHotspot",
    "PlumeVector",
    "PlumeVectorsResponse",
    "StationObservation",
]


# ── Coordinate bounding box ───────────────────────────────────────────────────

class DelhiBBox(BaseModel):
    """Validated lat/lon bounding box restricted to Delhi NCR region."""
    model_config = {"extra": "forbid"}

    lat: Annotated[float, Field(ge=28.0, le=29.0, description="Latitude (Delhi NCR: 28.0–29.0°N)")]
    lon: Annotated[float, Field(ge=76.5, le=77.8, description="Longitude (Delhi NCR: 76.5–77.8°E)")]

    @model_validator(mode="after")
    def check_inside_ncr(self) -> "DelhiBBox":
        # Rough polygon check — NCR spans 28.4–28.9°N, 76.8–77.5°E at core
        # We allow the wider bbox above; this catches obvious misuse
        if self.lat < 27.5 or self.lat > 30.0:
            raise ValueError("Latitude out of plausible NCR range")
        return self


# ── Sub-index per pollutant ───────────────────────────────────────────────────

class PollutantSubIndex(BaseModel):
    pollutant: Pollutant
    concentration: float  # µg/m³ or ppb depending on pollutant
    sub_index: int        # 0–500 CPCB scale
    category: AQICategory


# ── Single forecast hour ──────────────────────────────────────────────────────

class HourlyForecast(BaseModel):
    timestamp: datetime
    aqi: int = Field(ge=0, le=500)
    category: AQICategory
    dominant_pollutant: Pollutant
    sub_indices: list[PollutantSubIndex]

    # ── Meteorology → chemistry ──────────────────────────────────────────────
    pbl_height_m: float          # mixing depth AFTER the aerosol feedback
    inversion_delta_t: float     # T925hPa - T1000hPa (°C) — positive = inversion
    wind_speed_ms: float
    wind_direction_deg: float

    # ── Chemistry → meteorology (the return leg of the two-way coupling) ─────
    # Exposed so the feedback is auditable rather than buried in the AQI number.
    pbl_height_met_m: float = 0.0        # unperturbed PBL straight from the met model
    pbl_suppression_pct: float = 0.0     # % of mixing depth removed by aerosol
    aerosol_optical_depth: float = 0.0   # column AOD from the PM2.5 profile
    aerosol_sw_forcing_w_m2: float = 0.0 # surface shortwave removed (≤ 0)
    aerosol_dt_surface_c: float = 0.0    # surface temperature change (≤ 0)
    feedback_iterations: int = 1         # Picard iterations to convergence

    plume_contribution: float    # Fraction of AQI from stubble-burn plume (0–1)


# ── 72-hour forecast response ─────────────────────────────────────────────────

class ForecastResponse(BaseModel):
    generated_at: datetime
    location: DelhiBBox
    station_name: str
    forecast_hours: list[HourlyForecast]  # 72 entries


# ── Inversion status response ─────────────────────────────────────────────────

class InversionStatus(BaseModel):
    timestamp: datetime
    delta_t_celsius: float       # T925hPa - T1000hPa
    pbl_height_m: float          # met-model mixing depth, no aerosol feedback applied
    lapse_rate_k_per_km: float   # Environmental lapse rate; negative = inverted
    inversion_present: bool
    severity: str                # "None" | "Weak" | "Moderate" | "Strong"
    # Diagnostic only: 1200 m / pbl_height_m, i.e. how compressed the layer is.
    # It is NOT the mechanism that produces concentrations any more -- the
    # prognostic box model is. Reported so the dashboard can show the compression.
    aqi_amplification_factor: float


# ── Plume vector response ─────────────────────────────────────────────────────

class FireHotspot(BaseModel):
    lat: float
    lon: float
    frp_mw: float                # Fire Radiative Power in MW
    source_state: str            # e.g. "Punjab" | "Haryana" | "Uttar Pradesh"
    detected_at: datetime
    confidence: str = ""         # VIIRS "l"/"n"/"h", or MODIS 0–100


class PlumeVector(BaseModel):
    origin: FireHotspot
    trajectory: list[tuple[float, float]]  # (lat, lon) waypoints, hourly
    arrival_delhi_t_hours: float | None     # None if plume misses Delhi
    # Concentration this plume adds to the transport layer (µg/m³). How much of
    # it reaches the surface depends on Delhi's mixing depth that hour, which the
    # box model resolves — so this is the layer value, not a surface value.
    pm25_contribution_ug_m3: float
    pm25_column_ug_m2: float = 0.0          # column loading delivered over Delhi
    closest_approach_km: float = 0.0        # min distance of the trajectory to Delhi
    travel_distance_km: float = 0.0         # along-trajectory path to that point


class PlumeVectorsResponse(BaseModel):
    timestamp: datetime
    wind_850hpa_u: float         # u-component m/s at 850 hPa (hour 0)
    wind_850hpa_v: float         # v-component m/s at 850 hPa (hour 0)
    hotspots: list[FireHotspot]
    plumes: list[PlumeVector]
    # Hourly 850 hPa wind used to advect the trajectories. Declared so it is
    # actually serialised — previously the service computed it and Pydantic
    # silently dropped it from the response.
    wind_series: list[tuple[float, float]] = []
    # Detections found, before truncation to the largest contributors in
    # `plumes`. Emissions are summed over all of them, so this is the honest
    # fire count for the dashboard.
    hotspot_count_total: int = 0
    # Per-hour aggregate smoke concentration in the transport layer (µg/m³),
    # 72 entries. This is what the forecast consumes.
    pm25_profile_ug_m3: list[float] = []


# ── Ingestion (mutation) schema ───────────────────────────────────────────────

class StationObservation(BaseModel):
    """POST body for ingesting a live station reading."""
    model_config = {"extra": "forbid"}

    station_id: str = Field(min_length=2, max_length=64)
    location: DelhiBBox
    timestamp: datetime
    pm25: float = Field(ge=0, le=1000)
    pm10: float = Field(ge=0, le=1000)
    no2: float = Field(ge=0, le=500)
    o3: float = Field(ge=0, le=500)
    so2: float = Field(ge=0, le=500)
    co: float = Field(ge=0, le=50)


# ── Exposure Tracker & Activity Planner Schemas ───────────────────────────────

class ExposureRequest(BaseModel):
    activity_type: str = Field(default="heavy", description="Activity type: resting, moderate, heavy")
    duration_hours: float = Field(default=1.0, ge=0.1, le=24.0, description="Duration in hours")
    target_time: str = Field(default="+0h", description="Target start time e.g. +0h, +24h")
    current_pm25: float = Field(default=50.0, ge=0.0, le=1000.0, description="Current or base PM2.5 in µg/m³")
    forecast_72h: list[dict] = Field(default_factory=list, description="Optional 72-hour forecast points array")


class SmartSchedule(BaseModel):
    recommended_hour: str
    recommended_timestamp: str
    optimal_avg_pm25: float
    target_avg_pm25: float | None = None
    projected_exposure_reduction_percent: int
    advice_string: str


class ExposureResponse(BaseModel):
    inhaled_mass_mcg: float
    cigarettes_equivalent: float
    health_warning: str
    smart_schedule: SmartSchedule
    activity_metadata: dict | None = None


# ── Dynamic Source Apportionment Schemas ──────────────────────────────────────

class VehicleBreakdown(BaseModel):
    heavy_trucks_pct: float = Field(description="Heavy commercial vehicles % of transport")
    two_three_wheelers_pct: float = Field(description="Two & three-wheelers % of transport")
    cars_pct: float = Field(description="Cars & light vehicles % of transport")
    heavy_trucks_mcg: float = Field(description="Heavy trucks PM2.5 contribution in µg/m³")
    two_three_wheelers_mcg: float = Field(description="2/3-Wheelers PM2.5 contribution in µg/m³")
    cars_mcg: float = Field(description="Cars PM2.5 contribution in µg/m³")


class SourceApportionmentResponse(BaseModel):
    total_pm25: float = Field(description="Total PM2.5 concentration in µg/m³")
    transport_pct: float = Field(description="Dynamic vehicular transport sector share %")
    dust_pct: float = Field(description="Road & soil dust sector share %")
    biomass_pct: float = Field(description="Biomass / stubble burning sector share %")
    industry_pct: float = Field(description="Industrial & power plant sector share %")
    transport_mcg: float = Field(description="Transport PM2.5 mass in µg/m³")
    dust_mcg: float = Field(description="Dust PM2.5 mass in µg/m³")
    biomass_mcg: float = Field(description="Biomass PM2.5 mass in µg/m³")
    industry_mcg: float = Field(description="Industry PM2.5 mass in µg/m³")
    vehicle_breakdown: VehicleBreakdown = Field(description="Fleet sub-breakdown for transport sector")
    proxy_status: str = Field(description="NO2 chemical proxy diagnosis and fleet time rule")


class ApportionmentHour(BaseModel):
    timestamp: str = Field(description="Formatted day & time e.g. Tue 14:00")
    total_pm25: float = Field(description="Total hourly forecasted PM2.5 in µg/m³")
    dust_mcg: float = Field(description="Road and soil dust contribution in µg/m³")
    biomass_mcg: float = Field(description="Biomass / stubble burning contribution in µg/m³")
    industry_mcg: float = Field(description="Industrial & point-source contribution in µg/m³")
    trucks_mcg: float = Field(description="Heavy diesel commercial trucks contribution in µg/m³")
    two_wheelers_mcg: float = Field(description="Two & three-wheelers contribution in µg/m³")
    cars_mcg: float = Field(description="Cars & light vehicles contribution in µg/m³")


class SourceTimeSeriesResponse(BaseModel):
    forecast: list[ApportionmentHour] = Field(description="72-hour hourly source apportionment trajectory")


# ── City-Wide Aggregate Schemas ───────────────────────────────────────────────

class PollutantDetail(BaseModel):
    index: int = Field(description="CPCB AQI sub-index for this pollutant")
    conc: float = Field(description="Aggregate concentration value")
    unit: str = Field(default="µg/m³", description="Measurement unit (µg/m³ or mg/m³ for CO)")


class CityAggregateResponse(BaseModel):
    location_label: str = Field(default="DELHI NCR / CITY AGGREGATE (43 STATIONS)", description="Unified city network label")
    station_count: int = Field(default=43, description="Number of reporting monitoring stations in aggregate")
    overall_aqi: int = Field(description="Overall CPCB maximum headline AQI")
    aqi_category: str = Field(description="CPCB category label (e.g. 'Very Poor')")
    dominant_pollutant: str = Field(description="Dominant pollutant driving the maximum AQI, e.g. 'O3'")
    color: str = Field(description="CPCB tier hex color, e.g. '#660099'")
    sub_indices: dict[str, PollutantDetail] = Field(description="Pollutant sub-indices and concentrations")
    timestamp: str = Field(description="ISO timestamp of aggregate computation")




