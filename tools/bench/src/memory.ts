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

/** Parses the used part of `docker stats` MemUsage, e.g. "45.2MiB / 5.786GiB". */
export function parseMemUsage(text: string): number {
  const match = /([\d.]+)\s*([KMG]i?B|kB|B)/.exec(text);
  if (!match) throw new Error(`unexpected MemUsage: ${text}`);
  return Math.round(Number(match[1]) * UNITS[match[2]!]!);
}

export function readMemory(container: string): number {
  return parseMemUsage(docker("stats", "--no-stream", "--format", "{{.MemUsage}}", container));
}

/** Streams `docker stats` (about one sample per second) and keeps the highest value. */
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
      // Chunks can split a sample anywhere, so only complete lines are parsed.
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

  peak(): number {
    if (this.#samples === 0) throw new Error("docker stats produced no memory samples");
    return this.#peak;
  }

  stop(): void {
    // `docker stats` ignores SIGTERM while streaming, so it has to be killed outright.
    this.#child.kill("SIGKILL");
    this.#child.stdout!.destroy();
    this.#child.unref();
  }
}
