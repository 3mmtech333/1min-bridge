// ============================================================================
// 1min-bridge — Auth Middleware
// Supports: Authorization Bearer, x-api-key, Master Proxy AUTH_TOKEN, default key
// ============================================================================

import type { Context, Next } from "hono";
import { config } from "../config.js";
import { authenticationError, sendError } from "../errors.js";
import type { Env } from "../types.js";

/**
 * Auth middleware: validates Authorization: Bearer <key> or x-api-key header.
 * In Master Proxy mode (AUTH_TOKEN configured), validates client token and injects ONE_MIN_API_KEY.
 * Falls back to ONE_MIN_API_KEY server-side default key.
 */
export async function authMiddleware(
  c: Context<Env>,
  next: Next,
): Promise<Response | void> {
  const authHeader = c.req.header("Authorization");
  const xApiKey = c.req.header("x-api-key");

  let token: string | undefined;

  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice(7).trim();
  } else if (xApiKey) {
    token = xApiKey.trim();
  }

  const masterAuthToken =
    c.env?.AUTH_TOKEN ||
    process.env.AUTH_TOKEN;

  const serverOneMinApiKey =
    c.env?.ONE_MIN_API_KEY ||
    config.defaultApiKey;

  // 1. If client provided a token
  if (token) {
    // If master proxy token is configured and matches client token
    if (masterAuthToken && token === masterAuthToken) {
      if (!serverOneMinApiKey) {
        return sendError(
          c,
          authenticationError(
            "Master proxy AUTH_TOKEN matched, but ONE_MIN_API_KEY is not configured on the server.",
          ),
        );
      }
      c.set("oneMinApiKey", serverOneMinApiKey);
      c.set("gatewayToken", token);
      await next();
      return;
    }

    // Otherwise, treat token as direct 1min.ai API key
    c.set("oneMinApiKey", token);
    await next();
    return;
  }

  // 2. Fallback to server-side default key
  if (serverOneMinApiKey) {
    c.set("oneMinApiKey", serverOneMinApiKey);
    await next();
    return;
  }

  return sendError(
    c,
    authenticationError(
      "Missing API key. Provide 'Authorization: Bearer <key>', 'x-api-key: <key>', or set ONE_MIN_API_KEY on the server.",
    ),
  );
}
