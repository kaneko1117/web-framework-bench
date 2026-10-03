import { type ChildProcess, spawn } from "node:child_process";
import { docker } from "@wfb/conformance/docker";

const UNITS: Record<string, number> = {
  B: 1,
  KiB: 1024,
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
  kB: 1e3,
  MB: 1e6,
  GB: 1e9,
};

/** `docker stats` のメモリ表示(例 "45.2MiB / 5.786GiB")から使用量を読む。 */
export function parseMemUsage(text: string): number {
  const match = /([\d.]+)\s*([KMG]i?B|kB|B)/.exec(text);
  if (!match) throw new Error(`unexpected MemUsage: ${text}`);
  return Math.round(Number(match[1]) * UNITS[match[2]!]!);
}

/** 箱のいまのメモリ使用量を1回読む。 */
export function readMemory(container: string): number {
  return parseMemUsage(docker("stats", "--no-stream", "--format", "{{.MemUsage}}", container));
}

/** `docker stats` を流し続け(約1秒ごと)、最大値を覚える。 */
export class PeakMemoryWatcher {
  #child: ChildProcess;
  #peak = 0;
  #samples = 0;
  #pending = "";

  constructor(container: string) {
    this.#child = spawn("docker", ["stats", "--format", "{{.MemUsage}}", container], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    this.#child.stdout!.setEncoding("utf8").on("data", (chunk: string) => {
      // 出力は途中で切れて届くので、行がそろってから読む。
      const lines = (this.#pending + chunk).split("\n");
      this.#pending = lines.pop()!;
      for (const line of lines) {
        const match = /[\d.]+\s*(?:[KMG]i?B|kB|B)\s*\//.exec(line);
        if (!match) continue;
        this.#peak = Math.max(this.#peak, parseMemUsage(match[0]));
        this.#samples++;
      }
    });
  }

  /** 読んだ中の最大値。1つも読めていなければ失敗にする。 */
  peak(): number {
    if (this.#samples === 0) throw new Error("docker stats produced no memory samples");
    return this.#peak;
  }

  /** `docker stats` を止める。 */
  stop(): void {
    // `docker stats` は流し続けている間、普通の終了の合図を無視するので強制終了する。
    this.#child.kill("SIGKILL");
    this.#child.stdout!.destroy();
    this.#child.unref();
  }
}
