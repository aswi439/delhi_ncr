import { Fragment, useEffect, useMemo, useState } from "react";
import {
  Circle,
  CircleMarker,
  MapContainer,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";

import { heatLayer } from "@/lib/leafletHeat";
import { aqiColor } from "@/lib/aqi";
import {
  HEAT_GRADIENT,
  heatPoints,
  hexLerp,
  hotspotRadius,
  MAP_CENTER,
  MAP_ZOOM,
  type MapLayers,
  type MapStyle,
} from "@/lib/mapgeo";
import type { IndustryRecord, PlumeVectorsResponse, StationReading } from "@/lib/types";
import { classifyIndustryTier } from "@/lib/types";

/**
 * Online renderer — a real interactive Leaflet map on keyless raster tiles.
 * Lazy-loaded by StationMap so Leaflet's bundle is only fetched when actually
 * shown (offline mode never pays for it). Every marker is a vector CircleMarker
 * or a leaflet.heat canvas — no external marker-image assets are requested, so
 * the console CSP only needs the tile hosts under img-src.
 */

interface MapLeafletProps {
  stations: StationReading[];
  plume: PlumeVectorsResponse | null;
  industries?: IndustryRecord[];
  layers: MapLayers;
  style: MapStyle;
  selectedUid: string | null;
  onSelect: (uid: string | null) => void;
  onTileError: () => void;
}

// Custom panes keep the layer order deterministic: heat (overlayPane, 400) sits
// beneath the station glow/dots, industries, and fire hotspots regardless of mount timing.
function Panes() {
  const map = useMap();
  useEffect(() => {
    const spec: Array<[string, string]> = [
      ["ncrGlow", "440"],
      ["ncrStations", "450"],
      ["ncrIndustries", "455"],
      ["ncrFires", "460"],
    ];
    for (const [name, z] of spec) {
      const pane = map.getPane(name) ?? map.createPane(name);
      pane.style.zIndex = z;
    }
  }, [map]);
  return null;
}

function HeatLayer({ points }: { points: Array<[number, number, number]> }) {
  const map = useMap();
  useEffect(() => {
    const layer = heatLayer(points, {
      radius: 34,
      blur: 22,
      minOpacity: 0.28,
      max: 1,
      maxZoom: 11,
      gradient: HEAT_GRADIENT,
    });
    layer.addTo(map);
    return () => {
      map.removeLayer(layer);
    };
  }, [map, points]);
  return null;
}

/** Recenter only when the selected station is off-screen — never fight the user. */
function PanToSelected({ station }: { station: StationReading | null }) {
  const map = useMap();
  useEffect(() => {
    if (station && !map.getBounds().contains([station.lat, station.lon])) {
      map.panTo([station.lat, station.lon], { animate: true });
    }
  }, [map, station]);
  return null;
}

function ClearOnBackground({ onClear }: { onClear: () => void }) {
  useMapEvents({ click: () => onClear() });
  return null;
}

function AutoResize() {
  const map = useMap();
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}

/**
 * High-performance Industry Markers Layer
 * ---------------------------------------
 * Features:
 * 1. Progressive Radial Ingress Sweep: On layer/tier change, nodes bloom smoothly from Central Delhi outward.
 * 2. Zoom-Adaptive Density (LOD): Small elegant micro-dots at low zoom preventing clumsy blob overlap; expands to interactive precision nodes when zooming in.
 * 3. Anchor Highlights: Luminous glowing halos for major Power & WTE plants.
 */
function IndustryMarkersLayer({
  industries,
  active,
}: {
  industries: IndustryRecord[];
  active: boolean;
}) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  const [progress, setProgress] = useState(0);

  // Track map zoom changes smoothly
  useMapEvents({
    zoomend: () => setZoom(map.getZoom()),
  });

  // Calculate distance from central Delhi (28.6139, 77.2090)
  const sortedWithDist = useMemo(() => {
    const centerLat = 28.6139;
    const centerLon = 77.2090;
    const list = industries.map((ind) => {
      const d = Math.hypot(ind.latitude - centerLat, ind.longitude - centerLon);
      return { ind, dist: d };
    });
    // Sort by radial distance from center
    list.sort((a, b) => a.dist - b.dist);
    const maxDist = list.length > 0 ? list[list.length - 1].dist : 1;
    return { list, maxDist: Math.max(0.01, maxDist) };
  }, [industries]);

  // Progressive radial sweep animation on mount or when tier/data changes
  useEffect(() => {
    if (!active || industries.length === 0) {
      setProgress(0);
      return;
    }

    let start: number | null = null;
    const duration = 500; // 500ms progressive radial sweep
    let rafId: number;

    const step = (timestamp: number) => {
      if (!start) start = timestamp;
      const elapsed = timestamp - start;
      const p = Math.min(1, elapsed / duration);
      // Ease-out cubic curve
      const eased = 1 - Math.pow(1 - p, 3);
      setProgress(eased);

      if (p < 1) {
        rafId = requestAnimationFrame(step);
      }
    };

    setProgress(0.05);
    rafId = requestAnimationFrame(step);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [active, industries]);

  if (!active || industries.length === 0) return null;

  // Zoom-adaptive density scaling (LOD):
  // Zoom <= 10: delicate micro-dots (radius ~1.8-2.5px, opacity 0.65) so the city doesn't clump
  // Zoom 11-12: medium dots (radius ~3.0-4.2px)
  // Zoom >= 13: full precision interactive nodes (radius ~4.5-6.0px)
  const isZoomedOut = zoom <= 10;
  const isMidZoom = zoom > 10 && zoom <= 12;

  const baseRadiusTier1 = isZoomedOut ? 2.4 : isMidZoom ? 4.0 : 5.6;
  const baseRadiusTier2 = isZoomedOut ? 1.9 : isMidZoom ? 3.2 : 4.6;
  const baseRadiusTier3 = isZoomedOut ? 1.5 : isMidZoom ? 2.4 : 3.8;
  const anchorRadius = isZoomedOut ? 5.2 : isMidZoom ? 7.2 : 9.0;

  const baseOpacity = isZoomedOut ? 0.65 : isMidZoom ? 0.85 : 0.95;
  const strokeW = isZoomedOut ? 0.5 : 1;

  // Reveal items within the current radial threshold
  const visibleThreshold = sortedWithDist.maxDist * Math.max(0.06, progress);
  const visibleItems = sortedWithDist.list.filter(
    (item) => item.dist <= visibleThreshold || item.dist <= 0.035,
  );

  return (
    <>
      {visibleItems.map(({ ind }, i) => {
        const tierInfo = classifyIndustryTier(ind);
        const isAnchor =
          tierInfo.tier === 1 &&
          (ind.category === "power" ||
            ind.name.toLowerCase().includes("power") ||
            ind.name.toLowerCase().includes("waste to energy") ||
            ind.name.toLowerCase().includes("wte"));

        const r = isAnchor
          ? anchorRadius
          : tierInfo.tier === 1
            ? baseRadiusTier1
            : tierInfo.tier === 2
              ? baseRadiusTier2
              : baseRadiusTier3;

        const strokeColor = isAnchor
          ? "#ffffff"
          : tierInfo.tier === 1
            ? "#7f1d1d"
            : tierInfo.tier === 2
              ? "#7c2d12"
              : "#581c87";

        return (
          <Fragment key={ind.id ? `ind-${ind.id}` : `ind-${i}`}>
            {/* Soft ambient glow halo for Anchor Power & WTE plants */}
            {isAnchor && (
              <CircleMarker
                center={[ind.latitude, ind.longitude]}
                radius={r * 1.7}
                pane="ncrGlow"
                interactive={false}
                pathOptions={{
                  stroke: false,
                  fillColor: tierInfo.color,
                  fillOpacity: 0.25,
                }}
              />
            )}

            <CircleMarker
              center={[ind.latitude, ind.longitude]}
              radius={r}
              pane="ncrIndustries"
              pathOptions={{
                color: strokeColor,
                weight: isAnchor ? 2 : strokeW,
                fillColor: tierInfo.color,
                fillOpacity: isAnchor ? 1 : baseOpacity,
              }}
            >
              <Tooltip direction="top" offset={[0, -6]}>
                <div
                  style={{
                    padding: "6px 9px",
                    fontSize: "11px",
                    lineHeight: "1.45",
                    maxWidth: "240px",
                    background: "rgba(15, 23, 42, 0.95)",
                    borderRadius: "6px",
                    border: `1px solid ${tierInfo.color}66`,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                    backdropFilter: "blur(6px)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: "4px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "9.5px",
                        fontWeight: 700,
                        letterSpacing: "0.05em",
                        padding: "2px 5px",
                        borderRadius: "4px",
                        background: `${tierInfo.color}25`,
                        color: tierInfo.color,
                        border: `1px solid ${tierInfo.color}50`,
                      }}
                    >
                      {tierInfo.badge}
                    </span>
                  </div>

                  <strong
                    style={{
                      color: "#f8fafc",
                      fontSize: "12px",
                      display: "block",
                      marginBottom: "2px",
                    }}
                  >
                    {isAnchor ? "⚡ " : "🏭 "}
                    {ind.name}
                  </strong>

                  <div style={{ color: "#cbd5e1", fontSize: "11px", marginBottom: "4px" }}>
                    <strong>Sector:</strong> {ind.sector || ind.category || "Industrial Source"}
                  </div>

                  <div
                    style={{
                      fontSize: "10px",
                      color: "#fca5a5",
                      marginBottom: "4px",
                      background: "rgba(0,0,0,0.3)",
                      padding: "2px 4px",
                      borderRadius: "3px",
                    }}
                  >
                    <strong>Key Pollutants:</strong> {tierInfo.pollutants}
                  </div>

                  <div style={{ color: "#38bdf8", fontSize: "10px" }}>
                    📍 {ind.city}, {ind.state} {ind.address ? `• ${ind.address.split(",")[0]}` : ""}
                  </div>
                </div>
              </Tooltip>
            </CircleMarker>
          </Fragment>
        );
      })}
    </>
  );
}

export default function MapLeaflet({
  stations,
  plume,
  industries = [],
  layers,
  style,
  selectedUid,
  onSelect,
  onTileError,
}: MapLeafletProps) {
  const points = useMemo(() => heatPoints(stations), [stations]);
  const selected = useMemo(
    () => stations.find((s) => s.uid === selectedUid) ?? null,
    [stations, selectedUid],
  );

  return (
    <MapContainer
      className="map__leaflet"
      center={MAP_CENTER}
      zoom={MAP_ZOOM}
      minZoom={6}
      maxZoom={style.maxZoom}
      scrollWheelZoom
      worldCopyJump={false}
    >
      <TileLayer
        key={style.id}
        url={style.url}
        attribution={style.attribution}
        maxZoom={style.maxZoom}
        eventHandlers={{ tileerror: onTileError }}
      />

      <Panes />
      <AutoResize />
      <ClearOnBackground onClear={() => onSelect(null)} />
      <PanToSelected station={selected} />

      {layers.heatmap && points.length ? <HeatLayer points={points} /> : null}

      {/* Delhi anchor + 100/200/300 km reference rings */}
      {[100000, 200000, 300000].map((r) => (
        <Circle
          key={r}
          center={MAP_CENTER}
          radius={r}
          pathOptions={{ color: "#8CA3B6", weight: 1, opacity: 0.22, fill: false, dashArray: "4 5" }}
        />
      ))}
      <CircleMarker
        center={MAP_CENTER}
        radius={5}
        pathOptions={{ color: "#E9F0F6", weight: 2, fillColor: "#0A1119", fillOpacity: 1 }}
      >
        <Tooltip permanent direction="right" className="map__delhiTip" offset={[6, 0]}>
          DELHI
        </Tooltip>
      </CircleMarker>

      {/* Stubble-plume trajectories + FRP-scaled fire hotspots */}
      {layers.fires && plume
        ? plume.plumes.map((pl, i) =>
            pl.trajectory.length >= 2 ? (
              <Polyline
                key={`traj-${i}`}
                positions={pl.trajectory}
                pathOptions={{ color: "#F2892F", weight: 1.4, opacity: 0.5 }}
              />
            ) : null,
          )
        : null}
      {layers.fires && plume
        ? plume.hotspots.map((hs, i) => (
            <CircleMarker
              key={`fire-${i}`}
              center={[hs.lat, hs.lon]}
              radius={hotspotRadius(hs.frp_mw)}
              pane="ncrFires"
              pathOptions={{
                stroke: false,
                fillColor: hexLerp("#F2892F", "#E8503C", Math.min(1, hs.frp_mw / 90)),
                fillOpacity: 0.85,
              }}
            >
              <Tooltip>
                {hs.source_state} · FRP {hs.frp_mw.toFixed(0)} MW
              </Tooltip>
            </CircleMarker>
          ))
        : null}

      {/* Delhi-Only Industrial Facilities with Progressive Sweep & Zoom-Adaptive LOD */}
      <IndustryMarkersLayer
        industries={industries}
        active={Boolean(layers.industries && industries.length > 0)}
      />

      {/* Stations: a soft AQI "plume" glow behind a clickable dot */}
      {layers.stations
        ? stations.map((s) => {
            const c = aqiColor(s.aqi);
            const isSel = s.uid === selectedUid;
            const glowR = 10 + (Math.min(500, s.aqi) / 500) * 16;
            return (
              <Fragment key={s.uid}>
                <CircleMarker
                  center={[s.lat, s.lon]}
                  radius={glowR}
                  pane="ncrGlow"
                  interactive={false}
                  pathOptions={{ stroke: false, fillColor: c, fillOpacity: 0.28 }}
                />
                <CircleMarker
                  center={[s.lat, s.lon]}
                  radius={isSel ? 7 : 4.5}
                  pane="ncrStations"
                  bubblingMouseEvents={false}
                  pathOptions={{
                    color: "#E9F0F6",
                    weight: isSel ? 2 : 1,
                    fillColor: c,
                    fillOpacity: 1,
                  }}
                  eventHandlers={{ click: () => onSelect(s.uid) }}
                >
                  <Tooltip direction="top" offset={[0, -6]}>
                    {s.name} · AQI {Math.round(s.aqi)}
                  </Tooltip>
                </CircleMarker>
              </Fragment>
            );
          })
        : null}
    </MapContainer>
  );
}

