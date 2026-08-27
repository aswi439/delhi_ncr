import { Fragment, useEffect, useMemo } from "react";
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

      {/* Delhi-Only Industrial Facilities & Power Stations with 3-Stage Pollution Tiers */}
      {layers.industries && industries.length > 0
        ? industries.map((ind, i) => {
            const tierInfo = classifyIndustryTier(ind);
            const isAnchor = tierInfo.tier === 1 && (ind.category === "power" || ind.name.toLowerCase().includes("power") || ind.name.toLowerCase().includes("waste to energy") || ind.name.toLowerCase().includes("wte"));
            
            const radius = isAnchor ? 7 : tierInfo.tier === 1 ? 5 : tierInfo.tier === 2 ? 4.2 : 3.6;
            const strokeColor = isAnchor ? "#ffffff" : tierInfo.tier === 1 ? "#7f1d1d" : tierInfo.tier === 2 ? "#7c2d12" : "#581c87";

            return (
              <CircleMarker
                key={ind.id ? `ind-${ind.id}` : `ind-${i}`}
                center={[ind.latitude, ind.longitude]}
                radius={radius}
                pane="ncrIndustries"
                pathOptions={{
                  color: strokeColor,
                  weight: isAnchor ? 2 : 1,
                  fillColor: tierInfo.color,
                  fillOpacity: tierInfo.tier === 1 ? 0.95 : 0.85,
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
                    }}
                  >
                    {/* Header: Tier Badge */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
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

                    {/* Facility Name */}
                    <strong style={{ color: "#f8fafc", fontSize: "12px", display: "block", marginBottom: "2px" }}>
                      {isAnchor ? "⚡ " : "🏭 "}{ind.name}
                    </strong>

                    {/* Sector & Category */}
                    <div style={{ color: "#cbd5e1", fontSize: "11px", marginBottom: "4px" }}>
                      <strong>Sector:</strong> {ind.sector || ind.category || "Industrial Source"}
                    </div>

                    {/* Key Pollutants */}
                    <div style={{ fontSize: "10px", color: "#fca5a5", marginBottom: "4px", background: "rgba(0,0,0,0.3)", padding: "2px 4px", borderRadius: "3px" }}>
                      <strong>Key Pollutants:</strong> {tierInfo.pollutants}
                    </div>

                    {/* Location */}
                    <div style={{ color: "#38bdf8", fontSize: "10px" }}>
                      📍 {ind.city}, {ind.state} {ind.address ? `• ${ind.address.split(",")[0]}` : ""}
                    </div>
                  </div>
                </Tooltip>
              </CircleMarker>
            );
          })
        : null}

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

