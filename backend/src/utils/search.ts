import { load } from "cheerio";
import { z } from "zod";
import { config } from "@/config.js";
import { logWarn } from "@/utils/logger.js";
import { secureWebFetch } from "@/utils/network.js";
import { canonicalizeSearchUrl } from "@/utils/search-url.js";

export { formulateSearchQuery } from "@/utils/search-query.js";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  content?: string;
  retrievedAt: string;
}

const SEARCH_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
const MAX_SEARCH_RESPONSE_BYTES = 1_000_000;
const MAX_PAGE_RESPONSE_BYTES = 750_000;
const MAX_RESULTS = 8;

const braveResponseSchema = z.object({
  web: z
    .object({
      results: z.array(
        z.object({
          title: z.string(),
          url: z.string(),
          description: z.string().optional().default(""),
          extra_snippets: z.array(z.string()).optional().default([]),
        }),
      ),
    })
    .optional(),
});

const searxngResponseSchema = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      content: z.string().optional().default(""),
    }),
  ),
});

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function unwrapDuckDuckGoUrl(value: string): string {
  try {
    const url = new URL(value, "https://duckduckgo.com");
    const target = url.searchParams.get("uddg");
    return target ? decodeURIComponent(target) : url.href;
  } catch {
    return value;
  }
}

function unwrapBingUrl(value: string): string {
  try {
    const url = new URL(value, "https://www.bing.com");
    if (url.hostname !== "www.bing.com" || !url.pathname.startsWith("/ck/a")) return url.href;
    const encoded = url.searchParams.get("u");
    if (!encoded?.startsWith("a1")) return url.href;
    return Buffer.from(encoded.slice(2), "base64url").toString("utf8");
  } catch {
    return value;
  }
}

async function readBoundedBody(response: Response, maximumBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maximumBytes) throw new Error("Search response exceeded the size limit");
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error("Search response exceeded the size limit");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function safeFetch(
  urlValue: string,
  signal?: AbortSignal,
  headers: HeadersInit = {},
  maxRedirects = 3,
): Promise<Response> {
  let current = urlValue;
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const response = await secureWebFetch(current, {
      headers: {
        "User-Agent": SEARCH_USER_AGENT,
        Accept: "text/html,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.1",
        "Accept-Language": "en-US,en;q=0.8,id;q=0.7",
        ...headers,
      },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(config.SEARCH_TIMEOUT_MS)])
        : AbortSignal.timeout(config.SEARCH_TIMEOUT_MS),
    });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    current = new URL(location, current).href;
  }
  throw new Error("Too many redirects");
}

function appendResult(results: SearchResult[], seen: Set<string>, title: string, url: string, snippet: string): void {
  const canonicalUrl = canonicalizeSearchUrl(url);
  const cleanTitle = cleanText(title);
  if (!canonicalUrl || !cleanTitle || seen.has(canonicalUrl) || results.length >= MAX_RESULTS) return;
  seen.add(canonicalUrl);
  results.push({
    title: cleanTitle.slice(0, 300),
    url: canonicalUrl,
    snippet: cleanText(snippet).slice(0, 1200),
    retrievedAt: new Date().toISOString(),
  });
}

function mergeResults(groups: SearchResult[][]): SearchResult[] {
  const merged: SearchResult[] = [];
  const seen = new Set<string>();
  const maximumLength = Math.max(0, ...groups.map((group) => group.length));
  for (let index = 0; index < maximumLength && merged.length < MAX_RESULTS; index += 1) {
    for (const group of groups) {
      const result = group[index];
      if (!result) continue;
      appendResult(merged, seen, result.title, result.url, result.snippet);
    }
  }
  return merged;
}

async function searchBrave(query: string, timeFilter?: "d" | "w", signal?: AbortSignal): Promise<SearchResult[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(MAX_RESULTS));
  url.searchParams.set("extra_snippets", "true");
  url.searchParams.set("safesearch", "moderate");
  if (timeFilter) url.searchParams.set("freshness", timeFilter === "d" ? "pd" : "pw");
  const response = await safeFetch(url.href, signal, {
    Accept: "application/json",
    "X-Subscription-Token": config.BRAVE_SEARCH_API_KEY,
  });
  if (!response.ok) throw new Error(`Brave returned ${response.status}`);
  const parsed = braveResponseSchema.parse(JSON.parse(await readBoundedBody(response, MAX_SEARCH_RESPONSE_BYTES)));
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  for (const result of parsed.web?.results || []) {
    appendResult(results, seen, result.title, result.url, [result.description, ...result.extra_snippets].join(" "));
  }
  return results;
}

