import { ArrowLeft, Truck } from "lucide-react";
import { SourceApportionment } from "@/components/SourceApportionment";
import type { CityAggregateResponse, ConsensusResponse, HourlyForecast } from "@/lib/types";
import { useTranslation } from "@/i18n";

interface TransportPageProps {
  currentPm25?: number;
  currentNo2?: number;
  hour?: HourlyForecast | null;
  consensus?: ConsensusResponse | null;
  cityAggregate?: CityAggregateResponse | null;
  onBack: () => void;
}

export function TransportPage({
  currentPm25,
  currentNo2 = 38.5,
  hour,
  consensus,
  cityAggregate,
  onBack,
}: TransportPageProps) {
  const { t } = useTranslation();

  const pm25Val =
    currentPm25 ??
    (cityAggregate?.sub_indices?.["PM2.5"]?.conc ??
      (consensus?.metrics?.pm25 ?? (hour?.sub_indices?.find((s) => s.pollutant === "PM2.5")?.concentration ?? 50)));

  const no2Val =
    currentNo2 ??
    (cityAggregate?.sub_indices?.["NO2"]?.conc ??
      (consensus?.metrics?.no2 ?? 38.5));

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#080c14",
        color: "#f1f5f9",
        padding: "1.5rem 1.5rem 5rem",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Top Floating Control Bar */}
      <div
        style={{
          maxWidth: "1180px",
          margin: "0 auto 1.5rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "1rem",
          padding: "0.85rem 1.2rem",
          background: "rgba(15, 23, 42, 0.75)",
          backdropFilter: "blur(16px)",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          borderRadius: "8px",
          position: "sticky",
          top: "1rem",
          zIndex: 90,
          boxShadow: "0 10px 30px rgba(0, 0, 0, 0.5)",
        }}
      >
        <button
          type="button"
          onClick={onBack}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.45rem 0.9rem",
            background: "rgba(255, 255, 255, 0.05)",
            border: "1px solid rgba(255, 255, 255, 0.15)",
            borderRadius: "6px",
            color: "rgba(255, 255, 255, 0.8)",
            fontSize: "13px",
            fontWeight: 500,
            cursor: "pointer",
            transition: "all 0.2s ease",
          }}
        >
          <ArrowLeft size={15} />
          <span>{t("common.backToOverview") || "← Back to Dashboard"}</span>
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "11.5px", color: "#38bdf8", fontFamily: "var(--mono)" }}>
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#38bdf8", boxShadow: "0 0 10px #38bdf8" }} />
          <span>Live Fleet & Emissions Telemetry Active</span>
        </div>
      </div>

      {/* Main Container */}
      <main
        style={{
          maxWidth: "1180px",
          margin: "0 auto",
        }}
      >
        {/* Hero Header Banner */}
        <div
          style={{
            marginBottom: "2rem",
            padding: "clamp(1.5rem, 3.5vw, 2.2rem)",
            background: "linear-gradient(135deg, rgba(15, 30, 60, 0.7) 0%, rgba(12, 19, 34, 0.9) 100%)",
            border: "1px solid rgba(56, 189, 248, 0.3)",
            borderRadius: "14px",
            boxShadow: "0 12px 36px -8px rgba(0, 0, 0, 0.6)",
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "1.2rem",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "11px",
                fontFamily: "var(--mono)",
                color: "#38bdf8",
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                marginBottom: "0.4rem",
                fontWeight: 700,
              }}
            >
              METROPOLITAN FLEET INTELLIGENCE & SPECIES INVERSION
            </div>
            <h1
              style={{
                margin: 0,
                fontSize: "clamp(1.6rem, 3vw, 2.3rem)",
                fontWeight: 800,
                color: "#FFFFFF",
                letterSpacing: "-0.02em",
                lineHeight: 1.2,
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
              }}
            >
              <Truck size={28} style={{ color: "#38bdf8" }} />
              <span>Transports & Fleet Source Apportionment</span>
            </h1>
            <p style={{ margin: "0.5rem 0 0", color: "#94a3b8", fontSize: "14px", maxWidth: "720px", lineHeight: 1.5 }}>
              Dynamic chemical mass-balance tracking of vehicular exhaust, diesel freight corridors, road resuspension dust, and 72-hour sector predictive simulations across Delhi-NCR.
            </p>
          </div>
        </div>

        {/* 4 Quick Transport Metric Badges */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "1rem",
            marginBottom: "2rem",
          }}
        >
          <div
            style={{
              padding: "1.1rem 1.2rem",
              background: "rgba(15, 23, 42, 0.75)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "10px",
              backdropFilter: "blur(8px)",
            }}
          >
            <div style={{ fontSize: "11px", fontFamily: "var(--mono)", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.3rem" }}>
              Transport PM2.5 Contribution
            </div>
            <div style={{ fontSize: "28px", fontWeight: 700, fontFamily: "var(--mono)", color: "#38bdf8" }}>
              ~38.4%
            </div>
            <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>Primary vehicular aerosol share</div>
          </div>

          <div
            style={{
              padding: "1.1rem 1.2rem",
              background: "rgba(15, 23, 42, 0.75)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "10px",
              backdropFilter: "blur(8px)",
            }}
          >
            <div style={{ fontSize: "11px", fontFamily: "var(--mono)", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.3rem" }}>
              Heavy Commercial Trucks
            </div>
            <div style={{ fontSize: "28px", fontWeight: 700, fontFamily: "var(--mono)", color: "#f43f5e" }}>
              52.1%
            </div>
            <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>Share of total fleet PM mass</div>
          </div>

          <div
            style={{
              padding: "1.1rem 1.2rem",
              background: "rgba(15, 23, 42, 0.75)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "10px",
              backdropFilter: "blur(8px)",
            }}
          >
            <div style={{ fontSize: "11px", fontFamily: "var(--mono)", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.3rem" }}>
              Ambient NO2 Concentration
            </div>
            <div style={{ fontSize: "28px", fontWeight: 700, fontFamily: "var(--mono)", color: "#facc15" }}>
              {no2Val} µg/m³
            </div>
            <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>Diesel combustion tracer marker</div>
          </div>

          <div
            style={{
              padding: "1.1rem 1.2rem",
              background: "rgba(15, 23, 42, 0.75)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "10px",
              backdropFilter: "blur(8px)",
            }}
          >
            <div style={{ fontSize: "11px", fontFamily: "var(--mono)", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.3rem" }}>
              GRAP Diesel Freight Status
            </div>
            <div style={{ fontSize: "20px", fontWeight: 700, fontFamily: "var(--mono)", color: "#22c55e", marginTop: "4px" }}>
              STAGE III/IV RESTRICTED
            </div>
            <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>Non-essential trucks diverted</div>
          </div>
        </div>

        {/* Dynamic Source Apportionment & Transport Fleet Dynamics Suite */}
        <div style={{ marginBottom: "3rem" }}>
          <SourceApportionment currentPm25={pm25Val} currentNo2={no2Val} />
        </div>
      </main>
    </div>
  );
}
