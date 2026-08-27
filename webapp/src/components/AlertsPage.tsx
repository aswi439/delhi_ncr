import { useMemo, useState } from "react";
import {
  Bell,
  ArrowLeft,
  Sliders,
  CheckCheck,
  AlertTriangle,
  Flame,
  Factory,
  TrendingUp,
  Activity,
  Heart,
  MapPin,
  Clock,
  ShieldCheck,
  ChevronRight,
} from "lucide-react";
import type { Panel } from "@/hooks/useForecastData";
import type {
  CityAggregateResponse,
  ConsensusResponse,
  ForecastResponse,
  HourlyForecast,
  IndustryRecord,
  PlumeVectorsResponse,
  StationReading,
} from "@/lib/types";
import {
  evaluateAlerts,
  loadAlertSettings,
  saveAlertSettings,
  markAlertAsRead,
  markAllAlertsAsRead,
  type AlertItem,
  type AlertSeverity,
  type AlertSettings,
} from "@/lib/alertsEngine";
import type { AlertLanguage } from "@/lib/alertTranslations";
import { ALERT_TRANSLATIONS } from "@/lib/alertTranslations";
import { AlertDetailModal } from "@/components/alerts/AlertDetailModal";
import { AlertSettingsModal } from "@/components/alerts/AlertSettingsModal";
import { useTranslation } from "@/i18n";

interface AlertsPageProps {
  cityAggregate?: CityAggregateResponse | null;
  stations?: Panel<StationReading[]> | StationReading[];
  forecast?: Panel<ForecastResponse> | ForecastResponse;
  hour?: HourlyForecast | null;
  plume?: Panel<PlumeVectorsResponse> | PlumeVectorsResponse;
  consensus?: ConsensusResponse | null;
  industries?: IndustryRecord[];
  onBack: () => void;
  onNavigate?: (page: any) => void;
}

