#!/usr/bin/env node

/**
 * Strict HTTP golden comparison for the legacy Web and the GrowDesk Web BFF.
 *
 * This command has two deliberately separate modes:
 *
 *   collect
 *     GET every manifest endpoint from the legacy Next server and write a
 *     provenance-bound golden file.  A golden file can only be created from
 *     successful legacy HTTP responses.
 *
 *   compare
 *     GET every manifest endpoint from both servers, verify that the current
 *     legacy response still equals the frozen golden file, then compare the
 *     current legacy and new responses field by field.
 *
 * Example:
 *   node scripts/review/golden-parity.mjs \
 *     --mode collect --manifest /tmp/growdesk/manifest.json \
 *     --golden /tmp/growdesk/legacy.golden.json \
 *     --output /tmp/growdesk/collect.report.json
 *   node scripts/review/golden-parity.mjs \
 *     --mode compare --manifest /tmp/growdesk/manifest.json \
 *     --golden /tmp/growdesk/legacy.golden.json \
 *     --output /tmp/growdesk/compare.report.json
 *
 * The manifest, golden file, and report must all be private files owned by the
 * current user under os.tmpdir().  Only explicit 127.0.0.1 origins are
 * accepted; redirects are disabled.  Response bodies are stored only in the
 * private artifacts and are never printed to stdout or stderr.
 */

import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fchmodSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FORMAT = "growdesk-golden-parity-v1";
const SCHEMA_VERSION = 1;
const PRIVATE_MODE = 0o600;
const MAX_RESPONSE_CHARS = 32 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const SHA1_RE = /^[0-9a-f]{40}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/i;
const TEST_ID_RE = /^(?:test|e2e)_[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const PATH_PLACEHOLDER_RE = /\{\{([A-Za-z0-9_.-]+)\}\}/g;

const DEFAULT_ENDPOINTS = Object.freeze([
  { id: "auth.me", category: "auth", path: "/api/auth/me", query: {} },
  { id: "family.members", category: "family", path: "/api/family/members", query: {} },
  { id: "baby.selected", category: "family", path: "/api/baby", query: { babyId: "{{babyId}}" } },
  { id: "records.feeding", category: "records", path: "/api/records/feeding", query: { babyId: "{{babyId}}", date: "{{date}}", limit: "200" } },
  { id: "records.sleep", category: "records", path: "/api/records/sleep", query: { babyId: "{{babyId}}", date: "{{date}}", limit: "200" } },
  { id: "records.diaper", category: "records", path: "/api/records/diaper", query: { babyId: "{{babyId}}", date: "{{date}}", limit: "200" } },
  { id: "records.timeline", category: "timeline", path: "/api/records/timeline", query: { babyId: "{{babyId}}", date: "{{date}}", limit: "200" } },
  { id: "records.daily-summary", category: "records", path: "/api/records/daily-summary", query: { babyId: "{{babyId}}", date: "{{date}}" } },
  { id: "food.logs", category: "food", path: "/api/food/logs", query: { babyId: "{{babyId}}", date: "{{date}}", limit: "200" } },
  { id: "food.items", category: "food", path: "/api/food/items", query: { status: "all" } },
  { id: "knowledge.food-guidelines", category: "knowledge", path: "/api/food/feeding-guidelines", query: { month: "{{month}}" } },
  { id: "nutrition.products.formula", category: "nutrition", path: "/api/nutrition/products", query: { type: "formula" } },
  { id: "nutrition.products.supplement", category: "nutrition", path: "/api/nutrition/products", query: { type: "supplement" } },
  { id: "nutrition.schedules", category: "nutrition", path: "/api/nutrition/schedules", query: { babyId: "{{babyId}}", date: "{{date}}" } },
  { id: "nutrition.analysis", category: "nutrition", path: "/api/nutrition/analysis", query: { babyId: "{{babyId}}", date: "{{date}}", days: "7" } },
  { id: "growth.measurements", category: "growth", path: "/api/growth", query: { babyId: "{{babyId}}", limit: "100" } },
  { id: "growth.chart", category: "growth", path: "/api/growth/chart", query: { babyId: "{{babyId}}", limit: "100" } },
  { id: "medical.reports", category: "medical", path: "/api/medical/reports", query: { babyId: "{{babyId}}", limit: "100" } },
  { id: "vaccine.catalog", category: "vaccine", path: "/api/vaccines", query: { regionCode: "{{regionCode}}" } },
  { id: "vaccine.selections", category: "vaccine", path: "/api/vaccines/selections", query: { babyId: "{{babyId}}" } },
  { id: "knowledge.books", category: "knowledge", path: "/api/books", query: { tab: "all" } },
  { id: "notifications.list", category: "family", path: "/api/notifications", query: {} },
  { id: "app.config", category: "knowledge", path: "/api/app-config", query: {} },
].map((endpoint) => Object.freeze({ ...endpoint, query: Object.freeze({ ...endpoint.query }) })));

const ALLOWED_CATEGORIES = new Set([...DEFAULT_ENDPOINTS.map((endpoint) => endpoint.category), "vaccines"]);
const FORBIDDEN_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "transfer-encoding",
  "upgrade",
]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function privateRoot() {
  return realpathSync(tmpdir());
}

