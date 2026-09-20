#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const EXPECTED_EXCEPTIONS = new Map([
  ["auth.me", new Set(["$/family/inviteCode|missing_or_extra_field"])],
  ["family.members", new Set(["$/family/inviteCode|missing_or_extra_field"])],
  ["development.milestones", new Set(["$/dataRelease/createdAt|missing_or_extra_field"])],
]);

function fail(code, details = {}) {
  process.stderr.write(`${JSON.stringify({ passed: false, code, ...details })}\n`);
  process.exitCode = 1;
}

export function verifyGoldenPolicy(report) {
  if (!report || report.format !== "growdesk-golden-parity-v1" || report.mode !== "compare") {
    return { passed: false, code: "UNSUPPORTED_GOLDEN_REPORT" };
  }
  if (!Array.isArray(report.results) || report.results.length === 0) {
    return { passed: false, code: "EMPTY_GOLDEN_RESULTS" };
  }

  const seenEndpoints = new Set();
  const structuralErrors = [];
  for (const [index, result] of report.results.entries()) {
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      structuralErrors.push({ endpoint: index, reason: "RESULT_INVALID" });
      continue;
    }
    if (typeof result.id !== "string" || result.id.length === 0) {
      structuralErrors.push({ endpoint: index, reason: "RESULT_ID_INVALID" });
    } else if (seenEndpoints.has(result.id)) {
      structuralErrors.push({ endpoint: result.id, reason: "DUPLICATE_ENDPOINT_RESULT" });
    } else {
      seenEndpoints.add(result.id);
    }
    if (result.status !== "PASS" && result.status !== "FAIL") {
      structuralErrors.push({ endpoint: result.id ?? index, reason: "RESULT_STATUS_INVALID" });
    } else if (
      result.status === "PASS" &&
      (result.reason !== null || result.differenceCount !== 0 || !Array.isArray(result.differences) || result.differences.length !== 0)
    ) {
      structuralErrors.push({ endpoint: result.id, reason: "PASS_RESULT_HAS_DIFFERENCES" });
    }
  }
  if (structuralErrors.length > 0) {
    return { passed: false, code: "INVALID_GOLDEN_RESULTS", rejected: structuralErrors };
  }

  const accepted = [];
  const rejected = [];
  for (const result of report.results) {
    if (result.status === "PASS") continue;
    const expected = EXPECTED_EXCEPTIONS.get(result.id);
    const actual = new Set(
      Array.isArray(result.differences)
        ? result.differences.map((difference) => `${difference.path}|${difference.reason}`)
        : [],
    );
    const exactMatch =
      result.reason === "BODY_MISMATCH" &&
      result.differenceCount === actual.size &&
      expected?.size === actual.size &&
      [...actual].every((difference) => expected.has(difference));
    if (exactMatch) {
      accepted.push({ endpoint: result.id, differences: [...actual].sort() });
    } else {
      rejected.push({
        endpoint: result.id,
        reason: result.reason,
        differenceCount: result.differenceCount,
        differences: [...actual].sort(),
      });
    }
  }

  for (const [endpoint] of EXPECTED_EXCEPTIONS) {
    const result = report.results.find((candidate) => candidate.id === endpoint);
    if (!result) rejected.push({ endpoint, reason: "EXPECTED_ENDPOINT_MISSING" });
    else if (result.status === "PASS") rejected.push({ endpoint, reason: "POLICY_EXCEPTION_UNEXPECTEDLY_ABSENT" });
  }

  if (rejected.length > 0) {
    return { passed: false, code: "UNAPPROVED_GOLDEN_DIFFERENCE", accepted, rejected };
  }
  return {
    passed: true,
    code: "ONLY_APPROVED_SECURITY_AND_PROVENANCE_DIFFERENCES",
    exactEndpointCount: report.results.length - accepted.length,
    accepted,
    testedBuild: report.testedBuild ?? null,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const reportPath = process.argv[2];
  if (!reportPath) {
    fail("REPORT_PATH_REQUIRED");
  } else {
    try {
      const result = verifyGoldenPolicy(JSON.parse(readFileSync(resolve(reportPath), "utf8")));
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.passed) process.exitCode = 1;
    } catch (error) {
      fail("REPORT_READ_FAILED", { message: error instanceof Error ? error.message : String(error) });
    }
  }
}
