import test from "node:test";
import assert from "node:assert/strict";

import { downloadAttachment } from "../../lib/growdesk/attachment-bridge";
import { GROWDESK_CONFIG } from "../../lib/config";

const attachmentId = "00000000-0000-0000-0000-000000000001";
const sessionSecret = "a".repeat(64);

test("attachment BFF streams canonical content without requesting a signed read URL", async (t) => {
  const requests: { url: string; init?: RequestInit }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    const path = new URL(url).pathname;
    if (path === "/api/v1/auth/bff/session") {
      return Response.json({
        data: {
          accessToken: "test_access_token",
          user: {
            id: "test_user",
            username: "test_user",
            displayName: "test_user",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      });
    }
    if (path === `/api/v1/attachments/${attachmentId}/content`) {
      assert.equal(init?.headers && new Headers(init.headers).get("authorization"), "Bearer test_access_token");
      return new Response(Buffer.from("test_attachment_bytes"), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": "21" },
      });
    }
    assert.fail(`unexpected upstream request: ${path}`);
  });

  const response = await downloadAttachment(new Request("https://test.invalid/api/attachments/" + attachmentId, {
    headers: { cookie: `${GROWDESK_CONFIG.cookieName}=${sessionSecret}` },
  }), attachmentId);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("content-length"), null, "the decoded stream must not inherit a possibly compressed upstream length");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(await response.text(), "test_attachment_bytes");
  assert.equal(requests.some(({ url }) => url.includes("/download-url")), false);
  assert.equal(requests.filter(({ url }) => url.includes(`/attachments/${attachmentId}/content`)).length, 1);
});