function assertUnderPrivateRoot(filePath, label) {
  if (!isAbsolute(filePath)) fail(`${label}_MUST_BE_ABSOLUTE`);
  const target = resolve(filePath);
  const root = privateRoot();
  const parent = existsSync(target) ? realpathSync(target) : realpathSync(dirname(target));
  const relativePath = relative(root, parent);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) fail(`${label}_OUTSIDE_TMPDIR`);
  return target;
}

function assertPrivateFile(filePath, label) {
  const target = assertUnderPrivateRoot(filePath, label);
  let info;
  try {
    info = lstatSync(target);
  } catch {
    fail(`${label}_MISSING`);
  }
  if (info.isSymbolicLink()) fail(`${label}_SYMLINK_NOT_ALLOWED`);
  if (!info.isFile()) fail(`${label}_MUST_BE_FILE`);
  if (typeof process.getuid !== "function" || info.uid !== process.getuid()) fail(`${label}_OWNER_MISMATCH`);
  if ((info.mode & 0o777) !== PRIVATE_MODE) fail(`${label}_MUST_BE_MODE_600`);
  return target;
}

function assertOutputPath(filePath, label) {
  const target = assertUnderPrivateRoot(filePath, label);
  if (existsSync(target)) return assertPrivateFile(target, label);
  const parent = dirname(target);
  const parentInfo = lstatSync(parent);
  if (parentInfo.isSymbolicLink() || !parentInfo.isDirectory()) fail(`${label}_PARENT_INVALID`);
  if (typeof process.getuid === "function" && parentInfo.uid !== process.getuid()) fail(`${label}_PARENT_OWNER_MISMATCH`);
  return target;
}

function writePrivateJson(filePath, value, label, overwrite = true) {
  const target = assertOutputPath(filePath, label);
  if (existsSync(target) && !overwrite) fail(`${label}_ALREADY_EXISTS_USE_FORCE`);
  const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT | (overwrite ? fsConstants.O_TRUNC : fsConstants.O_EXCL) | (fsConstants.O_NOFOLLOW || 0);
  let descriptor;
  try {
    descriptor = openSync(target, flags, PRIVATE_MODE);
    const info = fstatSync(descriptor);
    if (typeof process.getuid === "function" && info.uid !== process.getuid()) fail(`${label}_OWNER_MISMATCH`);
    fchmodSync(descriptor, PRIVATE_MODE);
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  assertPrivateFile(target, label);
  return target;
}

function readPrivateJson(filePath, label) {
  const target = assertPrivateFile(filePath, label);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(target, "utf8"));
  } catch {
    fail(`${label}_INVALID_JSON`);
  }
  return parsed;
}

