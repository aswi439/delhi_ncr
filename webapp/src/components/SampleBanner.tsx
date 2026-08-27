import type { SampleState } from "@/hooks/useForecastData";
import type { ScenarioId } from "@/lib/types";

interface SampleBannerProps {
  sample?: SampleState;
  onScenario?: (id: ScenarioId) => void;
}

export function SampleBanner(_props: SampleBannerProps) {
  // Completely disabled and removed as per user design specification
  return null;
}
