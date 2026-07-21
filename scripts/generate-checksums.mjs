import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

const [root = "src-tauri/target", destination = "SHA256SUMS.txt"] =
  process.argv.slice(2);
const extensions = new Set([
  ".AppImage",
  ".app",
  ".deb",
  ".dmg",
  ".exe",
  ".msi",
  ".rpm",
]);
const files = [];

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.endsWith(".app")) await visit(path);
    } else if (extensions.has(extname(entry.name))) {
      files.push(path);
    }
  }
}

await visit(resolve(root));
files.sort();

const lines = [];
for (const file of files) {
  const digest = createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
  lines.push(`${digest}  ${relative(resolve(root), file)}`);
}

if (lines.length === 0)
  throw new Error(`No release artifacts found below ${root}`);
await writeFile(destination, `${lines.join("\n")}\n`);