function parseOrigin(value, label) {
  if (typeof value !== "string" || !value) fail(`${label}_INVALID`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${label}_INVALID`);
  }
  if (parsed.hostname !== "127.0.0.1") fail(`${label}_MUST_USE_127_0_0_1`);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") fail(`${label}_PROTOCOL_NOT_ALLOWED`);
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) fail(`${label}_MUST_BE_ORIGIN`);
  if (!parsed.port || !Number.isInteger(Number(parsed.port)) || Number(parsed.port) < 1 || Number(parsed.port) > 65535) fail(`${label}_PORT_REQUIRED`);
  if (Number(parsed.port) === 3088) fail(`${label}_PRODUCTION_PORT_FORBIDDEN`);
  return parsed.origin;
}

function validateSha(value, regex, label) {
  if (typeof value !== "string" || !regex.test(value)) fail(`${label}_INVALID`);
}

function validateHeaders(value, label) {
  if (value === undefined) return {};
  if (!isPlainObject(value)) fail(`${label}_INVALID`);
  const headers = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key)) fail(`${label}_INVALID_NAME`);
    if (FORBIDDEN_HEADERS.has(key.toLowerCase())) fail(`${label}_FORBIDDEN_HEADER`);
    if (typeof raw !== "string" || raw.length > 16_384) fail(`${label}_INVALID_VALUE`);
    headers[key] = raw;
  }
  return headers;
}

function validateManifest(manifest) {
  if (!isPlainObject(manifest) || manifest.schemaVersion !== SCHEMA_VERSION) fail("MANIFEST_SCHEMA_UNSUPPORTED");
  validateSha(manifest.sourceGitSha, SHA1_RE, "SOURCE_GIT_SHA");
  validateSha(manifest.fixtureSha, SHA256_RE, "FIXTURE_SHA");
  const legacyOrigin = parseOrigin(manifest.legacyOrigin, "LEGACY_ORIGIN");
  const newOrigin = parseOrigin(manifest.newOrigin, "NEW_ORIGIN");
  if (!isPlainObject(manifest.tenant)) fail("TENANT_REQUIRED");
  const namedTenantKeys = ["username", "familyName", "babyName"];
  const hasNamedTenant = namedTenantKeys.every((key) => typeof manifest.tenant[key] === "string");
  if (hasNamedTenant) {
    for (const key of namedTenantKeys) {
      if (!TEST_ID_RE.test(manifest.tenant[key])) fail(`TENANT_${key.toUpperCase()}_MUST_BE_TEST_NAME`);
    }
  } else {
    // Backward-compatible shape for a runner that has no display names yet.
    // Once names are available, the named shape above is preferred because
    // canonical UUIDs are intentionally allowed in context.
    for (const key of ["userId", "familyId", "babyId"]) {
      if (typeof manifest.tenant[key] !== "string" || !TEST_ID_RE.test(manifest.tenant[key])) fail(`TENANT_${key.toUpperCase()}_MUST_BE_TEST_ID`);
    }
  }
  if (!isPlainObject(manifest.context)) fail("CONTEXT_REQUIRED");
  const context = { ...manifest.context };
  for (const key of ["userId", "familyId", "babyId"]) {
    if (context[key] === undefined && typeof manifest.tenant[key] === "string") context[key] = manifest.tenant[key];
    if (context[key] !== undefined && (typeof context[key] !== "string" || !context[key])) fail(`CONTEXT_${key.toUpperCase()}_INVALID`);
  }
  for (const key of ["familyId", "babyId"]) {
    if (typeof context[key] !== "string" || !context[key]) fail(`CONTEXT_${key.toUpperCase()}_REQUIRED`);
  }
  if (!Array.isArray(manifest.endpoints) || manifest.endpoints.length === 0) fail("ENDPOINTS_REQUIRED");
  const seen = new Set();
  const endpoints = manifest.endpoints.map((endpoint, index) => {
    if (!isPlainObject(endpoint)) fail(`ENDPOINT_${index}_INVALID`);
    if (typeof endpoint.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(endpoint.id) || seen.has(endpoint.id)) fail(`ENDPOINT_${index}_ID_INVALID`);
    seen.add(endpoint.id);
    if (endpoint.method !== undefined && endpoint.method !== "GET") fail(`ENDPOINT_${index}_METHOD_MUST_BE_GET`);
    if (typeof endpoint.category !== "string" || !ALLOWED_CATEGORIES.has(endpoint.category)) fail(`ENDPOINT_${index}_CATEGORY_INVALID`);
    if (typeof endpoint.path !== "string" || !endpoint.path.startsWith("/api/") || endpoint.path.startsWith("//") || endpoint.path.includes("?") || endpoint.path.includes("#") || endpoint.path.includes("\\") || endpoint.path.split("/").includes("..")) fail(`ENDPOINT_${index}_PATH_INVALID`);
    if (!isPlainObject(endpoint.query)) fail(`ENDPOINT_${index}_QUERY_INVALID`);
    const query = {};
    for (const [key, raw] of Object.entries(endpoint.query)) {
      if (!/^[A-Za-z0-9_.-]+$/.test(key)) fail(`ENDPOINT_${index}_QUERY_KEY_INVALID`);
      if (!(typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean" || Array.isArray(raw))) fail(`ENDPOINT_${index}_QUERY_VALUE_INVALID`);
      if (Array.isArray(raw) && raw.some((item) => !(typeof item === "string" || typeof item === "number" || typeof item === "boolean"))) fail(`ENDPOINT_${index}_QUERY_ARRAY_INVALID`);
      query[key] = raw;
    }
    return { id: endpoint.id, category: endpoint.category, path: endpoint.path, query };
  });
  const legacyHeaders = validateHeaders(manifest.headers?.legacy, "LEGACY_HEADERS");
  const newHeaders = validateHeaders(manifest.headers?.new, "NEW_HEADERS");
  return { legacyOrigin, newOrigin, context, endpoints, legacyHeaders, newHeaders };
}

function interpolate(value, context, label) {
  return String(value).replace(PATH_PLACEHOLDER_RE, (_match, key) => {
    if (!(key in context) || context[key] === undefined || context[key] === null) fail(`${label}_CONTEXT_${key}_MISSING`);
    return encodeURIComponent(String(context[key]));
  });
}

function buildRequest(endpoint, context, origin) {
  const path = interpolate(endpoint.path, context, `ENDPOINT_${endpoint.id}`);
  const url = new URL(path, origin);
  const query = new URLSearchParams();
  for (const key of Object.keys(endpoint.query).sort()) {
    const raw = endpoint.query[key];
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) query.append(key, interpolate(value, context, `ENDPOINT_${endpoint.id}`));
  }
  url.search = query.toString();
  if (url.origin !== origin || !url.pathname.startsWith("/api/")) fail(`ENDPOINT_${endpoint.id}_URL_INVALID`);
  return { path: url.pathname, query: url.searchParams.toString(), url: url.toString() };
}

function assertSafeJsonNumbers(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) fail("UNSAFE_JSON_NUMBER");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertSafeJsonNumbers(item);
    return;
  }
  if (isPlainObject(value)) {
    for (const item of Object.values(value)) assertSafeJsonNumbers(item);
  }
}

function parseBody(text, contentType) {
  if (text.length > MAX_RESPONSE_CHARS) fail("RESPONSE_TOO_LARGE");
  if (contentType.toLowerCase().includes("json")) {
    try {
      const body = JSON.parse(text);
      assertSafeJsonNumbers(body);
      return body;
    } catch (error) {
      if (error?.code === "UNSAFE_JSON_NUMBER" || error?.code === "RESPONSE_TOO_LARGE") throw error;
      fail("INVALID_JSON_RESPONSE");
    }
  }
  return text;
}

async function fetchResponse(request, headers, timeoutMs) {
  try {
    const response = await fetch(request.url, {
      method: "GET",
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = parseBody(await response.text(), response.headers.get("content-type") || "");
    return { status: response.status, body };
  } catch {
    return { status: null, body: null, error: "HTTP_REQUEST_FAILED" };
  }
}

async function fetchAll(origin, headers, endpoints, context, timeoutMs) {
  const responses = [];
  for (const endpoint of endpoints) {
    const request = buildRequest(endpoint, context, origin);
    const response = await fetchResponse(request, headers, timeoutMs);
    responses.push({ id: endpoint.id, category: endpoint.category, request: { path: request.path, query: request.query }, response });
  }
  return responses;
}

function responseSuccess(response) {
  return response && Object.hasOwn(response, "body") && Number.isInteger(response.status) && response.status >= 200 && response.status < 300 && !Object.hasOwn(response, "error");
}

function valueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function deepDifferences(left, right, path = "$", output = [], maxDetails = 100) {
  const leftType = valueType(left);
  const rightType = valueType(right);
  if (leftType !== rightType) {
    output.push({ path, reason: "type_mismatch" });
    return 1;
  }
  if (leftType === "array") {
    let count = 0;
    if (left.length !== right.length) {
      count += 1;
      if (output.length < maxDetails) output.push({ path, reason: "array_length_mismatch" });
    }
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      if (index >= left.length || index >= right.length) continue;
      const before = output.length;
      const nested = deepDifferences(left[index], right[index], `${path}/${index}`, output, maxDetails);
      count += nested;
      if (nested > 0 && output.length === before && output.length < maxDetails) output.push({ path: `${path}/${index}`, reason: "nested_mismatch" });
    }
    return count;
  }
  if (leftType === "object") {
    let count = 0;
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const key of keys) {
      const childPath = `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
      if (!Object.hasOwn(left, key) || !Object.hasOwn(right, key)) {
        count += 1;
        if (output.length < maxDetails) output.push({ path: childPath, reason: "missing_or_extra_field" });
        continue;
      }
      count += deepDifferences(left[key], right[key], childPath, output, maxDetails);
    }
    return count;
  }
  if (!Object.is(left, right)) {
    if (output.length < maxDetails) output.push({ path, reason: "value_mismatch" });
    return 1;
  }
  return 0;
}

