import type { Panel } from "@/hooks/useForecastData";
import { aqiColor } from "@/lib/aqi";
import { clock, int } from "@/lib/format";
import type { CityOverview, StationReading } from "@/lib/types";
import { PanelMessage } from "@/components/ui/panel-message";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/i18n";

interface StationsProps {
  stations: Panel<StationReading[]>;
  overview: Panel<CityOverview>;
}

export function Stations({ stations, overview }: StationsProps) {
  const { t } = useTranslation();
  const rows = (stations.data ?? []).slice().sort((a, b) => b.aqi - a.aqi); // worst first
  const ov = overview.data;

  const cityLine = ov
    ? `Delhi ${int(ov.aqi)} · ${ov.category}${ov.updated ? ` · ${t("stations.updated")} ${clock(ov.updated)}` : ""}`
    : "";

  return (
    <section className="section section--stations" aria-labelledby="st-h">
      <div className="section__head">
        <div>
          <p className="eyebrow">{t("stations.groundTruth")}</p>
          <h2 className="section__h section__h--sm" id="st-h">
            {t("stations.title")}
          </h2>
          <p className="section__lede section__lede--sm">
            {t("stations.subtitle")}
          </p>
        </div>
        <p className="stations__city">{cityLine}</p>
      </div>

      {stations.status === "loading" ? (
        <div className="stations">
          {Array.from({ length: 8 }, (_, i) => (
            <div className="st" key={i}>
              <Skeleton style={{ width: "2.4rem", height: "1.3rem" }} />
              <div className="st__body" style={{ flex: 1 }}>
                <Skeleton style={{ width: "80%", height: "0.8rem" }} />
                <Skeleton style={{ width: "40%", height: "0.6rem", marginTop: "0.4rem" }} />
              </div>
            </div>
          ))}
        </div>
      ) : stations.status === "error" ? (
        <PanelMessage tone="warn">
          <b>{t("stations.openAqUnavailable")}</b>
        </PanelMessage>
      ) : rows.length === 0 ? (
        <PanelMessage>
          <b>{t("stations.noStations")}</b>
        </PanelMessage>
      ) : (
        <div className="stations">
          {rows.map((s) => (
            <div className="st" key={s.uid} title={s.dominant_pollutant ? `dominant ${s.dominant_pollutant}` : undefined}>
              <span className="st__aqi" style={{ ["--c" as string]: aqiColor(s.aqi) }}>
                {int(s.aqi)}
              </span>
              <span className="st__body">
                <span className="st__name">{s.name}</span>
                <span className="st__cat">{s.category}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
