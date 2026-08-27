import { useCallback, useEffect, useRef, useState } from "react";

import {
  getForecast,
  getHealth,
  getInversion,
  getOverview,
  getPlume,
  getStations,
  loadSample,
  readSampleParam,
} from "@/lib/api";
import type {
  CityOverview,
  ForecastResponse,
  InversionStatus,
  PlumeVectorsResponse,
  SampleBundle,
  ScenarioId,
  StationReading,
} from "@/lib/types";

// ── Panel state ───────────────────────────────────────────────────────────────

export type PanelStatus = "loading" | "ok" | "error";

export interface Panel<T> {
  status: PanelStatus;
  data: T | null;
  error: string | null;
}

function loading<T>(): Panel<T> {
  return { status: "loading", data: null, error: null };
}
function ok<T>(data: T): Panel<T> {
  return { status: "ok", data, error: null };
}
function failed<T>(error: string): Panel<T> {
  return { status: "error", data: null, error };
}

// ── Boot overlay staging ────────────────────────────────────────────────────

export type StepKey = "api" | "met" | "inv" | "fire" | "obs";
export type StepState = "pending" | "ok" | "fail";

export const BOOT_STEP_ORDER: readonly StepKey[] = ["api", "met", "inv", "fire", "obs"];

export const BOOT_STEP_LABEL: Record<StepKey, string> = {
  api: "reach forecast service",
  met: "meteorology · coupled column",
  inv: "inversion diagnostics",
  fire: "fire detections · plume transport",
  obs: "live station network",
};

export interface BootState {
  steps: Record<StepKey, StepState>;
  message: string;
  error: string | null;
}

function freshBoot(): BootState {
  return {
    steps: { api: "pending", met: "pending", inv: "pending", fire: "pending", obs: "pending" },
    message: "reaching forecast service",
    error: null,
  };
}

// ── Rail feed LEDs ────────────────────────────────────────────────────────────

export type Led = "on" | "off" | "pending" | "sample";

export interface Feeds {
  met: Led; // open-meteo
  obs: Led; // openaq
  fire: Led; // firms
}

// ── Scenario metadata (for the sample banner switcher) ────────────────────────

export interface ScenarioMeta {
  id: ScenarioId;
  label: string;
  blurb: string;
}

export interface SampleState {
  active: boolean;
  note: string;
  scenarioId: ScenarioId | null;
  scenarios: ScenarioMeta[];
}

// ── Hook return ───────────────────────────────────────────────────────────────

export interface ForecastData {
  mode: "live" | "sample";
  ready: boolean;
  boot: BootState;
  sample: SampleState;
  forecast: Panel<ForecastResponse>;
  inversion: Panel<InversionStatus[]>;
  plume: Panel<PlumeVectorsResponse>;
  overview: Panel<CityOverview>;
  stations: Panel<StationReading[]>;
  feeds: Feeds;
  setScenario: (id: ScenarioId) => void;
  refresh: () => void;
}

const DEFAULT_SCENARIO: ScenarioId = "november";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Reflect the chosen scenario in the URL without reloading. */
function syncSampleUrl(id: ScenarioId) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("sample", id);
    window.history.replaceState(null, "", url.toString());
  } catch {
    /* history may be unavailable in some embeds — non-fatal */
  }
}

