import test from "node:test";
import assert from "node:assert/strict";
import { getImageProps } from "next/image";
import { shouldBypassImageOptimization } from "../../lib/private-image";

const id = "550e8400-e29b-41d4-a716-446655440000";

test("old and canonical private image paths are fetched directly, including query strings and absolute URLs", () => {
  for (const src of [
    "/uploads/medical/test.png", `/api/attachments/${id}`,
    "/api/legacy-attachments/medical/test.png",
    "/uploads/test%20image.png?version=1#preview",
    "https://test.invalid/uploads/medical/test.png",
    `https://test.invalid/api/attachments/${id}`,
    "/assets/../uploads/test.png",
  ]) assert.equal(shouldBypassImageOptimization(src), true, src);
});

test("temporary previews keep direct loading, while public/static images retain optimization", () => {
  for (const src of ["data:image/png;base64,dGVzdA==", "blob:https://test.invalid/test_image"]) {
    assert.equal(shouldBypassImageOptimization(src), true);
  }
  for (const src of ["/icons/icon.png", "/uploads-not-private/test.png", "/api/attachments-not-private/test.png", "https://test.invalid/logo.png", "invalid", "http://["]) {
    assert.equal(shouldBypassImageOptimization(src), false, src);
  }
});

test("actual Next image props do not route authenticated images through the optimizer", () => {
  for (const src of ["/uploads/test.png", `/api/attachments/${id}`, "/api/legacy-attachments/test.png"]) {
    const { props } = getImageProps({ src, alt: "test private image", width: 320, height: 200,
      unoptimized: shouldBypassImageOptimization(src),
    });
    assert.equal(props.src, src);
    assert.equal(props.srcSet, undefined);
    assert.equal(props.width, 320);
    assert.equal(props.height, 200);
    assert.equal(props.alt, "test private image");
  }
  const src = "/icons/test.png";
  const { props } = getImageProps({ src, alt: "test public image", width: 64, height: 64,
    unoptimized: shouldBypassImageOptimization(src),
  });
  assert.match(String(props.src), /^\/_next\/image\?/);
  assert.ok(props.srcSet);
});
