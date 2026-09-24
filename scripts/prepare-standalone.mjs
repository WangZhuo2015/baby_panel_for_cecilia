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
mkdirSync(resolve(standalone, "data"), { recursive: true });
for (const name of ["01_sources.json", "02_vaccines.json", "03_milestones.json", "04_foods.json", "05_books.json", "06_activities.json"]) {
  cpSync(resolve(root, "data", name), resolve(standalone, "data", name));
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
artifactHash.update("server.js\0").update(readFileSync(resolve(standalone, "server.js"))).update("\0");
if (existsSync(resolve(standalone, "public"))) hashDirectory(resolve(standalone, "public"), "public");
hashDirectory(resolve(standalone, "data"), "data");
const configuredRevision = process.env.BUILD_REVISION?.trim();
if (configuredRevision && !/^[0-9a-f]{40}$/.test(configuredRevision)) {
  throw new Error("BUILD_REVISION must be a full lowercase Git SHA");
}
const sourceGitSha = configuredRevision
  || execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const configuredDirty = process.env.BUILD_SOURCE_DIRTY?.trim();
if (configuredDirty && !["true", "false"].includes(configuredDirty)) {
  throw new Error("BUILD_SOURCE_DIRTY must be true or false");
}
const sourceDirty = configuredDirty
  ? configuredDirty === "true"
  : Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim());
writeFileSync(resolve(standalone, "build-provenance.json"), JSON.stringify({
  schemaVersion: 1,
  sourceGitSha,
  sourceDirty,
  buildId: readFileSync(resolve(root, ".next/BUILD_ID"), "utf8").trim(),
  artifactSha256: artifactHash.digest("hex"),
  builtAt: new Date().toISOString(),
}, null, 2) + "\n");
