import { Button } from "@/components/ui/button";
import type { SampleState } from "@/hooks/useForecastData";
import type { ScenarioId } from "@/lib/types";

interface SampleBannerProps {
  sample: SampleState;
  onScenario: (id: ScenarioId) => void;
}

/**
 * The sample-data banner. Hidden entirely in live mode; when the console is
 * running on the frozen sample it is impossible to miss, carries the honest
 * disclaimer verbatim from the bundle, and offers the scenario switcher.
 */
export function SampleBanner({ sample, onScenario }: SampleBannerProps) {
  if (!sample.active) return null;

  return (
    <div className="banner">
      <div className="banner__inner">
        <strong className="banner__tag">Sample data</strong>
        <span className="banner__text">{sample.note}</span>
        <div className="banner__scenarios" role="group" aria-label="Sample scenario">
          {sample.scenarios.map((s) => (
            <Button
              key={s.id}
              variant="ghost"
              aria-pressed={sample.scenarioId === s.id}
              title={s.blurb}
              onClick={() => onScenario(s.id)}
            >
              {s.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