async function searchSearxng(query: string, timeFilter?: "d" | "w", signal?: AbortSignal): Promise<SearchResult[]> {
  const baseUrl = config.SEARXNG_BASE_URL.endsWith("/") ? config.SEARXNG_BASE_URL : `${config.SEARXNG_BASE_URL}/`;
  const url = new URL("search", baseUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("safesearch", "1");
  if (timeFilter) url.searchParams.set("time_range", timeFilter === "d" ? "day" : "week");
  const response = await safeFetch(url.href, signal, { Accept: "application/json" });
  if (!response.ok) throw new Error(`SearXNG returned ${response.status}`);
  const parsed = searxngResponseSchema.parse(JSON.parse(await readBoundedBody(response, MAX_SEARCH_RESPONSE_BYTES)));
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  for (const result of parsed.results) appendResult(results, seen, result.title, result.url, result.content);
  return results;
}

async function searchDuckDuckGo(query: string, timeFilter?: "d" | "w", signal?: AbortSignal): Promise<SearchResult[]> {
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);
  if (timeFilter) url.searchParams.set("df", timeFilter);
  const response = await safeFetch(url.href, signal);
  if (!response.ok) throw new Error(`DuckDuckGo returned ${response.status}`);
  const $ = load(await readBoundedBody(response, MAX_SEARCH_RESPONSE_BYTES));
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  $(".result").each((_, element) => {
    const anchor = $(element).find("a.result__a").first();
    appendResult(
      results,
      seen,
      anchor.text(),
      unwrapDuckDuckGoUrl(anchor.attr("href") || ""),
      $(element).find(".result__snippet").first().text(),
    );
  });
  return results;
}

async function searchBing(query: string, timeFilter?: "d" | "w", signal?: AbortSignal): Promise<SearchResult[]> {
  const url = new URL("https://www.bing.com/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(MAX_RESULTS));
  if (timeFilter) url.searchParams.set("filters", `ex1:"ez${timeFilter === "d" ? "1" : "2"}"`);
  const response = await safeFetch(url.href, signal);
  if (!response.ok) throw new Error(`Bing returned ${response.status}`);
  const $ = load(await readBoundedBody(response, MAX_SEARCH_RESPONSE_BYTES));
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  $("li.b_algo").each((_, element) => {
    const anchor = $(element).find("h2 a").first();
    appendResult(
      results,
      seen,
      anchor.text(),
      unwrapBingUrl(anchor.attr("href") || ""),
      $(element).find(".b_caption p").first().text(),
    );
  });
  return results;
}

async function searchHtml(query: string, timeFilter?: "d" | "w", signal?: AbortSignal): Promise<SearchResult[]> {
  const providers = await Promise.allSettled([
    searchDuckDuckGo(query, timeFilter, signal),
    searchBing(query, timeFilter, signal),
  ]);
  return mergeResults(providers.map((result) => (result.status === "fulfilled" ? result.value : [])));
}

async function extractPageContent(url: string, signal?: AbortSignal): Promise<string> {
  const response = await safeFetch(url, signal);
  if (!response.ok) return "";
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html") && !contentType.includes("text/plain")) return "";
  const body = await readBoundedBody(response, MAX_PAGE_RESPONSE_BYTES);
  if (contentType.includes("text/plain")) return cleanText(body).slice(0, 3500);

  const $ = load(body);
  $("script,style,noscript,svg,nav,footer,header,form,aside,dialog,template").remove();
  const root = $("article").first().length
    ? $("article").first()
    : $("main").first().length
      ? $("main").first()
      : $("[role='main']").first().length
        ? $("[role='main']").first()
        : $("body");
  return cleanText(
    root
      .find("h1,h2,h3,p,li,blockquote,pre")
      .map((_, element) => $(element).text())
      .get()
      .join(" "),
  ).slice(0, 3500);
}

async function runProvider(name: string, search: () => Promise<SearchResult[]>): Promise<SearchResult[]> {
  try {
    return await search();
  } catch (error) {
    logWarn("web_search_provider_failed", {
      provider: name,
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return [];
  }
}

export async function performWebSearch(
  query: string,
  timeFilter?: "d" | "w",
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const groups: SearchResult[][] = [];
  if (config.BRAVE_SEARCH_API_KEY) {
    groups.push(await runProvider("brave", () => searchBrave(query, timeFilter, signal)));
  }
  if (config.SEARXNG_BASE_URL) {
    groups.push(await runProvider("searxng", () => searchSearxng(query, timeFilter, signal)));
  }
  if (mergeResults(groups).length < 5) {
    groups.push(await runProvider("html", () => searchHtml(query, timeFilter, signal)));
  }

  const results = mergeResults(groups);
  await Promise.all(
    results.slice(0, config.SEARCH_PAGE_FETCH_LIMIT).map(async (result) => {
      try {
        result.content = await extractPageContent(result.url, signal);
      } catch {
        result.content = "";
      }
    }),
  );
  return results;
}

export function formatSearchContext(query: string, results: SearchResult[]): string {
  const sources = results.map((result, index) => {
    const evidence = result.content || result.snippet;
    return `[${index + 1}] ${result.title}\nURL: ${result.url}\nRetrieved: ${result.retrievedAt}\nEvidence: ${evidence}`;
  });
  return `WEB RESEARCH DATA (UNTRUSTED CONTENT)\nSearch query: ${query}\n\n${sources.join("\n\n")}`;
}
