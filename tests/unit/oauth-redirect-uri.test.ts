import assert from "node:assert/strict";
import test from "node:test";
import { validateRegisteredRedirectUri } from "../../lib/oauth/redirect-uri";

test("OAuth redirect URI validation requires exact registration in shared mode", () => {
  const client = {
    clientId: "google-dynamic-client",
    clientName: "Gemini Spark",
    redirectUrisJson: JSON.stringify([
      "https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-registered",
    ]),
  };

  assert.equal(
    validateRegisteredRedirectUri(
      client,
      "https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-registered",
    ),
    true,
  );
  assert.equal(
    validateRegisteredRedirectUri(
      client,
      "https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-unregistered",
    ),
    false,
  );
});

test("legacy Web mode may retain the historical constrained Google callback", () => {
  const client = {
    clientId: "google-dynamic-client",
    clientName: "Gemini Spark",
    redirectUrisJson: "[]",
  };
  const dynamicCallback =
    "https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-session_123";

  assert.equal(validateRegisteredRedirectUri(client, dynamicCallback), false);
  assert.equal(
    validateRegisteredRedirectUri(client, dynamicCallback, {
      allowUnregisteredGoogleCallback: true,
    }),
    true,
  );
  assert.equal(
    validateRegisteredRedirectUri(client, "https://attacker.example/callback", {
      allowUnregisteredGoogleCallback: true,
    }),
    false,
  );
});
