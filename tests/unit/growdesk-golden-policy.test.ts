import assert from "node:assert/strict";
import test from "node:test";

import { verifyGoldenPolicy } from "../../scripts/review/verify-golden-policy.mjs";

const approved = [
  ["auth.me", "$/family/inviteCode"],
  ["family.members", "$/family/inviteCode"],
  ["development.milestones", "$/dataRelease/createdAt"],
] as const;

function report(extraResults: Array<Record<string, unknown>> = []) {
  return {
    format: "growdesk-golden-parity-v1",
    mode: "compare",
    results: [
      { id: "records.feeding", status: "PASS", reason: null, differenceCount: 0, differences: [] },
      ...approved.map(([id, path]) => ({
        id,
        status: "FAIL",
        reason: "BODY_MISMATCH",
        differenceCount: 1,
        differences: [{ path, reason: "missing_or_extra_field" }],
      })),
      ...extraResults,
    ],
  };
}

test("accepts only the three documented non-recoverable legacy fields", () => {
  const result = verifyGoldenPolicy(report());
  assert.equal(result.passed, true);
  assert.equal(result.exactEndpointCount, 1);
  assert.equal(result.accepted.length, 3);
});

test("rejects any additional endpoint difference", () => {
  const result = verifyGoldenPolicy(report([{
    id: "records.sleep",
    status: "FAIL",
    reason: "BODY_MISMATCH",
    differenceCount: 1,
    differences: [{ path: "$/records/0/id", reason: "value_mismatch" }],
  }]));
  assert.equal(result.passed, false);
  assert.equal(result.code, "UNAPPROVED_GOLDEN_DIFFERENCE");
});

test("rejects a changed path inside an approved endpoint", () => {
  const candidate = report();
  candidate.results[1].differences = [{ path: "$/family/name", reason: "missing_or_extra_field" }];
  const result = verifyGoldenPolicy(candidate);
  assert.equal(result.passed, false);
});

test("rejects legacy drift even when the displayed path resembles an exception", () => {
  const candidate = report();
  candidate.results[1].reason = "LEGACY_GOLDEN_DRIFT";
  const result = verifyGoldenPolicy(candidate);
  assert.equal(result.passed, false);
});