export function useForecastData(): ForecastData {
  const [mode, setMode] = useState<"live" | "sample">("live");
  const [ready, setReady] = useState(false);
  const [boot, setBoot] = useState<BootState>(freshBoot);

  const [forecast, setForecast] = useState<Panel<ForecastResponse>>(loading);
  const [inversion, setInversion] = useState<Panel<InversionStatus[]>>(loading);
  const [plume, setPlume] = useState<Panel<PlumeVectorsResponse>>(loading);
  const [overview, setOverview] = useState<Panel<CityOverview>>(loading);
  const [stations, setStations] = useState<Panel<StationReading[]>>(loading);

  const [sample, setSample] = useState<SampleState>({
    active: false,
    note: "",
    scenarioId: null,
    scenarios: [],
  });

  const abortRef = useRef<AbortController | null>(null);
  const bundleRef = useRef<SampleBundle | null>(null);

  const setStep = useCallback((key: StepKey, state: StepState) => {
    setBoot((b) => ({ ...b, steps: { ...b.steps, [key]: state } }));
  }, []);

  const applyScenario = useCallback(
    (bundle: SampleBundle, id: ScenarioId) => {
      const sc = bundle.scenarios.find((s) => s.id === id) ?? bundle.scenarios[0];
      if (!sc) {
        setForecast(failed("Sample bundle contained no scenarios."));
        setBoot((b) => ({ ...b, error: "Sample bundle malformed." }));
        return;
      }
      setForecast(ok(sc.forecast));
      setInversion(ok(sc.inversion));
      setPlume(ok(sc.plume));
      setMode("sample");
      setSample({
        active: true,
        note: bundle.note,
        scenarioId: sc.id,
        scenarios: bundle.scenarios.map((s) => ({ id: s.id, label: s.label, blurb: s.blurb })),
      });
      setStep("met", "ok");
      setStep("inv", "ok");
      setStep("fire", "ok");
      setReady(true);
      syncSampleUrl(sc.id);
    },
    [setStep],
  );

  /** Load the sample bundle (cached) and apply a scenario. */
  const goSample = useCallback(
    async (id: ScenarioId, signal: AbortSignal) => {
      try {
        let bundle = bundleRef.current;
        if (!bundle) {
          bundle = await loadSample(signal);
          bundleRef.current = bundle;
        }
        if (signal.aborted) return;
        applyScenario(bundle, id);
      } catch (e) {
        if (signal.aborted) return;
        const m = errMsg(e);
        setForecast(failed(`Sample forecast unavailable: ${m}`));
        setBoot((b) => ({ ...b, error: `Could not load the sample bundle: ${m}` }));
        setReady(true); // let the console render its error states rather than hang on boot
      }
    },
    [applyScenario],
  );

  const loadLivePanels = useCallback(
    async (signal: AbortSignal, opts: { modelled: boolean }) => {
      const tasks: Promise<void>[] = [];

      // Inversion + plume are modelled feeds; in sample-fallback mode they come
      // from the bundle, so only fetch them live when the live forecast succeeded.
      if (opts.modelled) {
        tasks.push(
          getInversion(signal)
            .then((d) => {
              if (!signal.aborted) {
                setInversion(ok(d));
                setStep("inv", "ok");
              }
            })
            .catch((e) => {
              if (!signal.aborted) {
                setInversion(failed(errMsg(e)));
                setStep("inv", "fail");
              }
            }),
        );
        tasks.push(
          getPlume(signal)
            .then((d) => {
              if (!signal.aborted) {
                setPlume(ok(d));
                setStep("fire", "ok");
              }
            })
            .catch((e) => {
              if (!signal.aborted) {
                setPlume(failed(errMsg(e)));
                setStep("fire", "fail");
              }
            }),
        );
      }

      // Live station observations are independent of the model and are attempted
      // in both modes — a sample forecast never fabricates a live network.
      tasks.push(
        getStations(signal)
          .then((d) => {
            if (!signal.aborted) {
              setStations(ok(d));
              setStep("obs", "ok");
            }
          })
          .catch((e) => {
            if (!signal.aborted) {
              setStations(failed(errMsg(e)));
              setStep("obs", "fail");
            }
          }),
      );
      tasks.push(
        getOverview(signal)
          .then((d) => {
            if (!signal.aborted) setOverview(ok(d));
          })
          .catch((e) => {
            if (!signal.aborted) setOverview(failed(errMsg(e)));
          }),
      );

      await Promise.allSettled(tasks);
    },
    [setStep],
  );

  const load = useCallback(async () => {
    // Cancel any in-flight run and start clean.
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const { signal } = ctrl;

    setReady(false);
    setBoot(freshBoot());
    setForecast(loading());
    setInversion(loading());
    setPlume(loading());
    setOverview(loading());
    setStations(loading());
    setMode("live");
    setSample({ active: false, note: "", scenarioId: null, scenarios: [] });

    // Forced sample via ?sample=… — never touches the live forecast, but still
    // shows the live station grid when it is reachable.
    const forced = readSampleParam();
    if (forced) {
      setBoot((b) => ({ ...b, message: "loading sample scenario" }));
      await goSample(forced, signal);
      await loadLivePanels(signal, { modelled: false });
      return;
    }

    // 1 — reach the service.
    try {
      await getHealth(signal);
      if (signal.aborted) return;
      setStep("api", "ok");
    } catch {
      if (signal.aborted) return;
      setStep("api", "fail");
    }

    // 2 — the core: 72-hour coupled forecast.
    setBoot((b) => ({ ...b, message: "solving coupled column" }));
    let modelled = false;
    try {
      const f = await getForecast({}, signal);
      if (signal.aborted) return;
      setForecast(ok(f));
      setStep("met", "ok");
      setReady(true); // boot can lift; remaining panels fill in behind skeletons
      modelled = true;
    } catch (e) {
      if (signal.aborted) return;
      setStep("met", "fail");
      setBoot((b) => ({
        ...b,
        message: "live forecast unavailable — loading sample",
        error: `Live forecast unavailable (${errMsg(e)}). Showing a labelled sample instead.`,
      }));
      await goSample(DEFAULT_SCENARIO, signal);
      if (signal.aborted) return;
    }

    // 3 — the independent feeds.
    await loadLivePanels(signal, { modelled });
  }, [goSample, loadLivePanels, setStep]);

  const setScenario = useCallback(
    (id: ScenarioId) => {
      const bundle = bundleRef.current;
      if (bundle) {
        applyScenario(bundle, id); // swap from cache, no refetch
      } else {
        // Bundle not yet loaded (shouldn't happen while switcher is visible) — fetch it.
        const ctrl = new AbortController();
        void goSample(id, ctrl.signal);
      }
    },
    [applyScenario, goSample],
  );

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  // Derive rail LEDs from panel + mode state.
  const ledFor = (p: PanelStatus): Led => (p === "ok" ? "on" : p === "error" ? "off" : "pending");
  const feeds: Feeds = {
    met: mode === "sample" ? "sample" : ledFor(forecast.status),
    fire: mode === "sample" ? "sample" : ledFor(plume.status),
    obs: ledFor(stations.status),
  };

  return {
    mode,
    ready,
    boot,
    sample,
    forecast,
    inversion,
    plume,
    overview,
    stations,
    feeds,
    setScenario,
    refresh,
  };
}
