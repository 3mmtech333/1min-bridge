// ============================================================================
// 1min-bridge — Web Hub (POST /v1/web/fetch, POST /v1/search)
// ============================================================================

import { Hono } from "hono";
import { z } from "zod";
import { config } from "../config.js";
import { invalidRequestError, sendError, upstreamError } from "../errors.js";
import type { Env } from "../types.js";

const app = new Hono<Env>();

const webFetchSchema = z.object({
  url: z.string().url(),
});

const searchSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional().default(10),
  categories: z.string().optional().default("general"),
});

/**
 * POST /v1/web/fetch
 * Extracts and cleans content from a webpage using Jina Reader.
 */
app.post("/v1/web/fetch", async (c) => {
  let body: { url: string };
  try {
    const raw = await c.req.json();
    body = webFetchSchema.parse(raw);
  } catch (err) {
    return sendError(c, invalidRequestError("Valid 'url' is required"));
  }

  try {
    const jinaUrl = `https://r.jina.ai/${encodeURIComponent(body.url)}`;
    const res = await fetch(jinaUrl, {
      headers: {
        Accept: "text/plain, text/markdown",
        "X-Return-Format": "markdown",
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw upstreamError(res.status, `Jina Reader error: ${text.slice(0, 200)}`);
    }

    const content = await res.text();
    const titleMatch = content.match(/^Title:\s*(.+)$/m);
    const title = titleMatch ? titleMatch[1] : undefined;

    return c.json({
      url: body.url,
      title,
      content,
      fetched_at: Date.now(),
    });
  } catch (err) {
    console.error("Web fetch error:", err);
    throw err;
  }
});

/**
 * POST /v1/search
 * Searches the web via SearXNG hub.
 */
app.post("/v1/search", async (c) => {
  const searxngUrl =
    c.env?.SEARXNG_URL ||
    process.env.SEARXNG_URL ||
    config.searxngUrl;

  const searxngSecret =
    c.env?.SEARXNG_SECRET ||
    process.env.SEARXNG_SECRET ||
    config.searxngSecret;

  if (!searxngUrl) {
    return sendError(
      c,
      invalidRequestError(
        "SearXNG URL is not configured on the server. Set SEARXNG_URL in environment.",
        "searxng_not_configured",
      ),
    );
  }

  let body: { query: string; limit?: number; categories?: string };
  try {
    const raw = await c.req.json();
    body = searchSchema.parse(raw);
  } catch (err) {
    return sendError(c, invalidRequestError("Valid 'query' is required"));
  }

  try {
    const targetUrl = new URL("/search", searxngUrl);
    targetUrl.searchParams.set("q", body.query);
    targetUrl.searchParams.set("format", "json");
    if (body.categories) targetUrl.searchParams.set("categories", body.categories);

    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (searxngSecret) {
      headers["Authorization"] = `Bearer ${searxngSecret}`;
    }

    const res = await fetch(targetUrl.toString(), {
      headers,
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw upstreamError(res.status, `SearXNG error: ${text.slice(0, 200)}`);
    }

    const data = (await res.json()) as { results?: Array<{ title: string; url: string; content?: string }> };
    const rawResults = Array.isArray(data.results) ? data.results : [];
    const results = rawResults.slice(0, body.limit).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
    }));

    return c.json({
      query: body.query,
      results,
      count: results.length,
    });
  } catch (err) {
    console.error("SearXNG search error:", err);
    throw err;
  }
});

export default app;
