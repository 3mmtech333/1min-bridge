// ============================================================================
// 1min-bridge Verification Test Suite
// ============================================================================

import assert from "node:assert";
import { rateLimitMiddleware } from "../src/middleware/rate-limit.js";
import { parseToolCalls, stripToolCalls, formatStreamingToolCalls, isPotentialToolCallBuffer } from "../src/adapters/tool-parser.js";
import { getModelData, isValidModel, isVisionModel, isImageModel, isChatModel, isSpeechModel } from "../src/model-registry.js";
import { incrementCounter, observeHistogram, getMetricsText } from "../src/metrics.js";
import { RelayError, modelNotFoundError, authenticationError, invalidRequestError } from "../src/errors.js";

async function runTests() {
  console.log("🚀 Starting 1min-bridge verification tests...\n");

  // --------------------------------------------------------------------------
  // Test 1: Rate Limiter Token Bucket Accumulator Bug
  // --------------------------------------------------------------------------
  console.log("Test 1: Rate Limiter Refill & Rapid-fire Token Bucket...");
  const rl = rateLimitMiddleware({ maxRequests: 5, windowMs: 1000, keyFn: () => "test-user" });

  const mockContext = {
    get: () => "test-key",
    req: { header: () => undefined },
    header: (name: string, value: string) => {},
    json: (data: any, status: number) => new Response(JSON.stringify(data), { status }),
  } as any;

  let passedRequests = 0;

  // Consume 5 tokens immediately
  for (let i = 0; i < 5; i++) {
    let nextCalled = false;
    await rl(mockContext, async () => { nextCalled = true; });
    if (nextCalled) passedRequests++;
  }
  assert.strictEqual(passedRequests, 5, "Initial 5 requests should pass");

  // 6th request immediately should fail (429)
  let nextCalled6 = false;
  const res6 = await rl(mockContext, async () => { nextCalled6 = true; });
  assert.strictEqual(nextCalled6, false, "6th request without delay should be rate limited");
  assert.ok(res6, "Should return rate limit response");

  // Wait 250ms (1000ms / 5 = 200ms per token) -> 1 token should refill
  await new Promise((resolve) => setTimeout(resolve, 250));
  let nextCalledAfterRefill = false;
  await rl(mockContext, async () => { nextCalledAfterRefill = true; });
  assert.strictEqual(nextCalledAfterRefill, true, "Token bucket should refill after elapsed interval");
  console.log("  ✅ Rate limiter token refill logic verified successfully.\n");

  // --------------------------------------------------------------------------
  // Test 2: Tool Call Parsing and Streaming Formatters
  // --------------------------------------------------------------------------
  console.log("Test 2: Tool Call Parser & Streaming Formatter...");
  const sampleToolText = `I will check the weather for you.
TOOL_CALL: {"name": "get_weather", "arguments": {"city": "New York", "unit": "celsius"}}`;

  const parsed = parseToolCalls(sampleToolText);
  assert.ok(parsed, "Should parse tool call");
  assert.strictEqual(parsed.length, 1);
  assert.strictEqual(parsed[0].function.name, "get_weather");

  const formattedStreaming = formatStreamingToolCalls(parsed);
  assert.strictEqual(formattedStreaming[0].index, 0);
  assert.strictEqual(formattedStreaming[0].type, "function");
  assert.strictEqual(formattedStreaming[0].function.name, "get_weather");

  const stripped = stripToolCalls(sampleToolText);
  assert.strictEqual(stripped, "I will check the weather for you.");

  assert.strictEqual(isPotentialToolCallBuffer("TOOL_CALL: {\"name\":"), true);
  assert.strictEqual(isPotentialToolCallBuffer("Hello world! How can I help you today?"), false);
  console.log("  ✅ Tool call parser, streaming formatter, and prefix detection verified.\n");

  // --------------------------------------------------------------------------
  // Test 3: Model Registry & Fast Set Lookups
  // --------------------------------------------------------------------------
  console.log("Test 3: Model Registry & O(1) Set Lookups...");
  const modelData = await getModelData();
  assert.ok(modelData.entries.length > 0, "Model registry should have entries");

  const isGpt4oValid = await isValidModel("gpt-4o");
  assert.strictEqual(isGpt4oValid, true, "gpt-4o should be valid");

  const isGpt4oVision = await isVisionModel("gpt-4o");
  assert.strictEqual(isGpt4oVision, true, "gpt-4o should be vision model");

  console.log("  Image models sample:", modelData.imageModelIds.slice(0, 5));
  const sampleImageModel = modelData.imageModelIds[0];
  const isSampleImage = await isImageModel(sampleImageModel);
  assert.strictEqual(isSampleImage, true, `${sampleImageModel} should be image model`);

  const isNonExistent = await isValidModel("totally-nonexistent-model-xyz");
  assert.strictEqual(isNonExistent, false, "Unknown model should return false");
  console.log("  ✅ Model registry lookups and caching verified.\n");

  // --------------------------------------------------------------------------
  // Test 4: Prometheus Metrics O(1) Storage & Formatting
  // --------------------------------------------------------------------------
  console.log("Test 4: Prometheus Metrics O(1) Map Storage...");
  incrementCounter("test_counter_total", { method: "POST", path: "/v1/chat/completions", status: "200" });
  incrementCounter("test_counter_total", { method: "POST", path: "/v1/chat/completions", status: "200" });
  incrementCounter("test_counter_total", { method: "GET", path: "/v1/models", status: "200" });

  observeHistogram("test_duration_seconds", { method: "POST", path: "/v1/chat/completions" }, 0.125);
  observeHistogram("test_duration_seconds", { method: "POST", path: "/v1/chat/completions" }, 0.450);

  const metricsOutput = getMetricsText();
  assert.ok(metricsOutput.includes("test_counter_total{method=\"POST\",path=\"/v1/chat/completions\",status=\"200\"} 2"));
  assert.ok(metricsOutput.includes("test_counter_total{method=\"GET\",path=\"/v1/models\",status=\"200\"} 1"));
  assert.ok(metricsOutput.includes("test_duration_seconds_count{method=\"POST\",path=\"/v1/chat/completions\"} 2"));
  console.log("  ✅ Metrics collection and serialization verified.\n");

  // --------------------------------------------------------------------------
  // Test 6: HTTP Endpoints & 404 Routing Order
  // --------------------------------------------------------------------------
  console.log("Test 6: HTTP Routing, 404, and Auth Middleware...");
  const { default: app } = await import("../src/index.js");

  // Health check
  const healthRes = await app.fetch(new Request("http://localhost:3000/health"));
  assert.strictEqual(healthRes.status, 200, "Health check should return 200");
  const healthJson = await healthRes.json();
  assert.strictEqual(healthJson.status, "ok");

  // Invalid route -> should return 404 (NOT 401!)
  const invalidRes = await app.fetch(new Request("http://localhost:3000/nonexistent_path_xyz"));
  assert.strictEqual(invalidRes.status, 404, "Unknown path should return 404");
  const invalidJson = await invalidRes.json();
  assert.strictEqual(invalidJson.error.code, "not_found");

  // Protected route without auth -> should return 401
  const unauthChatRes = await app.fetch(
    new Request("http://localhost:3000/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
    }),
  );
  assert.strictEqual(unauthChatRes.status, 401, "Protected chat completion without auth should return 401");
  console.log("  ✅ HTTP routing, 404 handling, and auth scoping verified.\n");

  console.log("🎉 All verification tests PASSED!\n");
  process.exit(0);
}

runTests().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
