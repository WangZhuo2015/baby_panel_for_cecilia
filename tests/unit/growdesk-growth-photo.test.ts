import test from "node:test";
import assert from "node:assert/strict";
import { fromGrowDeskGrowthRecord, toGrowDeskGrowthCreatePayload, toGrowDeskGrowthUpdatePayload } from "../../lib/growdesk/growth-compat";

const id = "512f9294-61e9-49e9-89eb-5928f7716b4a";
const url = `/api/attachments/${id}`;

test("growth form image URL survives canonical save and legacy read", () => {
  const saved = toGrowDeskGrowthCreatePayload({ date: "2026-09-19", weightKg: 8.2, imageUrl: url });
  assert.equal(saved.attachmentId, id);
  const projected = fromGrowDeskGrowthRecord({
    id: "test_growth", babyId: "test_baby", familyId: "test_family", measurementDate: "2026-09-19",
    weightKg: "8.20", heightCm: null, headCircumferenceCm: null, attachmentId: saved.attachmentId,
    notes: null, version: "1", createdAt: "2026-09-19T00:00:00Z", updatedAt: "2026-09-19T00:00:00Z",
  });
  assert.equal(projected.imageUrl, url);
  assert.equal(toGrowDeskGrowthUpdatePayload({ version: "1", imageUrl: url }).attachmentId, id);
});

test("removing a growth photo clears its reference while omitted photos remain untouched", () => {
  assert.equal(toGrowDeskGrowthUpdatePayload({ version: "1", imageUrl: null }).attachmentId, null);
  assert.equal(Object.hasOwn(toGrowDeskGrowthUpdatePayload({ version: "1", weightKg: 8.3 }), "attachmentId"), false);
});

test("growth photo adapter rejects external, malformed and conflicting references", () => {
  for (const imageUrl of ["https://example.invalid/photo.png", "/uploads/old.png", "/api/attachments/../secret", 7]) {
    assert.throws(() => toGrowDeskGrowthCreatePayload({ imageUrl }), /请重新上传测量照片/);
  }
  assert.throws(() => toGrowDeskGrowthCreatePayload({ attachmentId: null, imageUrl: url }), /引用不一致/);
});
