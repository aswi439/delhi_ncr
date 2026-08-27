/**
 * Wire types for the NCR·72 API (`/api/v1`), mirroring backend/app/schemas/forecast.py
 * and the realtime_service dict shapes. Everything here is the JSON-over-the-wire
 * shape: Python `datetime` → ISO string, Python `tuple` → fixed-length array.
 *
 * `erasableSyntaxOnly` forbids TS enums, so CPCB categories and pollutants are
 * union types plus ordered const arrays (used for sorting and iteration).
 */

// ── CPCB National AQI (2014) vocabulary ──────────────────────────────────────

export type AqiCategory =
  | "Good"
  | "Satisfactory"
  | "Moderate"
  | "Poor"
  | "Very Poor"
  | "Severe";

/** Ascending severity — index doubles as a rank. */
export const AQI_CATEGORIES: readonly AqiCategory[] = [
  "Good",
  "Satisfactory",
  "Moderate",
  "Poor",
  "Very Poor",
  "Severe",
] as const;

export type Pollutant = "PM2.5" | "PM10" | "O3" | "NO2" | "SO2" | "CO";

/** Canonical display order for the sub-index list. */
export const POLLUTANTS: readonly Pollutant[] = [
  "PM2.5",
  "PM10",
  "O3",
  "NO2",
  "SO2",
  "CO",
] as const;

export type InversionSeverity = "None" | "Weak" | "Moderate" | "Strong";

// ── Forecast ──────────────────────────────────────────────────────────────────

export interface PollutantSubIndex {
  pollutant: Pollutant;
  concentration: number; // µg/m³ or ppb depending on species
  sub_index: number; // 0–500 CPCB scale
  category: AqiCategory;
}

export interface HourlyForecast {
  timestamp: string; // ISO 8601
  aqi: number; // 0–500, = max(sub_index), never a mean
  category: AqiCategory;
  dominant_pollutant: Pollutant;
  sub_indices: PollutantSubIndex[];

  // meteorology → chemistry
  pbl_height_m: number; // mixing depth AFTER the aerosol feedback
  inversion_delta_t: number; // T925 − T1000 (°C); positive = inversion
  wind_speed_ms: number;
  wind_direction_deg: number;

  // chemistry → meteorology (the return leg, exposed for audit)
  pbl_height_met_m: number; // unperturbed PBL straight from the met model
  pbl_suppression_pct: number; // % of mixing depth removed by aerosol
  aerosol_optical_depth: number; // column AOD from the PM2.5 profile
  aerosol_sw_forcing_w_m2: number; // surface shortwave removed (≤ 0)
  aerosol_dt_surface_c: number; // surface temperature change (≤ 0)
  feedback_iterations: number; // Picard iterations to convergence

  plume_contribution: number; // fraction of AQI from stubble plume (0–1)
}

export interface LatLon {
  lat: number;
  lon: number;
}

export interface ForecastResponse {
  generated_at: string; // ISO 8601
  location: LatLon;
  station_name: string;
  forecast_hours: HourlyForecast[]; // 72 entries
}

// ── Inversion ───────────────────────────────────────────────────────────────

export interface InversionStatus {
  timestamp: string;
  delta_t_celsius: number; // T925 − T1000
  pbl_height_m: number; // met-model mixing depth, no aerosol feedback
  lapse_rate_k_per_km: number; // negative = inverted
  inversion_present: boolean;
  severity: InversionSeverity;
  aqi_amplification_factor: number; // diagnostic compression, 1200/pbl
}

// ── Plume / fire ──────────────────────────────────────────────────────────────

export interface FireHotspot {
  lat: number;
  lon: number;
  frp_mw: number; // Fire Radiative Power, MW
  source_state: string; // "Punjab" | "Haryana" | "Uttar Pradesh" | …
  detected_at: string;
  confidence: string; // VIIRS "l"/"n"/"h" or MODIS 0–100
}

/** [lat, lon] waypoint. */
export type TrajPoint = [number, number];
/** [u, v] wind components, m/s. */
export type WindUV = [number, number];

export interface PlumeVector {
  origin: FireHotspot;
  trajectory: TrajPoint[]; // hourly (lat, lon) waypoints
  arrival_delhi_t_hours: number | null; // null if it misses Delhi
  pm25_contribution_ug_m3: number; // transport-layer, not surface
  pm25_column_ug_m2: number;
  closest_approach_km: number;
  travel_distance_km: number;
}

export interface PlumeVectorsResponse {
  timestamp: string;
  wind_850hpa_u: number; // hour-0 u, m/s
  wind_850hpa_v: number; // hour-0 v, m/s
  hotspots: FireHotspot[];
  plumes: PlumeVector[];
  wind_series: WindUV[]; // hourly 850 hPa wind driving advection
  hotspot_count_total: number; // detections before truncation to `plumes`
  pm25_profile_ug_m3: number[]; // 72 hourly transport-layer aggregates
}

// ── Realtime (bare dicts from realtime_service, no envelope) ──────────────────

export interface CityOverview {
  aqi: number;
  category: AqiCategory;
  color: string; // raw CPCB colour from backend — we re-derive, don't trust
  updated: string | null;
  pm25: number | null;
  pm10: number | null;
  o3: number | null;
  no2: number | null;
  temp: number | null;
  wind: number | null;
}