function sameRequest(left, right) {
  return left.id === right.id && left.category === right.category && JSON.stringify(left.request) === JSON.stringify(right.request);
}

function endpointDescriptor(endpoint) {
  return { id: endpoint.id, category: endpoint.category, path: endpoint.path, query: endpoint.query };
}

function validateGolden(golden, manifestInfo, manifestSha) {
  if (!isPlainObject(golden) || golden.format !== FORMAT || golden.schemaVersion !== SCHEMA_VERSION) fail("GOLDEN_SCHEMA_UNSUPPORTED");
  if (!isPlainObject(golden.provenance) || golden.provenance.source !== "legacy-next-http") fail("GOLDEN_SOURCE_NOT_LEGACY_HTTP");
  if (golden.provenance.sourceGitSha !== undefined && golden.provenance.sourceGitSha !== manifestInfo.sourceGitSha) fail("GOLDEN_SOURCE_SHA_MISMATCH");
  if (golden.provenance.fixtureSha !== undefined && golden.provenance.fixtureSha !== manifestInfo.fixtureSha) fail("GOLDEN_FIXTURE_SHA_MISMATCH");
  if (golden.provenance.manifestSha256 !== manifestSha) fail("GOLDEN_MANIFEST_SHA_MISMATCH");
  if (!Array.isArray(golden.endpoints) || golden.endpoints.length !== manifestInfo.endpoints.length) fail("GOLDEN_ENDPOINT_SET_MISMATCH");
  for (let index = 0; index < manifestInfo.endpoints.length; index += 1) {
    const expected = endpointDescriptor(manifestInfo.endpoints[index]);
    const actual = golden.endpoints[index];
    if (!isPlainObject(actual) || JSON.stringify(actual.descriptor) !== JSON.stringify(expected) || !isPlainObject(actual.response)) fail(`GOLDEN_ENDPOINT_${index}_MISMATCH`);
    if (!responseSuccess(actual.response)) fail(`GOLDEN_ENDPOINT_${index}_NON_SUCCESS`);
  }
}

