import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function validateReleaseVersion(tag, versions) {
  if (!tag) throw new Error("Usage: check-release-version.mjs <tag>");

  const expectedVersion = tag.startsWith("v") ? tag.slice(1) : null;
  const mismatches = Object.entries(versions).filter(
    ([, version]) => !expectedVersion || version !== expectedVersion,
  );

  if (mismatches.length > 0) {
    const versionSummary = Object.entries(versions)
      .map(([file, version]) => `${file}=${version ?? "missing"}`)
      .join(", ");
    throw new Error(
      `Release tag ${tag} does not match project versions: ${versionSummary}`,
    );
  }

  return `Release tag ${tag} matches all project versions.`;
}

export async function checkReleaseVersion(tag) {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const tauriConfig = JSON.parse(
    await readFile("src-tauri/tauri.conf.json", "utf8"),
  );
  const cargoToml = await readFile("src-tauri/Cargo.toml", "utf8");
  const cargoVersion = cargoToml.match(
    /^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m,
  )?.[1];

  return validateReleaseVersion(tag, {
    "package.json": packageJson.version,
    "src-tauri/tauri.conf.json": tauriConfig.version,
    "src-tauri/Cargo.toml": cargoVersion,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(await checkReleaseVersion(process.argv[2]));
}
