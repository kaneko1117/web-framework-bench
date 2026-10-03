import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import {
  buildImage,
  createContainer,
  docker,
  imageName,
  printLogs,
  publishedUrl,
  removeContainer,
  waitUntilReady,
} from "./docker.ts";

const TEST_FILE = fileURLToPath(new URL("./tasks.test.ts", import.meta.url));
const TEST_TIMEOUT_MS = 10_000;

/** baseUrl に仕様チェックを流す。全部合格なら true。 */
async function runTests(baseUrl: string): Promise<boolean> {
  const child = spawn(process.execPath, ["--test", `--test-timeout=${TEST_TIMEOUT_MS}`, TEST_FILE], {
    stdio: "inherit",
    env: { ...process.env, BASE_URL: baseUrl },
  });
  const [code] = await once(child, "exit");
  return code === 0;
}

/** フレームワークの箱を作り、仕様チェックを流す。 */
export async function checkFramework(name: string): Promise<boolean> {
  console.log(`\n== ${name} ==`);
  let container: string | undefined;
  try {
    buildImage(name);
    container = createContainer(["-p", "127.0.0.1::3000", imageName(name)]);
    docker("start", container);
    const baseUrl = publishedUrl(container);
    await waitUntilReady(baseUrl, container);
    return await runTests(baseUrl);
  } catch (error) {
    console.error(`${name}: ${error instanceof Error ? error.message : error}`);
    if (container !== undefined) printLogs(container);
    return false;
  } finally {
    if (container !== undefined) removeContainer(container);
  }
}
