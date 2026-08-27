import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Boot } from "@/components/Boot";
import { ConsensusDashboard } from "@/components/ConsensusDashboard";
import { SourceApportionment } from "@/components/SourceApportionment";
import { HazeField } from "@/components/HazeField";
import { Hero } from "@/components/Hero";
import { Rail, type PageType } from "@/components/Rail";
import { SampleBanner } from "@/components/SampleBanner";
import { StationMap } from "@/components/StationMap";
import { Stations } from "@/components/Stations";
import { ForecastDataPage } from "@/components/ForecastDataPage";
import { HistoricDataPage } from "@/components/HistoricDataPage";
import { AtmosphericDynamicsPage } from "@/components/AtmosphericDynamicsPage";
import { ExposureTrackerPage } from "@/components/ExposureTrackerPage";
import { HealthCareAssistantPage } from "@/components/HealthCareAssistantPage";
import { PollutantCardStackSection } from "@/components/PollutantCardStackSection";
import GradualBlur from "@/components/ui/GradualBlur";
import { useCityAggregate } from "@/hooks/useCityAggregate";

import { useConsensus } from "@/hooks/useConsensus";
import { useCursor } from "@/hooks/useCursor";
import { useForecastData } from "@/hooks/useForecastData";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { categoryColor } from "@/lib/aqi";
import { stamp as fmtStamp } from "@/lib/format";

/**
 * The console. One shared hour-cursor drives every panel; one data hook owns all
 * upstream state. This component only composes them and reflects three runtime
 * facts onto the document root that the ported CSS keys off:
 *   data-state  boot | ready   → lifts the boot overlay
 *   data-anim   on   | off     → enables entrance motion + the ambient haze
 *   --live      the scrubbed hour's AQI colour, so accents track the reading
 */