export interface StationReading {
  uid: string;
  name: string;
  lat: number;
  lon: number;
  aqi: number;
  category: AqiCategory;
  color: string; // raw CPCB colour — re-derived on the client
  dominant_pollutant: Pollutant | string;
  updated: string | null;
  pollutants: Partial<Record<string, number>>;
  source: string; // "openaq"
}

export interface HealthResponse {
  status: string;
  timestamp: string;
}

// ── Sample bundle (public/sample-forecast.json) ───────────────────────────────

export type ScenarioId = "november" | "august";

export interface SampleScenario {
  id: ScenarioId;
  label: string;
  blurb: string;
  forecast: ForecastResponse;
  inversion: InversionStatus[]; // 72 entries
  plume: PlumeVectorsResponse;
}

export interface SampleBundle {
  kind: string; // "sample"
  generated_by: string;
  note: string;
  scenarios: SampleScenario[];
}


// ── Five-source consensus dashboard feed ──────────────────────────────────────
export interface ConsensusMetrics {
  pm25: number;
  pm10: number;
  aqi: number;
  temp: number;
  wind: number;
  no2?: number;
  o3?: number;
  so2?: number;
  co?: number;
}

export interface ConsensusForecastPoint {
  horizon_hours: number;
  timestamp: string;
  pm25: number;
  aqi: number;
  category: AqiCategory;
  wind_speed: number;
  temperature: number;
  rule: string;
  explanation: string;
}

export interface ConsensusResponse {
  generated_at: string;
  location: LatLon;
  metrics: ConsensusMetrics;
  successful_sources: string[];
  source_count: number;
  forecast: ConsensusForecastPoint[];
  explainability: string;
  severe_alert: boolean;
}

export interface ConsensusPanel {
  status: "loading" | "ok" | "error";
  data: ConsensusResponse | null;
  error: string | null;
}

export interface MlForecastRequest {
  current_pm25: number;
  forecast_wind_speed: number;
  forecast_temp: number;
  hour_of_day: number;
  month: number;
}

export interface MlForecastPoint {
  horizon_hours: 12 | 24 | 48 | 72;
  pm25: number;
  aqi: number;
}

export interface MlForecastResponse {
  generated_at: string;
  model: string;
  model_metrics: { mae?: number; rmse?: number };
  predictions: MlForecastPoint[];
  explainability: string;
  alert_status: "CRITICAL" | "NORMAL";
}

export interface FeedbackForecastPoint {
  hour: string;
  pm2_5: number;
  aqi: number;
  pbl_height: number;
  inversion: "Strong" | "Moderate" | "Weak";
  temp_penalty: number;
  adjusted_temp: number;
  wind_speed: number;
  wind_direction: number;
  shortwave: number;
  stubble_injection: number;
}

export interface FeedbackForecastResponse {
  forecast_72h: FeedbackForecastPoint[];
  atmospheric_insights: {
    current_pbl: number;
    inversion_risk: "Strong" | "Moderate" | "Weak";
    aerosol_feedback_status: string;
    stubble_plume_risk: string;
  };
}

export type ActivityType = "resting" | "moderate" | "heavy";

export interface ExposureRequest {
  activity_type: ActivityType;
  duration_hours: number;
  target_time?: string;
  current_pm25: number;
  forecast_72h?: Array<Record<string, any>>;
}

export interface SmartSchedule {
  recommended_hour: string;
  recommended_timestamp: string;
  optimal_avg_pm25: number;
  target_avg_pm25?: number;
  projected_exposure_reduction_percent: number;
  advice_string: string;
}

export interface ExposureResponse {
  inhaled_mass_mcg: number;
  cigarettes_equivalent: number;
  health_warning: string;
  smart_schedule: SmartSchedule;
  activity_metadata?: {
    activity_type: string;
    breathing_rate_m3_h: number;
    duration_hours: number;
    ambient_pm25_ug_m3: number;
  };
}

export interface VehicleBreakdown {
  heavy_trucks_pct: number;
  two_three_wheelers_pct: number;
  cars_pct: number;
  heavy_trucks_mcg: number;
  two_three_wheelers_mcg: number;
  cars_mcg: number;
}

export interface SourceApportionmentResponse {
  total_pm25: number;
  transport_pct: number;
  dust_pct: number;
  biomass_pct: number;
  industry_pct: number;
  transport_mcg: number;
  dust_mcg: number;
  biomass_mcg: number;
  industry_mcg: number;
  vehicle_breakdown: VehicleBreakdown;
  proxy_status: string;
}

export interface ApportionmentHour {
  timestamp: string;
  total_pm25: number;
  dust_mcg: number;
  biomass_mcg: number;
  industry_mcg: number;
  trucks_mcg: number;
  two_wheelers_mcg: number;
  cars_mcg: number;
}

export interface SourceTimeSeriesResponse {
  forecast: ApportionmentHour[];
}

export interface PollutantDetail {
  index: number;
  conc: number;
  unit: string;
}

export interface CityAggregateResponse {
  location_label: string;
  station_count: number;
  overall_aqi: number;
  aqi_category: string;
  dominant_pollutant: string;
  color: string;
  sub_indices: Record<string, PollutantDetail>;
  timestamp: string;
}

export interface IndustryRecord {
  id?: string | number;
  name: string;
  city: "Delhi" | string;
  state: "Delhi" | string;
  latitude: number;
  longitude: number;
  category?: string | null;
  sector?: string | null;
  status?: string | null;
  capacity?: string | number | null;
  address?: string | null;
}

export interface IndustryResponse {
  city: string;
  state: string;
  count: number;
  source: string;
  records: IndustryRecord[];
}
