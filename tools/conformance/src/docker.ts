import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const FRAMEWORKS_DIR = join(ROOT, "frameworks");
const READY_TIMEOUT_MS = 30_000;
const execFileAsync = promisify(execFile);

const cleanups: Array<() => void> = [];
const containers = new Set<string>();

for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]] as const) {
  process.on(signal, () => {
    runCleanups();
    process.exit(code);
  });
}

/** Ctrl-C で止めたときにも、普通に終わったときにも行う後片付けを登録する。 */
export function onCleanup(fn: () => void): void {
  cleanups.push(fn);
}

/** 覚えている箱をすべて消し、登録された後片付けを行う。 */
export function runCleanups(): void {
  for (const id of containers) removeContainer(id);
  for (const fn of cleanups.splice(0)) fn();
}

/** docker コマンドを実行し、出力を返す。 */
export function docker(...args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** frameworks/ の下で Dockerfile があるフォルダを並べる。 */
export function listFrameworks(): string[] {
  const names: string[] = [];
  for (const entry of readdirSync(FRAMEWORKS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (existsSync(join(FRAMEWORKS_DIR, entry.name, "Dockerfile"))) names.push(entry.name);
    else console.warn(`skipping frameworks/${entry.name}: no Dockerfile`);
  }
  return names.sort();
}

/** フレームワークの箱の名前。 */
export function imageName(framework: string): string {
  return `wfb-${framework}`;
}

/** フレームワークのフォルダから箱を作る。 */
export function buildImage(framework: string): void {
  execFileSync("docker", ["build", "-q", "-t", imageName(framework), join(FRAMEWORKS_DIR, framework)], {
    stdio: ["ignore", "ignore", "inherit"],
  });
}

/** 箱を作る(起動はしない)。runCleanups() で消す対象として覚えておく。 */
export function createContainer(args: string[]): string {
  const id = docker("create", ...args);
  containers.add(id);
  return id;
}

/** 箱を強制的に消し、覚えておく対象から外す。 */
export function removeContainer(id: string): void {
  execFileSync("docker", ["rm", "-f", id], { stdio: "ignore" });
  containers.delete(id);
}

/** 失敗の原因を探せるよう、箱の記録を表示する。 */
export function printLogs(id: string): void {
  console.error("--- container logs ---");
  execFileSync("docker", ["logs", id], { stdio: ["ignore", "inherit", "inherit"] });
}

/** 箱の 3000番に Mac 側からつなぐ URL。 */
export function publishedUrl(id: string): string {
  const port = docker("port", id, "3000/tcp").split(":").pop();
  return `http://127.0.0.1:${port}`;
}

/** GET /tasks が 200 を返すまで待つ。箱が止まるか時間切れなら失敗。 */
export async function waitUntilReady(baseUrl: string, id: string, intervalMs = 100): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  // 箱が生きているかの確認は裏で行い、準備完了に気づくのを遅らせない。
  let exited = false;
  let checking = false;
  let nextStateCheck = Date.now() + 500;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/tasks`, { signal: AbortSignal.timeout(1_000) });
      if (res.status === 200) return;
    } catch {
      // まだ受け付けていない
    }
    if (exited) throw new Error("container exited before becoming ready");
    if (!checking && Date.now() >= nextStateCheck) {
      checking = true;
      execFileAsync("docker", ["inspect", "-f", "{{.State.Running}}", id])
        .then(({ stdout }) => (exited = stdout.trim() !== "true"))
        .catch(() => (exited = true))
        .finally(() => {
          checking = false;
          nextStateCheck = Date.now() + 500;
        });
    }
    await sleep(intervalMs);
  }
  throw new Error(`server did not answer GET /tasks with 200 within ${READY_TIMEOUT_MS}ms`);
}
