export const SCENARIOS = ["create", "list", "get", "update"] as const;
export type Scenario = (typeof SCENARIOS)[number];

export type Latency = { avg: number; p50: number; p90: number; p99: number; max: number };

export type ScenarioResult = {
  rps: number;
  latencyMs: Latency;
  peakMemoryBytes: number;
};

/** One start-to-stop measurement of a single scenario. */
export type Run = ScenarioResult & {
  repetition: number;
  scenario: Scenario;
  requests: number;
  startupMs: number;
  idleMemoryBytes: number;
};

export type FrameworkResult = {
  name: string;
  runtimeVersion: string;
  /** Medians across all runs. */
  startupMs: number;
  idleMemoryBytes: number;
  scenarios: Record<Scenario, ScenarioResult>;
  runs: Run[];
};

export type BenchResult = {
  schemaVersion: 1;
  startedAt: string;
  finishedAt: string;
  environment: {
    os: string;
    cpuModel: string;
    hostCpus: number;
    hostMemoryBytes: number;
    dockerVersion: string;
    dockerCpus: number;
    dockerMemoryBytes: number;
    k6Image: string;
    /** Containers that were already running when the benchmark started. */
    otherContainers: string[];
  };
  conditions: {
    serverCpuset: string;
    loadCpuset: string;
    vus: number;
    repetitions: number;
    seedCount: number;
    warmupSeconds: number;
    measureSeconds: number;
  };
  frameworks: FrameworkResult[];
};
