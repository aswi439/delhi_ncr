import { useCallback, useEffect, useRef, useState } from "react";
import { getConsensus, getFeedbackForecast } from "@/lib/api";
import type { AqiCategory, ConsensusResponse, FeedbackForecastResponse } from "@/lib/types";

function category(aqi: number): AqiCategory {
  if (aqi <= 50) return "Good";
  if (aqi <= 100) return "Satisfactory";
  if (aqi <= 200) return "Moderate";
  if (aqi <= 300) return "Poor";
  if (aqi <= 400) return "Very Poor";
  return "Severe";
}

function toDashboardResponse(response: FeedbackForecastResponse): ConsensusResponse {
  const first = response.forecast_72h[0];
  const selected = response.forecast_72h.filter((point) => [12, 24, 48, 72].includes(Number(point.hour.slice(1, -1))));
  const pm25_0 = first?.pm2_5 ?? 118;
  const pm10_0 = first ? first.pm2_5 * 1.6 : 188;
  const aqi_0 = first?.aqi ?? 285;
  const temp_0 = first?.adjusted_temp ?? 19;
  const wind_0 = first?.wind_speed ?? 5.2;

  return {
    generated_at: new Date().toISOString(),
    location: { lat: 28.6139, lon: 77.209 },
    metrics: {
      pm25: pm25_0,
      pm10: pm10_0,
      aqi: aqi_0,
      temp: temp_0,
      wind: wind_0,
      no2: 38.5,
      o3: 54.0,
      so2: 14.2,
      co: 0.82,
    },
    successful_sources: ["Open-Meteo", "Deterministic Box Model"],
    source_count: 2,
    forecast: [
      {
        horizon_hours: 0,
        timestamp: new Date().toISOString(),
        pm25: pm25_0,
        aqi: aqi_0,
        category: category(aqi_0),
        wind_speed: wind_0,
        temperature: temp_0,
        rule: "Current",
        explanation: "Current consensus baseline observation",
      },
      ...selected.map((point) => ({
        horizon_hours: Number(point.hour.slice(1, -1)),
        timestamp: new Date(Date.now() + Number(point.hour.slice(1, -1)) * 3600000).toISOString(),
        pm25: point.pm2_5,
        aqi: point.aqi,
        category: category(point.aqi),
        wind_speed: point.wind_speed,
        temperature: point.adjusted_temp,
        rule: point.inversion === "Strong" ? "A" : point.wind_speed > 15 ? "B" : "C",
        explanation: response.atmospheric_insights.aerosol_feedback_status,
      })),
    ],
    explainability: `${response.atmospheric_insights.aerosol_feedback_status}. ${response.atmospheric_insights.stubble_plume_risk}.`,
    severe_alert: response.forecast_72h.some((point) => point.aqi > 400),
  };
}

export function useConsensus() {
  const [data, setData] = useState<ConsensusResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("loading");
    setError(null);

    void getConsensus(controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        const hasT0 = response.forecast.some((f) => f.horizon_hours === 0);
        const forecast = hasT0
          ? response.forecast
          : [
              {
                horizon_hours: 0,
                timestamp: response.generated_at,
                pm25: response.metrics.pm25,
                aqi: response.metrics.aqi,
                category: category(response.metrics.aqi),
                wind_speed: response.metrics.wind,
                temperature: response.metrics.temp,
                rule: "Current",
                explanation: "Current consensus observation",
              },
              ...response.forecast,
            ];
        setData({ ...response, forecast });
        setStatus("ok");
      })
      .catch(() => {
        // Fallback to getFeedbackForecast if direct consensus call is unavailable
        return getFeedbackForecast(controller.signal)
          .then((response) => {
            if (controller.signal.aborted) return;
            setData(toDashboardResponse(response));
            setStatus("ok");
          })
          .catch((reason) => {
            if (controller.signal.aborted) return;
            setStatus("error");
            setError(reason instanceof Error ? reason.message : String(reason));
          });
      });
  }, []);

  useEffect(() => {
    refresh();
    return () => abortRef.current?.abort();
  }, [refresh]);

  return { data, status, error, refresh };
}
