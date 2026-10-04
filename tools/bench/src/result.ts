export const SCENARIOS = ["create", "list", "get", "update"] as const;
export type Scenario = (typeof SCENARIOS)[number];

export type Latency = { avg: number; p50: number; p90: number; p99: number; max: number };

export type ScenarioResult = {
  rps: number;
  latencyMs: Latency;
  peakMemoryBytes: number;
};

/** 1つの操作を、起動から片付けまで1回測った結果。 */
export type Run = ScenarioResult & {
  repetition: number;
  scenario: Scenario;
  requests: number;
  startupMs: number;
  idleMemoryBytes: number;
};

/** 動かさずに分かる数字。 */
export type StaticMetrics = {
  imageBytes: number;
  /** どちらも箱の中で数えた展開後のサイズ。app はアプリの置き場所(WORKDIR)の分。 */
  appImageBytes: number;
  sourceLines: number;
  /** total は芋づる式に入るものを含む本番用の数(版違いの重複も数える)、direct は package.json に書いた数。 */
  dependencies: { total: number; direct: number };
};

export type FrameworkResult = {
  name: string;
  runtimeVersion: string;
  static: StaticMetrics;
  /** 全回の真ん中の値。 */
  startupMs: number;
  idleMemoryBytes: number;
  scenarios: Record<Scenario, ScenarioResult>;
  runs: Run[];
};

export type BenchResult = {
  schemaVersion: 2;
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
    /** 計測開始時にすでに動いていた箱。 */
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
