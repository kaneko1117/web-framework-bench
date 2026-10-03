import exec from "k6/execution";
import http from "k6/http";

const BASE_URL = __ENV.BASE_URL;
const SCENARIO = __ENV.SCENARIO;
const VUS = Number(__ENV.VUS);
const DURATION = __ENV.DURATION;
const ITERATIONS = Number(__ENV.ITERATIONS || 0);
const SEEDED = Number(__ENV.SEEDED || 0);
// 番号入りの URL は記録上1つの名前にまとめる。URL ごとに記録すると k6 のメモリが尽きる。
const COLLECTION = { tags: { name: "/tasks" } };
const ITEM = { tags: { name: "/tasks/:id" } };
const JSON_HEADERS = { "content-type": "application/json" };

export const options = {
  discardResponseBodies: true,
  summaryTrendStats: ["avg", "med", "p(90)", "p(99)", "max"],
  scenarios: {
    main:
      ITERATIONS > 0
        ? { executor: "shared-iterations", vus: VUS, iterations: ITERATIONS, maxDuration: "10m" }
        : { executor: "constant-vus", vus: VUS, duration: DURATION },
  },
};

/** 投入したタスク(1..SEEDED)からランダムに番号を選ぶ。 */
function randomSeededId() {
  return Math.floor(Math.random() * SEEDED) + 1;
}

/** 操作ごとに1回分のリクエスト。`seed` は計測前のデータ投入用。 */
const actions = {
  seed: () => http.post(`${BASE_URL}/tasks`, JSON.stringify({ title: `seed-${exec.scenario.iterationInTest}` }), { ...COLLECTION, headers: JSON_HEADERS }),
  create: () => http.post(`${BASE_URL}/tasks`, JSON.stringify({ title: "bench", done: false }), { ...COLLECTION, headers: JSON_HEADERS }),
  list: () => http.get(`${BASE_URL}/tasks`, COLLECTION),
  get: () => http.get(`${BASE_URL}/tasks/${randomSeededId()}`, ITEM),
  update: () => http.put(`${BASE_URL}/tasks/${randomSeededId()}`, JSON.stringify({ title: "updated", done: true }), { ...ITEM, headers: JSON_HEADERS }),
};

export default actions[SCENARIO];

/** 指揮役に渡すため、集計結果を JSON 1行で出す。 */
export function handleSummary(data) {
  const reqs = data.metrics.http_reqs.values;
  const duration = data.metrics.http_req_duration.values;
  const result = {
    requests: reqs.count,
    rps: reqs.rate,
    failedRate: data.metrics.http_req_failed.values.rate,
    latencyMs: { avg: duration.avg, p50: duration.med, p90: duration["p(90)"], p99: duration["p(99)"], max: duration.max },
  };
  return { stdout: JSON.stringify(result) };
}
