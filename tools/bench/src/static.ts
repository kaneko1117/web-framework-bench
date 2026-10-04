import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FRAMEWORKS_DIR, docker, imageName } from "@wfb/conformance/docker";
import type { StaticMetrics } from "./result.ts";

type Lockfile = { packages: Record<string, { dev?: boolean; devOptional?: boolean }> };

/** 本番用のライブラリを、芋づる式に入るものまで含めて数える(開発用は除く)。 */
function countDependencies(dir: string): StaticMetrics["dependencies"] {
  const lock = JSON.parse(readFileSync(join(dir, "package-lock.json"), "utf8")) as Lockfile;
  const total = Object.entries(lock.packages).filter(([path, p]) => path !== "" && !p.dev && !p.devOptional).length;
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { dependencies?: object };
  return { total, direct: Object.keys(pkg.dependencies ?? {}).length };
}

const SOURCE_EXTENSIONS = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/** src/ の下のコードのファイルの行数。空行とコメントだけの行は数えない。 */
function countSourceLines(dir: string): number {
  let lines = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !SOURCE_EXTENSIONS.test(entry.name)) continue;
    const text = readFileSync(join(entry.parentPath, entry.name), "utf8");
    lines += text.split("\n").filter((line) => {
      const t = line.trim();
      return t !== "" && !t.startsWith("//") && !t.startsWith("/*") && !t.startsWith("*");
    }).length;
  }
  return lines;
}

/** 箱の中で数えた、展開後のバイト数(全体と、アプリの置き場所)。保管方式によらず同じ意味になる。 */
function measureImage(framework: string): { imageBytes: number; appImageBytes: number } {
  const image = imageName(framework);
  const workdir = docker("image", "inspect", "-f", "{{.Config.WorkingDir}}", image);
  if (!workdir) throw new Error(`${image} has no WORKDIR`);
  // 一般ユーザーでは読めないフォルダがあるので、数えるときだけ管理者で動かす。
  // du は1回の呼び出しで同じファイルを二度数えないので、全体とアプリの置き場所を別々に数える。
  const script = 'du -sbx / && du -sb "$1"';
  const out = docker("run", "--rm", "--user", "root", "--entrypoint", "sh", image, "-c", script, "sh", workdir);
  const [imageBytes, appImageBytes] = out.split("\n").map((line) => Number(line.split(/\s+/)[0]));
  return { imageBytes: imageBytes!, appImageBytes: appImageBytes! };
}

/** 動かさずに分かる数字を集める。箱は作成済みであること。 */
export function collectStaticMetrics(framework: string): StaticMetrics {
  const dir = join(FRAMEWORKS_DIR, framework);
  return {
    ...measureImage(framework),
    sourceLines: countSourceLines(join(dir, "src")),
    dependencies: countDependencies(dir),
  };
}
