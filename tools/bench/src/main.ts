import { execFileSync, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { type AddressInfo, createServer } from "node:net";
import os from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { checkFramework } from "@wfb/conformance/check";
import {
  ROOT,
  createContainer,
  docker,
  imageName,
  listFrameworks,
  onCleanup,
  printLogs,
  removeContainer,
  runCleanups,
  waitUntilReady,
} from "@wfb/conformance/docker";
import { K6_IMAGE, type K6Params, type K6Summary, runK6 } from "./k6.ts";
import { PeakMemoryWatcher, readMemory } from "./memory.ts";
import { type BenchResult, type FrameworkResult, type Run, SCENARIOS, type Scenario } from "./result.ts";

const CONDITIONS: BenchResult["conditions"] = {
  serverCpuset: "0",
  loadCpuset: "1-3",
  vus: 50,
  repetitions: 3,
  seedCount: 100,
  warmupSeconds: 5,
  measureSeconds: 15,
};
const MIN_DOCKER_CPUS = 4;
const NETWORK = "wfb-bench";
const STARTUP_POLL_MS = 10;

/** Removes the network and anything still attached to it, e.g. leftovers of a killed run. */
function removeNetwork(): void {
  // spawnSync does not throw, so a missing network is fine.
  const attached = spawnSync("docker", ["network", "inspect", "-f", "{{range .Containers}}{{.Name}} {{end}}", NETWORK], {
    encoding: "utf8",
  });
  for (const name of attached.stdout.trim().split(/\s+/).filter(Boolean)) {
    spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
  }
  spawnSync("docker", ["network", "rm", NETWORK], { stdio: "ignore" });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

async function freePort(): Promise<number> {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  server.close();
  await once(server, "close");
  return port;
}

async function startServer(framework: string): Promise<{ container: string; host: string; startupMs: number }> {
  const host = `wfb-srv-${framework}`;
  spawnSync("docker", ["rm", "-f", host], { stdio: "ignore" });
  const port = await freePort();
  const container = createContainer([
    "--name", host,
    "--network", NETWORK,
    "--cpuset-cpus", CONDITIONS.serverCpuset,
    "-p", `127.0.0.1:${port}:3000`,
    imageName(framework),
  ]);
  try {
    const started = performance.now();
    docker("start", container);
    await waitUntilReady(`http://127.0.0.1:${port}`, container, STARTUP_POLL_MS);
    return { container, host, startupMs: performance.now() - started };
  } catch (error) {
    printLogs(container);
    removeContainer(container);
    throw error;
  }
}

async function withPeakMemory(
  container: string,
  run: () => Promise<K6Summary>,
): Promise<K6Summary & { peakMemoryBytes: number }> {
  const watcher = new PeakMemoryWatcher(container);
  try {
    const summary = await run();
    return { ...summary, peakMemoryBytes: watcher.peak() };
  } finally {
    watcher.stop();
  }
}

async function measure(framework: string, scenario: Scenario, repetition: number): Promise<Run> {
  const { container, host, startupMs } = await startServer(framework);
  const k6 = async (p: Omit<K6Params, "network" | "cpuset" | "baseUrl" | "vus">) => {
    const started = performance.now();
    const summary = await runK6({ network: NETWORK, cpuset: CONDITIONS.loadCpuset, baseUrl: `http://${host}:3000`, vus: CONDITIONS.vus, ...p });
    console.log(`  ${p.scenario}: ${summary.requests} requests in ${((performance.now() - started) / 1000).toFixed(1)}s`);
    return summary;
  };
  try {
    const seeded = CONDITIONS.seedCount;
    await k6({ scenario: "seed", iterations: seeded });
    await sleep(1_000);
    const idleMemoryBytes = readMemory(container);
    await k6({ scenario, seeded, duration: `${CONDITIONS.warmupSeconds}s` });
    const summary = await withPeakMemory(container, () => k6({ scenario, seeded, duration: `${CONDITIONS.measureSeconds}s` }));
    return { repetition, scenario, startupMs, idleMemoryBytes, ...summary };
  } catch (error) {
    printLogs(container);
    throw error;
  } finally {
    removeContainer(container);
  }
}

function aggregate(name: string, runtimeVersion: string, runs: Run[]): FrameworkResult {
  const scenarios = {} as FrameworkResult["scenarios"];
  for (const scenario of SCENARIOS) {
    const rs = runs.filter((r) => r.scenario === scenario);
    const m = (pick: (r: Run) => number) => median(rs.map(pick));
    scenarios[scenario] = {
      rps: m((r) => r.rps),
      latencyMs: {
        avg: m((r) => r.latencyMs.avg),
        p50: m((r) => r.latencyMs.p50),
        p90: m((r) => r.latencyMs.p90),
        p99: m((r) => r.latencyMs.p99),
        max: m((r) => r.latencyMs.max),
      },
      peakMemoryBytes: m((r) => r.peakMemoryBytes),
    };
  }
  return {
    name,
    runtimeVersion,
    startupMs: median(runs.map((r) => r.startupMs)),
    idleMemoryBytes: median(runs.map((r) => r.idleMemoryBytes)),
    scenarios,
    runs,
  };
}

function collectEnvironment(): BenchResult["environment"] {
  const macVersion = os.platform() === "darwin" ? execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).trim() : "";
  return {
    os: macVersion ? `macOS ${macVersion}` : `${os.type()} ${os.release()}`,
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    hostCpus: os.cpus().length,
    hostMemoryBytes: os.totalmem(),
    dockerVersion: docker("version", "--format", "{{.Server.Version}}"),
    dockerCpus: Number(docker("info", "--format", "{{.NCPU}}")),
    dockerMemoryBytes: Number(docker("info", "--format", "{{.MemTotal}}")),
    k6Image: K6_IMAGE,
    otherContainers: docker("ps", "--format", "{{.Names}}").split("\n").filter(Boolean),
  };
}

function printSummary(result: BenchResult): void {
  const mb = (bytes: number) => (bytes / 1024 ** 2).toFixed(1);
  for (const f of result.frameworks) {
    console.log(`\n${f.name} (${f.runtimeVersion}) startup ${f.startupMs.toFixed(0)}ms, idle ${mb(f.idleMemoryBytes)}MiB`);
    console.table(
      Object.fromEntries(
        SCENARIOS.map((s) => {
          const r = f.scenarios[s];
          return [s, { rps: Math.round(r.rps), "p99 ms": r.latencyMs.p99.toFixed(2), "peak MiB": mb(r.peakMemoryBytes) }];
        }),
      ),
    );
  }
}

function parseArgs(argv: string[]): { tryMode: boolean; names: string[] } {
  if (argv[0] === "--try") {
    if (argv.length === 1) throw new Error("--try needs at least one framework name");
    return { tryMode: true, names: argv.slice(1) };
  }
  if (argv.length > 0) throw new Error(`unexpected arguments: ${argv.join(" ")} (use --try <name...>)`);
  return { tryMode: false, names: [] };
}

async function main(): Promise<void> {
  const { tryMode, names } = parseArgs(process.argv.slice(2));
  const available = listFrameworks();
  const unknown = names.filter((n) => !available.includes(n));
  if (unknown.length > 0) throw new Error(`unknown framework(s): ${unknown.join(", ")} (available: ${available.join(", ")})`);
  const frameworks = names.length > 0 ? names : available;
  if (frameworks.length === 0) throw new Error("no frameworks found");

  const environment = collectEnvironment();
  if (environment.dockerCpus < MIN_DOCKER_CPUS) {
    throw new Error(`Docker has ${environment.dockerCpus} CPUs; at least ${MIN_DOCKER_CPUS} are needed to separate server and load`);
  }

  if (environment.otherContainers.length > 0) {
    console.warn(`warning: other containers are running and may skew results: ${environment.otherContainers.join(", ")}`);
  }

  for (const name of frameworks) {
    if (!(await checkFramework(name))) throw new Error(`${name} failed conformance; not benchmarking`);
  }

  removeNetwork();
  docker("network", "create", NETWORK);
  onCleanup(removeNetwork);

  const repetitions = tryMode ? 1 : CONDITIONS.repetitions;
  const startedAt = new Date().toISOString();
  const runs = new Map<string, Run[]>(frameworks.map((n) => [n, []]));
  const total = repetitions * frameworks.length * SCENARIOS.length;
  let done = 0;
  // Frameworks are interleaved per repetition so that drift over a long session hits them evenly.
  for (let repetition = 1; repetition <= repetitions; repetition++) {
    for (const name of frameworks) {
      for (const scenario of SCENARIOS) {
        console.log(`[${++done}/${total}] ${name} ${scenario} (repetition ${repetition})`);
        runs.get(name)!.push(await measure(name, scenario, repetition));
      }
    }
  }

  const result: BenchResult = {
    schemaVersion: 1,
    startedAt,
    finishedAt: new Date().toISOString(),
    environment,
    conditions: { ...CONDITIONS, repetitions },
    frameworks: frameworks.map((name) =>
      aggregate(name, docker("run", "--rm", "--entrypoint", "node", imageName(name), "--version"), runs.get(name)!),
    ),
  };
  printSummary(result);

  if (tryMode) {
    console.log("\ntry mode: results were not saved");
    return;
  }
  const dir = join(ROOT, "results");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${startedAt.slice(0, 19).replace(/:/g, "-")}Z.json`);
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`\nsaved ${file}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  runCleanups();
}