export default function App() {
  const reduced = useReducedMotion();
  const data = useForecastData();
  const consensus = useConsensus();
  const cityAggregate = useCityAggregate();
  const [activeVideo, setActiveVideo] = useState<number>(0);

  const [currentPage, setCurrentPage] = useState<PageType>(() => {
    if (typeof window !== "undefined") {
      if (
        window.location.hash === "#forecast-datas" ||
        window.location.hash === "#forecast-data"
      ) {
        return "forecast-datas";
      }
      if (
        window.location.hash === "#historic-data" ||
        window.location.hash === "#historic-datas"
      ) {
        return "historic-data";
      }
      if (
        window.location.hash === "#atmospheric-dynamics" ||
        window.location.hash === "#atmosphere"
      ) {
        return "atmospheric-dynamics";
      }
      if (
        window.location.hash === "#exposure-tracker" ||
        window.location.hash === "#exposure"
      ) {
        return "exposure-tracker";
      }
      if (
        window.location.hash === "#health-assistant" ||
        window.location.hash === "#healthcare" ||
        window.location.hash === "#health"
      ) {
        return "health-assistant";
      }
    }
    return "overview";
  });

  useEffect(() => {
    const handleHash = () => {
      if (
        window.location.hash === "#forecast-datas" ||
        window.location.hash === "#forecast-data"
      ) {
        setCurrentPage("forecast-datas");
      } else if (
        window.location.hash === "#historic-data" ||
        window.location.hash === "#historic-datas"
      ) {
        setCurrentPage("historic-data");
      } else if (
        window.location.hash === "#atmospheric-dynamics" ||
        window.location.hash === "#atmosphere"
      ) {
        setCurrentPage("atmospheric-dynamics");
      } else if (
        window.location.hash === "#exposure-tracker" ||
        window.location.hash === "#exposure"
      ) {
        setCurrentPage("exposure-tracker");
      } else if (
        window.location.hash === "#health-assistant" ||
        window.location.hash === "#healthcare" ||
        window.location.hash === "#health"
      ) {
        setCurrentPage("health-assistant");
      } else if (window.location.hash === "#overview" || window.location.hash === "") {
        setCurrentPage("overview");
      }
    };
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, []);

  const handlePageChange = (page: PageType) => {
    setCurrentPage(page);
    window.location.hash =
      page === "forecast-datas"
        ? "forecast-datas"
        : page === "historic-data"
        ? "historic-data"
        : page === "atmospheric-dynamics"
        ? "atmospheric-dynamics"
        : page === "exposure-tracker"
        ? "exposure-tracker"
        : page === "health-assistant"
        ? "health-assistant"
        : "overview";
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const hours = data.forecast.data?.forecast_hours ?? [];
  const n = hours.length;
  const cursor = useCursor(Math.max(0, n - 1), reduced);
  const hour = hours[cursor.cursor] ?? null;

  const pm25 = hour?.sub_indices.find((s) => s.pollutant === "PM2.5")?.concentration ?? null;
  const stamp = data.forecast.data?.generated_at ? fmtStamp(data.forecast.data.generated_at) : "—";

  // ── data-anim: motion preference (set before paint to avoid a reveal flash) ──
  useLayoutEffect(() => {
    document.documentElement.dataset.anim = reduced ? "off" : "on";
  }, [reduced]);

  // ── data-state: boot overlay visibility ────────────────────────────────────
  useEffect(() => {
    document.documentElement.dataset.state = data.ready ? "ready" : "boot";
  }, [data.ready]);

  // ── --live: bind the whole console's accent to the scrubbed hour's category ──
  useEffect(() => {
    const root = document.documentElement.style;
    if (hour) root.setProperty("--live", categoryColor(hour.category));
    else root.removeProperty("--live");
  }, [hour]);

  // ── Entrance reveal: fade sections up as they enter view (motion only) ───────
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (reduced || currentPage !== "overview") return;
    const root = mainRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;

    const targets = Array.from(
      root.querySelectorAll<HTMLElement>(":scope > .hero, :scope > .section, :scope > .split > .section, :scope > .foot"),
    );
    targets.forEach((el, i) => {
      el.classList.add("reveal");
      el.style.setProperty("--d", `${Math.min(i, 4) * 60}ms`);
    });

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    targets.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [reduced, currentPage]);

  return (
    <>
      <HazeField pm25={pm25} reduced={reduced} />

      <Rail
        feeds={data.feeds}
        stamp={stamp}
        onRefresh={data.refresh}
        currentPage={currentPage}
        onPageChange={handlePageChange}
        activeVideo={activeVideo}
        onVideoChange={setActiveVideo}
      />
      <SampleBanner sample={data.sample} onScenario={data.setScenario} />

      {currentPage === "forecast-datas" ? (
        <ForecastDataPage
          forecast={data.forecast}
          hour={hour}
          cursor={cursor.cursor}
          consensus={consensus.data}
          cityAggregate={cityAggregate.data}
          onBack={() => handlePageChange("overview")}
        />
      ) : currentPage === "historic-data" ? (
        <HistoricDataPage
          forecast={data.forecast}
          hour={hour}
          cursor={cursor.cursor}
          consensus={consensus.data}
          cityAggregate={cityAggregate.data}
          onBack={() => handlePageChange("overview")}
        />
      ) : currentPage === "atmospheric-dynamics" ? (
        <AtmosphericDynamicsPage
          forecast={data.forecast}
          hour={hour}
          cursor={cursor}
          inversion={data.inversion}
          consensus={consensus.data}
          cityAggregate={cityAggregate.data}
          onBack={() => handlePageChange("overview")}
        />
      ) : currentPage === "exposure-tracker" ? (
        <ExposureTrackerPage
          forecast={data.forecast}
          hour={hour}
          cursor={cursor.cursor}
          consensus={consensus.data}
          cityAggregate={cityAggregate.data}
          onBack={() => handlePageChange("overview")}
        />
      ) : currentPage === "health-assistant" ? (
        <HealthCareAssistantPage
          forecast={data.forecast}
          hour={hour}
          cursor={cursor.cursor}
          consensus={consensus.data}
          cityAggregate={cityAggregate.data}
          onBack={() => handlePageChange("overview")}
        />
      ) : (
        <main ref={mainRef}>
          {/* 1. Hero Section (AQI Value with Full Screen Video Background) */}
          <div id="forecast-hero">
            <Hero
              forecast={data.forecast}
              hour={hour}
              cursor={cursor.cursor}
              consensus={consensus.data}
              cityAggregate={cityAggregate.data}
              activeVideo={activeVideo}
              onVideoChange={setActiveVideo}
              ready={data.ready}
              currentPage={currentPage}
              onPageChange={handlePageChange}
            />
          </div>

          {/* 1.5. Live Pollutant Particle Breakdown - 3D Fanning Card Stack */}
          <PollutantCardStackSection
            cityAggregate={cityAggregate.data}
            consensus={consensus.data}
            hour={hour}
            cursor={cursor.cursor}
          />

          {/* 2. Delhi NCR Live Condition */}
          <div id="consensus-dashboard">


            <ConsensusDashboard
              data={consensus.data}
              loading={consensus.status === "loading"}
              error={consensus.error}
              cityAggregate={cityAggregate.data}
            />
          </div>

          {/* 3. Map View Stations */}
          <div id="station-map-view">
            <StationMap
              stations={data.stations}
              plume={data.plume}
              forecast={data.forecast}
              overview={data.overview}
              cursor={cursor.cursor}
              cityAggregate={cityAggregate.data}
            />
          </div>

          {/* 4. Dynamic Source Apportionment & 72-Hour Predictive Time-Series */}
          <div id="source-apportionment" style={{ marginTop: "clamp(3.5rem, 6vw, 5.5rem)", marginBottom: "clamp(3.5rem, 6vw, 5.5rem)" }}>
            <SourceApportionment
              currentPm25={cityAggregate.data?.sub_indices?.["PM2.5"]?.conc ?? (consensus.data?.metrics?.pm25 ?? pm25 ?? 50)}
              currentNo2={cityAggregate.data?.sub_indices?.["NO2"]?.conc ?? (consensus.data?.metrics?.no2 ?? 38.5)}
            />
          </div>

          {/* 5. List All Live Stations */}
          <div id="stations-grid">
            <Stations stations={data.stations} overview={data.overview} />
          </div>
        </main>
      )}

      <Boot boot={data.boot} ready={data.ready} />

      {/* Progressive Gradual Blur Overlay at Website Bottom */}
      <GradualBlur
        target="page"
        position="bottom"
        height="6rem"
        strength={2.5}
        divCount={6}
        curve="bezier"
        exponential={true}
        opacity={1}
        zIndex={35}
      />
    </>
  );
}
