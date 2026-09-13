import { NextResponse } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { verifyMcpAccessToken, OAuthError } from "@/lib/oauth/service";
import { getBaseUrl } from "@/lib/oauth/config";
import { createMcpServer } from "@/lib/mcp/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

function getCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version, Last-Event-ID",
    "Access-Control-Expose-Headers": "WWW-Authenticate, MCP-Protocol-Version",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(),
  });
}

async function handleMcpRequest(request: Request) {
  // Token 爆破 + 昂贵 agent 调用成本保护（认证前按 IP 限流）
  const ip = getClientIp(request);
  const preAuthLimit = checkRateLimit(`mcp:${ip}`, 120, 60_000);
  if (!preAuthLimit.success) {
    return NextResponse.json(
      { error: "rate_limited", error_description: "请求过于频繁，请稍后再试" },
      { status: 429, headers: getCorsHeaders() }
    );
  }

  const baseUrl = getBaseUrl(request);
  const resourceMetadataUrl = `${baseUrl}/.well-known/oauth-protected-resource/mcp`;

  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json(
      {
        error: "unauthorized",
        error_description: "Missing Bearer access token",
        resource_metadata: resourceMetadataUrl,
      },
      {
        status: 401,
        headers: {
          ...getCorsHeaders(),
          "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl}"`,
        },
      }
    );
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return NextResponse.json(
      {
        error: "unauthorized",
        error_description: "Empty Bearer access token",
      },
      {
        status: 401,
        headers: {
          ...getCorsHeaders(),
          "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl}", error="invalid_token"`,
        },
      }
    );
  }

  let principal;
  try {
    principal = await verifyMcpAccessToken(token, request);
  } catch (err: any) {
    if (err instanceof OAuthError) {
      return NextResponse.json(
        {
          error: err.error,
          error_description: err.errorDescription,
        },
        {
          status: err.statusCode,
          headers: {
            ...getCorsHeaders(),
            "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl}", error="${err.error}", error_description="${err.errorDescription || ""}"`,
          },
        }
      );
    }
    return NextResponse.json(
      {
        error: "invalid_token",
        error_description: "Access token verification failed",
      },
      {
        status: 401,
        headers: {
          ...getCorsHeaders(),
          "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl}", error="invalid_token"`,
        },
      }
    );
  }

  // Create per-request scoped MCP Server connected to verified UserPrincipal
  const server = createMcpServer(principal, { accessToken: token });

  const incomingAccept = request.headers.get("accept") || "";
  // If client only requested JSON (without text/event-stream), enable direct JSON response mode
  const wantsPureJson = incomingAccept.includes("application/json") && !incomingAccept.includes("text/event-stream");
  const enableJsonResponse = wantsPureJson || incomingAccept === "" || incomingAccept === "*/*";

  const headers = new Headers(request.headers);
  // Ensure MCP SDK transport accept requirements are satisfied internally
  if (!incomingAccept.includes("application/json") || !incomingAccept.includes("text/event-stream")) {
    headers.set("accept", "application/json, text/event-stream");
  }

  let body: any = null;
  if (request.method !== "GET" && request.method !== "HEAD" && request.body) {
    body = await request.text();
  }

  const reqToHandle = new Request(request.url, {
    method: request.method,
    headers,
    body: body || undefined,
  });

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // Stateless per-request mode
    enableJsonResponse,
  });

  await server.connect(transport);

  const response = await transport.handleRequest(reqToHandle);

  // Attach CORS and cache headers to response
  const resHeaders = new Headers(response.headers);
  for (const [k, v] of Object.entries(getCorsHeaders())) {
    resHeaders.set(k, v);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: resHeaders,
  });
}

export async function GET(request: Request) {
  return handleMcpRequest(request);
}

export async function POST(request: Request) {
  return handleMcpRequest(request);
}

export async function DELETE(request: Request) {
  return handleMcpRequest(request);
}
