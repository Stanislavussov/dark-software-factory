import { spawnSync } from "node:child_process";
import { readdir, rm, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(root, "..");
const distRoot = join(packageRoot, "dist");

await rm(distRoot, { recursive: true, force: true });

const tsc = spawnSync(
  process.platform === "win32" ? "pnpm.cmd" : "pnpm",
  ["exec", "tsc", "--outDir", "dist", "--noEmit", "false", "--declaration", "false"],
  {
    cwd: packageRoot,
    stdio: "inherit",
  },
);
if (tsc.status !== 0) {
  throw new Error("TypeScript emit failed.");
}

const files = [];
async function collect(dir) {
  for (const entry of await readdir(dir)) {
    const path = join(dir, entry);
    const info = await stat(path);
    if (info.isDirectory()) {
      await collect(path);
    } else if (entry.endsWith(".js")) {
      files.push(path);
    }
  }
}
await collect(distRoot);

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`Syntax check failed for ${relative(packageRoot, file)}`);
  }
}
