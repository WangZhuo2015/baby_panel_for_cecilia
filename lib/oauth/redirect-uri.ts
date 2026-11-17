export interface RedirectValidationClient {
  clientId?: string;
  redirectUrisJson: string;
  clientName?: string | null;
}

/**
 * Validate a requested callback against the exact redirect URI set registered
 * for the client. The legacy Web-only OAuth implementation may opt into the
 * historical Google dynamic callback exception; the Go-backed shared flow must
 * keep this disabled because the native OAuth service requires exact DCR URIs.
 */
export function validateRegisteredRedirectUri(
  client: RedirectValidationClient,
  requestedUri: string,
  options: { allowUnregisteredGoogleCallback?: boolean } = {},
): boolean {
  try {
    const allowedUris: string[] = JSON.parse(client.redirectUrisJson);
    if (allowedUris.includes(requestedUri)) return true;
    if (!options.allowUnregisteredGoogleCallback) return false;

    const isGoogleClient =
      client.clientId === "gemini-spark-client" ||
      client.clientId?.toLowerCase().includes("google") ||
      client.clientId?.toLowerCase().includes("gemini") ||
      client.clientName?.toLowerCase().includes("google") ||
      client.clientName?.toLowerCase().includes("gemini");
    if (!isGoogleClient) return false;

    const parsed = new URL(requestedUri);
    const isGoogleOAuthRedirectHost =
      parsed.hostname === "oauth-redirect.googleusercontent.com" ||
      parsed.hostname === "oauth-redirect-sandbox.googleusercontent.com" ||
      parsed.hostname === "oauth-redirect-test.googleusercontent.com";

    return isGoogleOAuthRedirectHost &&
      parsed.protocol === "https:" &&
      /^\/r\/user_bound_custom-mcp-[a-zA-Z0-9_\-.]+$/.test(parsed.pathname);
  } catch {
    return false;
  }
}
