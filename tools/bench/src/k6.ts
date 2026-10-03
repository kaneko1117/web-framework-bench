import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import type { Latency } from "./result.ts";

export const K6_IMAGE = "grafana/k6:2.3.0";
const SCRIPT_DIR = fileURLToPath(new URL("../k6/", import.meta.url));

export type K6Params = {
  network: string;
  cpuset: string;
  baseUrl: string;
  scenario: string;
  vus: number;
  /** Either a fixed duration or a fixed number of iterations. */
  duration?: string;
  iterations?: number;
  seeded?: number;
};

export type K6Summary = { requests: number; rps: number; latencyMs: Latency };

/** Runs k6 without blocking the event loop, so watchers keep receiving data meanwhile. */
export async function runK6(p: K6Params): Promise<K6Summary> {
  const env = {
    BASE_URL: p.baseUrl,
    SCENARIO: p.scenario,
    VUS: p.vus,
    DURATION: p.duration ?? "",
    ITERATIONS: p.iterations ?? 0,
    SEEDED: p.seeded ?? 0,
  };
  const args = ["run", "--rm", "--network", p.network, "--cpuset-cpus", p.cpuset, "-v", `${SCRIPT_DIR}:/scripts:ro`];
  for (const [key, value] of Object.entries(env)) args.push("-e", `${key}=${value}`);
  args.push(K6_IMAGE, "run", "-q", "/scripts/scenario.js");

  const child = spawn("docker", args, { stdio: ["ignore", "pipe", "inherit"] });
  let stdout = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
  // "close" waits for stdout to drain, unlike "exit".
  const [code] = await once(child, "close");
  if (code !== 0) throw new Error(`k6 ${p.scenario} exited with code ${code}`);
  const summary = JSON.parse(stdout.trim().split("\n").pop()!) as K6Summary & { failedRate: number };
  if (summary.failedRate > 0) {
    throw new Error(`${p.scenario}: ${(summary.failedRate * 100).toFixed(2)}% of requests failed`);
  }
  if (p.iterations && summary.requests !== p.iterations) {
    throw new Error(`${p.scenario}: k6 stopped after ${summary.requests} of ${p.iterations} iterations`);
  }
  return { requests: summary.requests, rps: summary.rps, latencyMs: summary.latencyMs };
}
