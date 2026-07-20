import { readFile } from "node:fs/promises";

const allowed = new Set([
  "0BSD",
  "Apache-2.0",
  "Apache-2.0 OR MIT",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BlueOak-1.0.0",
  "CC-BY-4.0",
  "ISC",
  "MIT",
  "MIT OR Apache-2.0",
  "MIT-0",
  "MPL-2.0",
]);

const lockfile = JSON.parse(
  await readFile(new URL("../package-lock.json", import.meta.url)),
);
const rejected = [];

for (const [path, metadata] of Object.entries(lockfile.packages ?? {})) {
  if (!path || allowed.has(metadata.license)) continue;
  rejected.push(`${path}: ${metadata.license ?? "missing license"}`);
}

if (rejected.length > 0) {
  console.error("Dependency licenses require review:\n" + rejected.join("\n"));
  process.exitCode = 1;
} else {
  console.log("JavaScript dependency licenses accepted.");
}