function compareResponse(golden, legacy, current) {
  if (!responseSuccess(legacy) || !responseSuccess(current)) return { status: "FAIL", reason: "NON_SUCCESS_HTTP_STATUS", differenceCount: 0, differences: [] };
  if (legacy.status !== current.status) return { status: "FAIL", reason: "HTTP_STATUS_MISMATCH", differenceCount: 1, differences: [{ path: "$", reason: "http_status_mismatch" }] };
  if (!responseSuccess(golden)) return { status: "FAIL", reason: "INVALID_GOLDEN_RESPONSE", differenceCount: 1, differences: [{ path: "$", reason: "invalid_golden_response" }] };
  const differences = [];
  const differenceCount = deepDifferences(legacy.body, golden.body, "$legacyGolden", differences);
  if (differenceCount > 0) return { status: "FAIL", reason: "LEGACY_GOLDEN_DRIFT", differenceCount, differences };
  const parityDifferences = [];
  const parityCount = deepDifferences(legacy.body, current.body, "$", parityDifferences);
  return parityCount === 0
    ? { status: "PASS", reason: null, differenceCount: 0, differences: [] }
    : { status: "FAIL", reason: "BODY_MISMATCH", differenceCount: parityCount, differences: parityDifferences };
}

function summaryFromReport(report) {
  const counts = { pass: 0, fail: 0 };
  for (const result of report.results) counts[result.status === "PASS" ? "pass" : "fail"] += 1;
  return {
    format: report.format,
    mode: report.mode,
    passed: report.passed,
    endpointCount: report.results.length,
    counts,
    sourceGitSha: report.sourceGitSha,
    fixtureSha: report.fixtureSha,
    reportPath: report.reportPath,
    results: report.results,
  };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (!argument.startsWith("--")) fail("ARGUMENT_INVALID");
    const key = argument.slice(2);
    if (key === "force") {
      args.force = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`ARGUMENT_${key.toUpperCase()}_VALUE_REQUIRED`);
    args[key] = value;
    index += 1;
  }
  return args;
}