export function AlertsPage({
  cityAggregate,
  stations: stationsProp,
  forecast: forecastProp,
  hour,
  plume: plumeProp,
  consensus,
  industries = [],
  onBack,
  onNavigate,
}: AlertsPageProps) {
  const { language, setLanguage } = useTranslation();
  const [settings, setSettings] = useState<AlertSettings>(() => loadAlertSettings());
  const [showSettings, setShowSettings] = useState(false);
  const [selectedAlert, setSelectedAlert] = useState<AlertItem | null>(null);
  const [severityFilter, setSeverityFilter] = useState<"ALL" | AlertSeverity>("ALL");

  const t = ALERT_TRANSLATIONS[language] || ALERT_TRANSLATIONS.en;

  // Unpack Panel wrappers safely
  const stationList = Array.isArray(stationsProp)
    ? stationsProp
    : stationsProp && "data" in stationsProp && Array.isArray(stationsProp.data)
    ? stationsProp.data
    : [];

  const forecastData =
    forecastProp && "data" in forecastProp
      ? (forecastProp.data as ForecastResponse | null)
      : (forecastProp as ForecastResponse | null);

  const plumeData =
    plumeProp && "data" in plumeProp
      ? (plumeProp.data as PlumeVectorsResponse | null)
      : (plumeProp as PlumeVectorsResponse | null);

  // Evaluate alerts reactively from real data
  const { activeAlerts, earlierAlerts, criticalCount } = useMemo(() => {
    return evaluateAlerts({
      cityAggregate,
      stations: stationList,
      forecast: forecastData,
      currentHour: hour,
      plume: plumeData,
      consensus,
      industries,
      userSettings: settings,
    });
  }, [cityAggregate, stationList, forecastData, hour, plumeData, consensus, industries, settings]);

  const filteredActiveAlerts = useMemo(() => {
    if (severityFilter === "ALL") return activeAlerts;
    return activeAlerts.filter((a) => a.severity === severityFilter);
  }, [activeAlerts, severityFilter]);

  const handleMarkAllRead = () => {
    markAllAlertsAsRead(activeAlerts.map((a) => a.id));
    // Force re-render with new settings clone
    setSettings((prev) => ({ ...prev }));
  };

  const handleOpenDetail = (alert: AlertItem) => {
    markAlertAsRead(alert.id);
    setSelectedAlert(alert);
  };

  const handleSaveSettings = (newSettings: AlertSettings) => {
    setSettings(newSettings);
    saveAlertSettings(newSettings);
  };

  const severityBadges: Record<AlertSeverity, { border: string; bg: string; text: string }> = {
    CRITICAL: { border: "#ef4444", bg: "rgba(239, 68, 68, 0.2)", text: "#fca5a5" },
    HIGH: { border: "#f97316", bg: "rgba(249, 115, 22, 0.2)", text: "#fdba74" },
    MODERATE: { border: "#eab308", bg: "rgba(234, 179, 8, 0.2)", text: "#fde047" },
    LOW: { border: "#22c55e", bg: "rgba(34, 197, 94, 0.2)", text: "#86efac" },
    INFO: { border: "#a855f7", bg: "rgba(168, 85, 247, 0.2)", text: "#d8b4fe" },
  };

  const getCategoryIcon = (cat: string) => {
    switch (cat) {
      case "AIR_QUALITY":
        return <AlertTriangle size={15} />;
      case "RAPID_RISE":
        return <TrendingUp size={15} />;
      case "INDUSTRIAL":
        return <Factory size={15} />;
      case "FIRE_SMOKE":
        return <Flame size={15} />;
      case "FORECAST":
        return <Activity size={15} />;
      case "EXPOSURE":
        return <Heart size={15} />;
      default:
        return <AlertTriangle size={15} />;
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "var(--abyss)",
        color: "var(--bone)",
        paddingTop: "4.8rem",
        paddingBottom: "4rem",
      }}
    >
      <div
        style={{
          maxWidth: "1320px",
          margin: "0 auto",
          padding: "0 clamp(1rem, 3vw, 2.5rem)",
        }}
      >
        {/* Top Action Nav Row */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "1rem",
            marginBottom: "1.8rem",
          }}
        >
          <button
            type="button"
            className="btn btn--solid"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.55rem",
              padding: "0.5rem 1rem",
              background: "var(--slab)",
              border: "1px solid var(--hairline-2)",
              borderRadius: "6px",
              color: "var(--bone)",
              fontFamily: "var(--mono)",
              fontSize: "12px",
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
            onClick={onBack}
          >
            <ArrowLeft size={14} />
            <span>{t.backToOverview}</span>
          </button>

          {/* Right Top Controls: Language Switcher, Settings, Mark Read */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
            {/* Language Selector */}
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "3px",
                padding: "3px",
                background: "rgba(15, 23, 42, 0.7)",
                border: "1px solid rgba(255, 255, 255, 0.12)",
                borderRadius: "6px",
              }}
            >
              {(["en", "hi", "ta"] as AlertLanguage[]).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => setLanguage(lang)}
                  style={{
                    padding: "3px 8px",
                    borderRadius: "4px",
                    background: language === lang ? "rgba(168, 85, 247, 0.35)" : "transparent",
                    border: language === lang ? "1px solid #a855f7" : "1px solid transparent",
                    color: language === lang ? "#FFFFFF" : "#94a3b8",
                    fontFamily: "var(--mono)",
                    fontSize: "10.5px",
                    fontWeight: 600,
                    cursor: "pointer",
                    textTransform: "uppercase",
                  }}
                >
                  {lang === "en" ? "EN" : lang === "hi" ? "हिन्दी" : "தமிழ்"}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleMarkAllRead}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.45rem 0.85rem",
                background: "rgba(255, 255, 255, 0.05)",
                border: "1px solid rgba(255, 255, 255, 0.12)",
                borderRadius: "6px",
                color: "#cbd5e1",
                fontFamily: "var(--mono)",
                fontSize: "11.5px",
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
            >
              <CheckCheck size={13} style={{ color: "#38bdf8" }} />
              <span>{t.markAllRead}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowSettings(true)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.45rem 0.85rem",
                background: "rgba(168, 85, 247, 0.15)",
                border: "1px solid rgba(168, 85, 247, 0.35)",
                borderRadius: "6px",
                color: "#c084fc",
                fontFamily: "var(--mono)",
                fontSize: "11.5px",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
            >
              <Sliders size={13} />
              <span>{t.alertSettings}</span>
            </button>
          </div>
        </div>

        {/* Header Hero Banner */}
        <div
          style={{
            marginBottom: "2rem",
            padding: "clamp(1.2rem, 3vw, 1.8rem)",
            background: "linear-gradient(135deg, rgba(30, 27, 75, 0.5) 0%, rgba(15, 23, 42, 0.8) 100%)",
            border: "1px solid rgba(168, 85, 247, 0.3)",
            borderRadius: "14px",
            boxShadow: "0 12px 36px -8px rgba(0, 0, 0, 0.5)",
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "1.2rem",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.4rem" }}>
              <div
                style={{
                  width: "28px",
                  height: "28px",
                  borderRadius: "6px",
                  background: "rgba(168, 85, 247, 0.25)",
                  border: "1px solid #a855f7",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#FFFFFF",
                }}
              >
                <Bell size={15} />
              </div>
              <h1
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: "clamp(18px, 2.5vw, 24px)",
                  fontWeight: 700,
                  color: "#FFFFFF",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  margin: 0,
                }}
              >
                {t.alertsTitle}
              </h1>
            </div>
            <p style={{ margin: 0, fontSize: "13px", color: "#94a3b8", maxWidth: "680px", lineHeight: 1.5 }}>
              {t.alertsSubtitle}
            </p>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "6px 12px",
              background: "rgba(0, 0, 0, 0.35)",
              borderRadius: "8px",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              fontFamily: "var(--mono)",
              fontSize: "11px",
              color: "#38bdf8",
            }}
          >
            <span
              style={{
                width: "7px",
                height: "7px",
                borderRadius: "50%",
                background: "#22c55e",
                boxShadow: "0 0 8px #22c55e",
              }}
            />
            <span>43 CAAQMS Real-Time Sensors Active</span>
          </div>
        </div>

        {/* 4 Compact Summary Metrics */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "1rem",
            marginBottom: "2.4rem",
          }}
        >
          {/* 1. Active Alerts */}
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
              {t.summaryActive}
            </div>
            <div style={{ fontSize: "28px", fontWeight: 700, fontFamily: "var(--mono)", color: "#FFFFFF" }}>
              {activeAlerts.length}
            </div>
          </div>

          {/* 2. New Today */}
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
              {t.summaryToday}
            </div>
            <div style={{ fontSize: "28px", fontWeight: 700, fontFamily: "var(--mono)", color: "#c084fc" }}>
              {activeAlerts.length + earlierAlerts.length}
            </div>
          </div>

          {/* 3. Critical Alerts */}
          <div
            style={{
              padding: "1.1rem 1.2rem",
              background: "rgba(15, 23, 42, 0.75)",
              border: `1px solid ${criticalCount > 0 ? "rgba(239, 68, 68, 0.4)" : "rgba(255, 255, 255, 0.1)"}`,
              borderRadius: "10px",
              backdropFilter: "blur(8px)",
            }}
          >
            <div style={{ fontSize: "11px", fontFamily: "var(--mono)", color: criticalCount > 0 ? "#fca5a5" : "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.3rem" }}>
              {t.summaryCritical}
            </div>
            <div style={{ fontSize: "28px", fontWeight: 700, fontFamily: "var(--mono)", color: criticalCount > 0 ? "#ef4444" : "#FFFFFF" }}>
              {criticalCount}
            </div>
          </div>

          {/* 4. Last Updated */}
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
              {t.summaryUpdated}
            </div>
            <div style={{ fontSize: "18px", fontWeight: 600, fontFamily: "var(--mono)", color: "#38bdf8", marginTop: "4px" }}>
              Live Telemetry (1m)
            </div>
          </div>
        </div>

        {/* Section Header: Active Alerts */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "0.8rem",
            marginBottom: "1.2rem",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#FFFFFF", fontFamily: "var(--mono)", letterSpacing: "0.04em", margin: 0 }}>
              {t.activeAlerts} ({filteredActiveAlerts.length})
            </h2>
          </div>

          {/* Filter Pills */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
            {(["ALL", "CRITICAL", "HIGH", "MODERATE"] as const).map((sev) => {
              const active = severityFilter === sev;
              return (
                <button
                  key={sev}
                  type="button"
                  onClick={() => setSeverityFilter(sev)}
                  style={{
                    padding: "4px 10px",
                    borderRadius: "6px",
                    background: active ? "rgba(168, 85, 247, 0.3)" : "rgba(255, 255, 255, 0.05)",
                    border: `1px solid ${active ? "#a855f7" : "rgba(255, 255, 255, 0.1)"}`,
                    color: active ? "#FFFFFF" : "#94a3b8",
                    fontFamily: "var(--mono)",
                    fontSize: "11px",
                    fontWeight: active ? 600 : 400,
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                  }}
                >
                  {sev === "ALL"
                    ? t.filterAll
                    : sev === "CRITICAL"
                    ? t.filterCritical
                    : sev === "HIGH"
                    ? t.filterHigh
                    : t.filterModerate}
                </button>
              );
            })}
          </div>
        </div>

        {/* Active Alerts List (Large, Clear, Horizontal Cards) */}
        {filteredActiveAlerts.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "3rem" }}>
            {filteredActiveAlerts.map((alert) => {
              const badge = severityBadges[alert.severity] || severityBadges.MODERATE;
              return (
                <div
                  key={alert.id}
                  style={{
                    background: "rgba(15, 23, 42, 0.8)",
                    border: `1px solid ${alert.isRead ? "rgba(255, 255, 255, 0.1)" : badge.border}`,
                    borderLeft: `4px solid ${badge.border}`,
                    borderRadius: "12px",
                    padding: "clamp(1.1rem, 2.5vw, 1.6rem)",
                    backdropFilter: "blur(12px)",
                    boxShadow: "0 10px 30px rgba(0, 0, 0, 0.4)",
                    transition: "transform 0.2s ease, border-color 0.2s ease",
                    position: "relative",
                  }}
                >
                  {/* Top Metadata Row */}
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "0.6rem",
                      marginBottom: "0.75rem",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.3rem",
                          padding: "2px 7px",
                          borderRadius: "4px",
                          background: badge.bg,
                          border: `1px solid ${badge.border}`,
                          color: badge.text,
                          fontFamily: "var(--mono)",
                          fontSize: "10.5px",
                          fontWeight: 700,
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                        }}
                      >
                        {getCategoryIcon(alert.category)}
                        <span>{alert.severity}</span>
                      </span>

                      <span
                        style={{
                          fontSize: "10.5px",
                          fontFamily: "var(--mono)",
                          color: "#94a3b8",
                          textTransform: "uppercase",
                        }}
                      >
                        {alert.category.replace("_", " ")}
                      </span>

                      <span style={{ color: "#475569" }}>•</span>

                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.25rem",
                          fontSize: "11.5px",
                          color: "#38bdf8",
                          fontFamily: "var(--mono)",
                        }}
                      >
                        <MapPin size={12} />
                        {alert.location}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "11px", color: "#64748b", fontFamily: "var(--mono)" }}>
                      <Clock size={12} />
                      <span>{new Date(alert.lastUpdated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} IST</span>
                    </div>
                  </div>

                  {/* Title & Human Summary */}
                  <h3
                    style={{
                      fontSize: "clamp(16px, 1.8vw, 18.5px)",
                      fontWeight: 700,
                      color: "#FFFFFF",
                      marginBottom: "0.45rem",
                    }}
                  >
                    {alert.title}
                  </h3>

                  <p
                    style={{
                      fontSize: "13.5px",
                      lineHeight: 1.55,
                      color: "#cbd5e1",
                      marginBottom: "1rem",
                    }}
                  >
                    {alert.summary}
                  </p>

                  {/* Recommendation Cardlet */}
                  <div
                    style={{
                      padding: "0.75rem 1rem",
                      background: "rgba(30, 27, 75, 0.35)",
                      border: "1px solid rgba(168, 85, 247, 0.25)",
                      borderRadius: "8px",
                      marginBottom: "1.1rem",
                      fontSize: "12.5px",
                      lineHeight: 1.45,
                      color: "#e2e8f0",
                    }}
                  >
                    <strong style={{ color: "#c084fc" }}>Recommended Action: </strong>
                    {alert.recommendedAction}
                  </div>

                  {/* Bottom Footer Actions */}
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "0.8rem",
                      borderTop: "1px solid rgba(255, 255, 255, 0.08)",
                      paddingTop: "0.85rem",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "0.8rem", fontSize: "11.5px", fontFamily: "var(--mono)", color: "#94a3b8" }}>
                      {alert.metrics.aqi && (
                        <span>
                          AQI: <strong style={{ color: "#FFFFFF" }}>{alert.metrics.aqi}</strong>
                        </span>
                      )}
                      {alert.metrics.pm25 && (
                        <span>
                          PM2.5: <strong style={{ color: "#FFFFFF" }}>{alert.metrics.pm25} µg/m³</strong>
                        </span>
                      )}
                      <span>
                        Impact: <strong style={{ color: badge.text }}>{alert.impactLevel}</strong>
                      </span>
                    </div>

                    <div style={{ display: "flex", gap: "0.6rem" }}>
                      <button
                        type="button"
                        onClick={() => handleOpenDetail(alert)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.35rem",
                          padding: "0.45rem 0.95rem",
                          borderRadius: "6px",
                          background: "rgba(168, 85, 247, 0.2)",
                          border: "1px solid rgba(168, 85, 247, 0.4)",
                          color: "#FFFFFF",
                          fontFamily: "var(--mono)",
                          fontSize: "11.5px",
                          fontWeight: 600,
                          cursor: "pointer",
                          transition: "all 0.2s ease",
                        }}
                      >
                        <span>{t.viewDetails}</span>
                        <ChevronRight size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* Empty State: You're All Clear */
          <div
            style={{
              padding: "3.5rem 1.5rem",
              background: "rgba(15, 23, 42, 0.5)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: "14px",
              textAlign: "center",
              marginBottom: "3rem",
            }}
          >
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "50%",
                background: "rgba(34, 197, 94, 0.15)",
                border: "1px solid #22c55e",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#22c55e",
                margin: "0 auto 1rem",
              }}
            >
              <ShieldCheck size={24} />
            </div>
            <h3 style={{ fontSize: "18px", fontWeight: 700, color: "#FFFFFF", marginBottom: "0.4rem" }}>
              {t.noActiveAlertsTitle}
            </h3>
            <p style={{ fontSize: "13px", color: "#94a3b8", maxWidth: "480px", margin: "0 auto" }}>
              {t.noActiveAlertsDesc}
            </p>
          </div>
        )}

        {/* Section: Earlier & Resolved Alerts */}
        <div style={{ marginBottom: "2rem" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#94a3b8", fontFamily: "var(--mono)", letterSpacing: "0.04em", marginBottom: "1rem" }}>
            {t.earlierAlerts}
          </h2>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            {earlierAlerts.map((hist) => (
              <div
                key={hist.id}
                onClick={() => handleOpenDetail(hist)}
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "0.8rem",
                  padding: "0.85rem 1.1rem",
                  background: "rgba(15, 23, 42, 0.45)",
                  border: "1px solid rgba(255, 255, 255, 0.06)",
                  borderRadius: "8px",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap" }}>
                  <span style={{ fontFamily: "var(--mono)", fontSize: "11px", color: "#64748b" }}>
                    {new Date(hist.lastUpdated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} IST
                  </span>
                  <span
                    style={{
                      padding: "2px 6px",
                      borderRadius: "4px",
                      background: "rgba(255, 255, 255, 0.06)",
                      border: "1px solid rgba(255, 255, 255, 0.1)",
                      fontFamily: "var(--mono)",
                      fontSize: "10px",
                      color: "#94a3b8",
                    }}
                  >
                    {hist.severity}
                  </span>
                  <span style={{ fontSize: "12.5px", fontWeight: 600, color: "#e2e8f0" }}>
                    {hist.title}
                  </span>
                  <span style={{ fontSize: "11.5px", color: "#64748b" }}>
                    • {hist.location}
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "11px", color: "#22c55e", fontFamily: "var(--mono)" }}>
                  <span>{t.statusResolved}</span>
                  <ChevronRight size={13} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Alert Detail Modal */}
      {selectedAlert && (
        <AlertDetailModal
          alert={selectedAlert}
          language={language}
          onClose={() => setSelectedAlert(null)}
          onNavigate={(page) => {
            if (onNavigate) onNavigate(page);
          }}
        />
      )}

      {/* Alert Settings Modal */}
      {showSettings && (
        <AlertSettingsModal
          settings={settings}
          language={language}
          onSave={handleSaveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
