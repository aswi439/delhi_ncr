import {
  RotateCw,
  History,
  CloudRain,
  HeartPulse,
  BarChart3,
  Layers,
  Bot,
  Bell,
  Download,
} from "lucide-react";

import type { Feeds } from "@/hooks/useForecastData";
import { useTranslation } from "@/i18n";
import { LanguageSelector } from "@/components/LanguageSelector";

export type PageType =
  | "overview"
  | "forecast-datas"
  | "historic-data"
  | "atmospheric-dynamics"
  | "exposure-tracker"
  | "health-assistant"
  | "alerts"
  | "report";

export interface RailProps {
  feeds?: Feeds;
  stamp: string;
  onRefresh: () => void;
  currentPage?: PageType;
  onPageChange?: (page: PageType) => void;
  activeVideo?: number;
  onVideoChange?: (index: number) => void;
  unreadAlertsCount?: number;
  hasCriticalAlert?: boolean;
}

export function Rail({
  stamp,
  onRefresh,
  currentPage = "overview",
  onPageChange,
  unreadAlertsCount = 0,
  hasCriticalAlert = false,
}: RailProps) {
  const { t } = useTranslation();

  const handleSelectPage = (page: PageType) => {
    if (onPageChange) {
      onPageChange(page);
    }
  };

  return (
    <header
      className="rail"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0.85rem clamp(1rem, 3vw, 2.5rem)",
        background: "transparent",
        border: "none",
        boxShadow: "none",
        zIndex: 40,
      }}
    >
      {/* Left: Brand Logo & Download Report Trigger (Stacked in top-left) */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "0.35rem", zIndex: 10 }}>
        <div
          className="rail__brand"
          style={{ cursor: "pointer", display: "flex", alignItems: "baseline", gap: "0.5rem" }}
          onClick={() => handleSelectPage("overview")}
          title="Return to Main Overview Console"
        >
          <span
            style={{
              width: "8px",
              height: "8px",
              backgroundColor: "var(--live)",
              borderRadius: "1px",
              transform: "rotate(45deg)",
              boxShadow: "0 0 10px var(--live)",
              alignSelf: "center",
            }}
            aria-hidden="true"
          />
          <span style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: "14px", color: "#FFFFFF", letterSpacing: "0.06em", textShadow: "0 1px 4px rgba(0,0,0,0.8)" }}>
            NCR<span style={{ color: "var(--live)" }}>·</span>72
          </span>
          <span style={{ fontFamily: "var(--mono)", fontSize: "10.5px", color: "rgba(255, 255, 255, 0.55)", letterSpacing: "0.15em", textTransform: "uppercase" }}>
            coupled aqi forecast
          </span>
        </div>

        {/* Compact Premium Download Report Action placed directly under brand text */}
        {onPageChange && (
          <button
            type="button"
            onClick={() => onPageChange("report")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
              padding: "0.26rem 0.65rem",
              background: currentPage === "report" ? "rgba(56, 189, 248, 0.25)" : "rgba(255, 255, 255, 0.08)",
              border: `1px solid ${currentPage === "report" ? "rgba(56, 189, 248, 0.5)" : "rgba(255, 255, 255, 0.18)"}`,
              borderRadius: "5px",
              color: currentPage === "report" ? "var(--cyan)" : "#FFFFFF",
              fontFamily: "var(--mono)",
              fontSize: "10.5px",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
              boxShadow: currentPage === "report" ? "0 0 12px rgba(56, 189, 248, 0.4)" : "0 2px 6px rgba(0,0,0,0.3)",
              whiteSpace: "nowrap",
            }}
            title="Download Official Delhi-NCR AQI Intelligence Report"
          >
            <Download size={11} style={{ color: "var(--cyan)" }} />
            <span>{t("navigation.downloadReport") || "Download Report"}</span>
          </button>
        )}
      </div>

      {/* Center: Dedicated Top Navigation Pill Bar */}
      {onPageChange && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 50,
            pointerEvents: "auto",
            maxWidth: "calc(100vw - 320px)",
          }}
        >
          <div
            className="liquid-glass"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.25rem",
              padding: "0.28rem 0.35rem",
              borderRadius: "9999px",
              background: "rgba(12, 16, 26, 0.65)",
              backdropFilter: "blur(24px) saturate(180%)",
              WebkitBackdropFilter: "blur(24px) saturate(180%)",
              border: "1px solid rgba(255, 255, 255, 0.2)",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.5), inset 0 1px 1.5px rgba(255, 255, 255, 0.25)",
              overflowX: "auto",
              maxWidth: "100%",
            }}
          >
            {[
              { id: "overview", label: t("navigation.overview"), icon: Layers },
              { id: "forecast-datas", label: t("navigation.forecast"), icon: BarChart3 },
              { id: "historic-data", label: t("navigation.historic"), icon: History },
              { id: "atmospheric-dynamics", label: t("navigation.atmosphere"), icon: CloudRain },
              { id: "exposure-tracker", label: t("navigation.exposure"), icon: HeartPulse },
              { id: "health-assistant", label: t("navigation.healthAssistant"), icon: Bot },
            ].map((btn) => {
              const isActive = currentPage === btn.id;
              const Icon = btn.icon;
              return (
                <button
                  key={btn.id}
                  type="button"
                  onClick={() => onPageChange(btn.id as PageType)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.35rem",
                    padding: "0.32rem 0.75rem",
                    borderRadius: "9999px",
                    background: isActive ? "rgba(255, 255, 255, 0.2)" : "transparent",
                    border: `1px solid ${isActive ? "rgba(255, 255, 255, 0.38)" : "transparent"}`,
                    boxShadow: isActive
                      ? "0 2px 8px rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.35)"
                      : "none",
                    color: isActive ? "#FFFFFF" : "rgba(255, 255, 255, 0.75)",
                    fontFamily: "var(--mono)",
                    fontSize: "11.5px",
                    fontWeight: isActive ? 600 : 400,
                    cursor: "pointer",
                    transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                    whiteSpace: "nowrap",
                    outline: "none",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.color = "#FFFFFF";
                      e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.color = "rgba(255, 255, 255, 0.75)";
                      e.currentTarget.style.background = "transparent";
                    }
                  }}
                >
                  <Icon
                    size={12.5}
                    style={{
                      color: isActive ? "var(--live)" : "rgba(255, 255, 255, 0.6)",
                      transition: "color 0.25s ease",
                    }}
                  />
                  <span>{btn.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Right: Alert Bell Quick Icon, Timestamp, Refresh & Language Selector */}
      <div
        style={{
          marginLeft: "auto",
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          zIndex: 10,
        }}
      >
        {/* Dedicated Header Bell Quick Button */}
        {onPageChange && (
          <button
            type="button"
            onClick={() => onPageChange("alerts")}
            style={{
              position: "relative",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "32px",
              height: "32px",
              background: currentPage === "alerts" ? "rgba(168, 85, 247, 0.35)" : "rgba(255, 255, 255, 0.08)",
              border: `1px solid ${currentPage === "alerts" ? "#a855f7" : "rgba(255, 255, 255, 0.22)"}`,
              borderRadius: "50%",
              color: currentPage === "alerts" ? "#FFFFFF" : "rgba(255, 255, 255, 0.85)",
              cursor: "pointer",
              transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
              boxShadow: currentPage === "alerts" ? "0 0 12px rgba(168, 85, 247, 0.5)" : "none",
            }}
            title={t("header.alertsTooltip")}
            aria-label="Real-time Alerts"
          >
            <Bell size={14} style={{ color: currentPage === "alerts" || unreadAlertsCount > 0 ? "#c084fc" : undefined }} />
            {unreadAlertsCount > 0 && (
              <span
                className={hasCriticalAlert ? "alert-bell-pulse" : ""}
                style={{
                  position: "absolute",
                  top: "-2px",
                  right: "-2px",
                  minWidth: "16px",
                  height: "16px",
                  padding: "0 4px",
                  borderRadius: "9999px",
                  background: hasCriticalAlert ? "#ef4444" : "#a855f7",
                  color: "#FFFFFF",
                  fontSize: "9px",
                  fontWeight: 700,
                  fontFamily: "var(--mono)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: hasCriticalAlert ? "0 0 8px #ef4444" : "0 0 6px #a855f7",
                  lineHeight: 1,
                }}
              >
                {unreadAlertsCount > 9 ? "9+" : unreadAlertsCount}
              </span>
            )}
          </button>
        )}

        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: "11px",
            color: "rgba(255, 255, 255, 0.6)",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            textShadow: "0 1px 4px rgba(0,0,0,0.8)",
          }}
        >
          {stamp}
        </span>
        <button
          type="button"
          onClick={onRefresh}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.4rem",
            padding: "0.32rem 0.65rem",
            background: "transparent",
            border: "1px solid rgba(255, 255, 255, 0.25)",
            borderRadius: "4px",
            color: "#FFFFFF",
            fontFamily: "var(--mono)",
            fontSize: "11.5px",
            fontWeight: 500,
            cursor: "pointer",
            transition: "all 0.2s ease",
            textShadow: "0 1px 4px rgba(0,0,0,0.8)",
          }}
        >
          <RotateCw size={12} aria-hidden="true" />
          <span>{t("header.refresh")}</span>
        </button>

        {/* Premium Language Selector (Top Right Box) */}
        <LanguageSelector />
      </div>
    </header>
  );
}