function helpText() {
  return [
    "Usage:",
    "  golden-parity.mjs --mode collect|compare --manifest FILE --output FILE [--golden FILE] [--force] [--timeout-ms N]",
    "",
    "collect: GET old Next only and create a legacy-http golden file.",
    "compare: GET old and new Next, verify old equals the frozen golden, then compare both responses.",
    "All files must be mode 600, owned by the current user, and under os.tmpdir(); origins must be 127.0.0.1 and cannot use port 3088.",
  ].join("\n");
}

async function run(args) {
  if (args.help) {
    console.log(helpText());
    return 0;
  }
  if (args.mode !== "collect" && args.mode !== "compare") fail("MODE_REQUIRED");
  if (typeof args.manifest !== "string" || typeof args.output !== "string") fail("MANIFEST_AND_OUTPUT_REQUIRED");
  const manifestPath = assertPrivateFile(args.manifest, "MANIFEST");
  const manifest = readPrivateJson(manifestPath, "MANIFEST");
  const manifestInfo = validateManifest(manifest);
  // Bind the fixture and requested contract, not ephemeral ports or login cookies.
  // Every new connection still passes validateManifest's local-only checks.
  const manifestTextHash = createHash("sha256").update(JSON.stringify({
    schemaVersion: manifest.schemaVersion, sourceGitSha: manifest.sourceGitSha,
    fixtureSha: manifest.fixtureSha, tenant: manifest.tenant,
    context: manifestInfo.context, endpoints: manifestInfo.endpoints,
  })).digest("hex");
  manifestInfo.sourceGitSha = manifest.sourceGitSha;
  manifestInfo.fixtureSha = manifest.fixtureSha;
  if (resolve(args.output) === resolve(manifestPath)) fail("OUTPUT_CANNOT_REPLACE_MANIFEST");
  const reportPath = assertOutputPath(args.output, "REPORT");
  let timeoutMs = args["timeout-ms"] === undefined ? DEFAULT_TIMEOUT_MS : Number(args["timeout-ms"]);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) fail("TIMEOUT_INVALID");
  const goldenPath = args.golden ? assertOutputPath(args.golden, "GOLDEN") : null;
  if (goldenPath && resolve(goldenPath) === resolve(manifestPath)) fail("GOLDEN_CANNOT_REPLACE_MANIFEST");
  if (goldenPath && resolve(goldenPath) === resolve(reportPath)) fail("GOLDEN_AND_REPORT_MUST_DIFFER");

  const legacyResponses = await fetchAll(manifestInfo.legacyOrigin, manifestInfo.legacyHeaders, manifestInfo.endpoints, manifestInfo.context, timeoutMs);
  if (args.mode === "collect") {
    if (!goldenPath) fail("GOLDEN_OUTPUT_REQUIRED_FOR_COLLECT");
    const legacySuccess = legacyResponses.every((entry) => responseSuccess(entry.response));
    const golden = {
      format: FORMAT,
      schemaVersion: SCHEMA_VERSION,
      provenance: {
        source: "legacy-next-http",
        sourceGitSha: manifest.sourceGitSha,
        fixtureSha: manifest.fixtureSha,
        manifestSha256: manifestTextHash,
        legacyOrigin: manifestInfo.legacyOrigin,
        collectedAt: new Date().toISOString(),
      },
      endpoints: legacyResponses.map((entry, index) => ({
        descriptor: endpointDescriptor(manifestInfo.endpoints[index]),
        response: entry.response,
      })),
    };
    if (legacySuccess) writePrivateJson(goldenPath, golden, "GOLDEN", Boolean(args.force));
    const report = {
      format: FORMAT,
      schemaVersion: SCHEMA_VERSION,
      mode: "collect",
      passed: legacySuccess,
      sourceGitSha: manifest.sourceGitSha,
      fixtureSha: manifest.fixtureSha,
      manifestSha256: manifestTextHash,
      responses: legacyResponses,
      results: legacyResponses.map((entry) => ({
        id: entry.id,
        category: entry.category,
        status: responseSuccess(entry.response) ? "PASS" : "FAIL",
        reason: responseSuccess(entry.response) ? null : "NON_SUCCESS_HTTP_STATUS",
        legacyStatus: entry.response.status,
        newStatus: null,
        differenceCount: 0,
        differences: [],
      })),
      reportPath,
    };
    writePrivateJson(reportPath, report, "REPORT");
    console.log(JSON.stringify(summaryFromReport(report), null, 2));
    return legacySuccess ? 0 : 1;
  }

  if (!goldenPath) fail("GOLDEN_INPUT_REQUIRED_FOR_COMPARE");
  const golden = readPrivateJson(goldenPath, "GOLDEN");
  validateGolden(golden, manifestInfo, manifestTextHash);
  const newResponses = await fetchAll(manifestInfo.newOrigin, manifestInfo.newHeaders, manifestInfo.endpoints, manifestInfo.context, timeoutMs);
  const results = [];
  for (let index = 0; index < manifestInfo.endpoints.length; index += 1) {
    const legacy = legacyResponses[index];
    const current = newResponses[index];
    const goldenEntry = golden.endpoints[index];
    if (!sameRequest(legacy, current)) fail(`ENDPOINT_${index}_REQUEST_MISMATCH`);
    const result = compareResponse(goldenEntry.response, legacy.response, current.response);
    results.push({
      id: legacy.id,
      category: legacy.category,
      status: result.status,
      reason: result.reason,
      legacyStatus: legacy.response.status,
      newStatus: current.response.status,
      differenceCount: result.differenceCount,
      differences: result.differences,
    });
  }
  const report = {
    format: FORMAT,
    schemaVersion: SCHEMA_VERSION,
    mode: "compare",
    passed: results.length > 0 && results.every((result) => result.status === "PASS"),
    sourceGitSha: manifest.sourceGitSha,
    fixtureSha: manifest.fixtureSha,
    manifestSha256: manifestTextHash,
    responses: legacyResponses.map((legacy, index) => ({
      id: legacy.id,
      category: legacy.category,
      request: legacy.request,
      legacy: legacy.response,
      new: newResponses[index].response,
    })),
    results,
    reportPath,
  };
  writePrivateJson(reportPath, report, "REPORT");
  console.log(JSON.stringify(summaryFromReport(report), null, 2));
  return report.passed ? 0 : 1;
}

export { DEFAULT_ENDPOINTS, FORMAT, deepDifferences, validateManifest };

const isDirectExecution = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isDirectExecution) {
  run(parseArgs(process.argv.slice(2))).then((code) => {
    // Undici may keep an idle keep-alive socket after the last GET.  This is a
    // short-lived CLI, so terminate after the private report has been flushed
    // instead of making the runner wait for the socket's idle timeout.
    process.exit(code);
  }).catch((error) => {
    console.error(`GOLDEN_PARITY_REJECTED:${error?.code || "INTERNAL_ERROR"}`);
    process.exit(2);
  });
}
