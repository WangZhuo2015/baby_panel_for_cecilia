/**
 * Web Search Service for Baby Panel Intelligent Agent
 * Supports Tavily API, Serper (Google) API, Brave API, with zero-config Bing & Wikipedia fallback.
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source?: string;
}

function decodeBingUrl(href: string): string {
  try {
    const clean = href.replace(/&amp;/g, "&");
    const match = clean.match(/[?&]u=([a-zA-Z0-9_-]+)/);
    if (match) {
      let b64 = match[1];
      if (b64.startsWith("a1")) b64 = b64.slice(2);
      b64 = b64.replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      const decoded = Buffer.from(b64, "base64").toString("utf-8");
      if (decoded.startsWith("http://") || decoded.startsWith("https://")) return decoded;
    }
  } catch {}
  return href;
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&ensp;/g, " ")
    .replace(/&emsp;/g, " ");
}

/** Search using Tavily API if configured */
async function searchTavily(query: string, apiKey: string, limit: number): Promise<SearchResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "basic",
      max_results: limit,
      include_answer: false,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Tavily error: ${res.status}`);
  const data = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
  return (data.results || []).map((r) => ({
    title: r.title || "网页结果",
    url: r.url || "",
    snippet: r.content || "",
    source: "Tavily",
  }));
}

/** Search using Serper Google API if configured */
async function searchSerper(query: string, apiKey: string, limit: number): Promise<SearchResult[]> {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q: query,
      num: limit,
      gl: "cn",
      hl: "zh-cn",
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Serper error: ${res.status}`);
  const data = (await res.json()) as { organic?: Array<{ title?: string; link?: string; snippet?: string }> };
  return (data.organic || []).map((r) => ({
    title: r.title || "网页结果",
    url: r.link || "",
    snippet: r.snippet || "",
    source: "Serper",
  }));
}

/** Search using Brave API if configured */
async function searchBrave(query: string, apiKey: string, limit: number): Promise<SearchResult[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(limit));
  url.searchParams.set("search_lang", "zh");

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Brave error: ${res.status}`);
  const data = (await res.json()) as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
  return (data.web?.results || []).map((r) => ({
    title: r.title || "网页结果",
    url: r.url || "",
    snippet: r.description || "",
    source: "Brave",
  }));
}

/** Zero-config high-speed Bing web search fallback */
async function searchBing(query: string, limit: number): Promise<SearchResult[]> {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-CN&mkt=zh-CN`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Bing search HTTP ${res.status}`);
  const html = await res.text();

  const results: SearchResult[] = [];
  const regex = /<li class="b_algo"[^>]*>[\s\S]*?<h2[^>]*><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>[\s\S]*?<div class="b_caption">[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    const rawUrl = match[1];
    const title = decodeHtmlEntities(match[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
    const snippet = decodeHtmlEntities(match[3].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
    const targetUrl = decodeBingUrl(rawUrl);

    if (title && targetUrl) {
      results.push({
        title,
        url: targetUrl,
        snippet,
        source: "Bing",
      });
    }
    if (results.length >= limit) break;
  }

  return results;
}

/** Wikipedia fallback for encyclopedic pediatric knowledge */
async function searchWikipedia(query: string, limit: number): Promise<SearchResult[]> {
  const url = `https://zh.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${limit}&format=json&origin=*`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "BabyPanel/1.2.0 (https://baby.zwang.fun)",
    },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`Wikipedia error: ${res.status}`);
  const data = (await res.json()) as {
    query?: {
      search?: Array<{
        title?: string;
        pageid?: number;
        snippet?: string;
      }>;
    };
  };

  return (data.query?.search || []).map((item) => ({
    title: item.title || "维基百科",
    url: `https://zh.wikipedia.org/wiki/${encodeURIComponent(item.title || "")}`,
    snippet: decodeHtmlEntities((item.snippet || "").replace(/<[^>]+>/g, "").trim()),
    source: "Wikipedia",
  }));
}

/**
 * Execute web search with automatic multi-backend fallback
 */
export async function performWebSearch(query: string, limit = 5): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const maxResults = Math.min(10, Math.max(1, limit));

  // 1. Tavily API
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (tavilyKey) {
    try {
      const results = await searchTavily(trimmed, tavilyKey, maxResults);
      if (results.length > 0) return results;
    } catch {}
  }

  // 2. Serper API
  const serperKey = process.env.SERPER_API_KEY;
  if (serperKey) {
    try {
      const results = await searchSerper(trimmed, serperKey, maxResults);
      if (results.length > 0) return results;
    } catch {}
  }

  // 3. Brave API
  const braveKey = process.env.BRAVE_API_KEY;
  if (braveKey) {
    try {
      const results = await searchBrave(trimmed, braveKey, maxResults);
      if (results.length > 0) return results;
    } catch {}
  }

  // 4. Zero-config Bing Search Engine
  try {
    const results = await searchBing(trimmed, maxResults);
    if (results.length > 0) return results;
  } catch {}

  // 5. Wikipedia fallback
  try {
    const wikiResults = await searchWikipedia(trimmed, maxResults);
    if (wikiResults.length > 0) return wikiResults;
  } catch {}

  return [];
}

