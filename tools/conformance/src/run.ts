import { checkFramework } from "./check.ts";
import { listFrameworks } from "./docker.ts";

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
  if (!(await checkFramework(name))) failed.push(name);
}
if (failed.length > 0) {
  console.error(`\nconformance failed: ${failed.join(", ")}`);
  process.exit(1);
}
console.log("\nall frameworks passed");
