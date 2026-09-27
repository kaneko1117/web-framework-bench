import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const FRAMEWORKS_DIR = join(ROOT, "frameworks");
const TEST_FILE = fileURLToPath(new URL("./tasks.test.ts", import.meta.url));
const READY_TIMEOUT_MS = 30_000;
const TEST_TIMEOUT_MS = 10_000;

let runningContainer: string | undefined;

function docker(...args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function removeContainer(): void {
  if (runningContainer === undefined) return;
  execFileSync("docker", ["rm", "-f", runningContainer], { stdio: "ignore" });
  runningContainer = undefined;
}

process.on("SIGINT", () => {
  removeContainer();
  process.exit(130);
});

function listFrameworks(): string[] {
  const names: string[] = [];
  for (const entry of readdirSync(FRAMEWORKS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (existsSync(join(FRAMEWORKS_DIR, entry.name, "Dockerfile"))) names.push(entry.name);
    else console.warn(`skipping frameworks/${entry.name}: no Dockerfile`);
  }
  return names.sort();
}

async function waitUntilReady(baseUrl: string, container: string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (docker("inspect", "-f", "{{.State.Running}}", container) !== "true") {
      throw new Error("container exited before becoming ready");
    }
    try {
      const res = await fetch(`${baseUrl}/tasks`, { signal: AbortSignal.timeout(1_000) });
      if (res.status === 200) return;
    } catch {
      // not listening yet
    }
    await sleep(100);
  }
  throw new Error(`server did not answer GET /tasks with 200 within ${READY_TIMEOUT_MS}ms`);
}

async function runTests(baseUrl: string): Promise<boolean> {
  const child = spawn(process.execPath, ["--test", `--test-timeout=${TEST_TIMEOUT_MS}`, TEST_FILE], {
    stdio: "inherit",
    env: { ...process.env, BASE_URL: baseUrl },
  });
  const [code] = await once(child, "exit");
  return code === 0;
}

async function check(name: string): Promise<boolean> {
  const image = `wfb-${name}`;
  console.log(`\n== ${name} ==`);
  try {
    execFileSync("docker", ["build", "-q", "-t", image, join(FRAMEWORKS_DIR, name)], {
      stdio: ["ignore", "ignore", "inherit"],
    });
    runningContainer = docker("run", "-d", "-p", "127.0.0.1::3000", image);
    const port = docker("port", runningContainer, "3000/tcp").split(":").pop();
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitUntilReady(baseUrl, runningContainer);
    return await runTests(baseUrl);
  } catch (error) {
    console.error(`${name}: ${error instanceof Error ? error.message : error}`);
    if (runningContainer !== undefined) {
      console.error("--- container logs ---");
      execFileSync("docker", ["logs", runningContainer], { stdio: ["ignore", "inherit", "inherit"] });
    }
    return false;
  } finally {
    removeContainer();
  }
}

const requested = process.argv.slice(2);
const available = listFrameworks();
if (available.length === 0) {
  console.error("no frameworks found");
  process.exit(2);
}
const unknown = requested.filter((n) => !available.includes(n));
if (unknown.length > 0) {
  console.error(`unknown framework(s): ${unknown.join(", ")} (available: ${available.join(", ")})`);
  process.exit(2);
}

const failed: string[] = [];
for (const name of requested.length > 0 ? requested : available) {
  if (!(await check(name))) failed.push(name);
}
if (failed.length > 0) {
  console.error(`\nconformance failed: ${failed.join(", ")}`);
  process.exit(1);
}
console.log("\nall frameworks passed");
