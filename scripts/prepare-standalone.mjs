import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const standalone = resolve(root, ".next/standalone");
if (!existsSync(resolve(standalone, "server.js"))) throw new Error("Next standalone server.js is missing");
if (!existsSync(resolve(root, ".next/static"))) throw new Error("Next static assets are missing");
mkdirSync(resolve(standalone, ".next"), { recursive: true });
cpSync(resolve(root, ".next/static"), resolve(standalone, ".next/static"), { recursive: true });
if (existsSync(resolve(root, "public"))) {
  cpSync(resolve(root, "public"), resolve(standalone, "public"), { recursive: true });
}

// Identify the tested build even when source edits continue during acceptance.
const artifactHash = createHash("sha256");
function hashDirectory(directory, prefix) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const label = `${prefix}/${entry.name}`;
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) hashDirectory(file, label);
    else if (entry.isFile()) artifactHash.update(label).update("\0").update(readFileSync(file)).update("\0");
  }
}
hashDirectory(resolve(standalone, ".next/server"), "server");
hashDirectory(resolve(standalone, ".next/static"), "static");
writeFileSync(resolve(standalone, "build-provenance.json"), JSON.stringify({
  schemaVersion: 1,
  sourceGitSha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  sourceDirty: Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim()),
  buildId: readFileSync(resolve(root, ".next/BUILD_ID"), "utf8").trim(),
  artifactSha256: artifactHash.digest("hex"),
  builtAt: new Date().toISOString(),
}, null, 2) + "\n");
